import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// localStorage stub: the journal persists across taskpane reloads in prod.
function makeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe("undo journal", () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    vi.resetModules(); // fresh module state per test
    storage = makeStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records entries, persists to localStorage and reloads via init", async () => {
    const { initUndoJournal, recordUndo, journalLength } = await import(
      "../src/lib/excel/undo-journal"
    );
    initUndoJournal("testns");
    expect(journalLength()).toBe(0);

    const entry = {
      ts: Date.now(),
      tool: "set_cell_range",
      sheetId: 1,
      range: "A1:B2",
      values: [["a", 1]],
      formulas: [["a", 1]],
      numberFormat: [["General", "General"]],
    };
    recordUndo(entry);
    recordUndo({ ...entry, range: "C3" });
    expect(journalLength()).toBe(2);
    expect(storage.getItem("testns-undo-journal")).toContain("C3");

    // simulate taskpane reload: module state is fresh, storage is not
    vi.resetModules();
    const reloaded = await import("../src/lib/excel/undo-journal");
    reloaded.initUndoJournal("testns");
    expect(reloaded.journalLength()).toBe(2);
  });

  it("trims oldest entries by the byte budget, never below one", async () => {
    const { initUndoJournal, recordUndo, journalLength } = await import(
      "../src/lib/excel/undo-journal"
    );
    initUndoJournal("testns2");
    // ~10k cells per entry -> ~480KB estimated each, 2MB budget trips fast
    const big = (r: string) => ({
      ts: Date.now(),
      tool: "set_cell_range",
      sheetId: 1,
      range: r,
      values: [new Array(5000).fill("x"), new Array(5000).fill("x")],
      formulas: [new Array(5000).fill("x"), new Array(5000).fill("x")],
      numberFormat: [new Array(5000).fill("G"), new Array(5000).fill("G")],
    });
    for (let i = 0; i < 30; i++) recordUndo(big(`R${i}`));
    expect(journalLength()).toBeLessThan(30);
    expect(journalLength()).toBeGreaterThanOrEqual(1);
  });
});
