import { preloadSheetIds } from "./sheet-id-map";

// Agent undo journal (way 1): every write tool captures the previous
// values/formulas/numberFormat of the target range and stores an inverse
// operation. undoEdits replays them backwards. Works within ExcelApi 1.17
// (no native undo for JS ops before 1.20), survives taskpane reloads via
// localStorage.

export interface UndoEntry {
  ts: number;
  tool: string;
  sheetId: number;
  range: string;
  values: unknown[][];
  formulas: unknown[][];
  numberFormat: unknown[][];
}

let storagePrefix: string | null = null;
let journal: UndoEntry[] = [];
const MAX_ENTRIES = 200;

function storageKey(): string | null {
  return storagePrefix ? `${storagePrefix}-undo-journal` : null;
}

export function initUndoJournal(prefix: string): void {
  storagePrefix = prefix;
  try {
    const key = storageKey();
    if (key) {
      const raw = localStorage.getItem(key);
      if (raw) journal = JSON.parse(raw) as UndoEntry[];
    }
  } catch {
    journal = [];
  }
}

function persist(): void {
  try {
    const key = storageKey();
    if (key) localStorage.setItem(key, JSON.stringify(journal));
  } catch {
    /* journal stays in memory if storage is unavailable */
  }
}

export function recordUndo(entry: UndoEntry): void {
  journal.push(entry);
  if (journal.length > MAX_ENTRIES) {
    journal = journal.slice(-MAX_ENTRIES);
  }
  persist();
}

export function journalLength(): number {
  return journal.length;
}

export function clearJournal(): void {
  journal = [];
  persist();
}

/* global Excel */

export async function undoEdits(
  count: number | "all",
): Promise<{ success: boolean; undone: number; remaining: number; error?: string }> {
  if (journal.length === 0) {
    return { success: true, undone: 0, remaining: 0 };
  }
  const n = count === "all" ? journal.length : Math.min(count, journal.length);
  const batch = journal.slice(-n).reverse();
  let undone = 0;
  let lastError: string | undefined;

  for (const entry of batch) {
    try {
      await Excel.run(async (context) => {
        const sheets = context.workbook.worksheets;
        sheets.load("items");
        await context.sync();
        for (const sheet of sheets.items) sheet.load("id");
        await context.sync();
        const idMap = await preloadSheetIds(sheets.items);
        const target = sheets.items.find(
          (sh) => idMap.get(sh.id) === entry.sheetId,
        );
        if (!target) throw new Error(`sheet ${entry.sheetId} not found`);
        const range = target.getRange(entry.range);
        range.load("rowCount,columnCount");
        await context.sync();
        if (
          range.rowCount !== entry.formulas.length ||
          range.columnCount !== (entry.formulas[0]?.length ?? 0)
        ) {
          throw new Error(
            `range ${entry.range} changed shape since the edit; restore skipped`,
          );
        }
        // formulas array holds formulas AND literal values -> one write restores both
        range.formulas = entry.formulas as unknown[][];
        range.numberFormat = entry.numberFormat as unknown[][];
        await context.sync();
      });
      undone += 1;
      journal.pop();
      persist();
    } catch (err) {
      lastError = err instanceof Error ? err.message : "undo failed";
      break; // keep order intact: stop at first failure
    }
  }

  return {
    success: undone > 0,
    undone,
    remaining: journal.length,
    error: lastError,
  };
}
