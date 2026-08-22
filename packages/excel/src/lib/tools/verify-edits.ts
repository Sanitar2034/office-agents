import type { AgentContext } from "@office-agents/core";
import { Type } from "@sinclair/typebox";
import { defineTool, toolError, toolSuccess } from "./types";

/* global Excel */

export const EXCEL_ERROR_MARKERS = [
  "#REF!",
  "#VALUE!",
  "#NAME?",
  "#DIV/0!",
  "#N/A",
  "#NULL!",
  "#NUM!",
  "#SPILL!",
  "#CALC!",
] as const;

export interface CellErrorFinding {
  address: string;
  formula?: string;
  error: string;
}

function columnName(index: number): string {
  let name = "";
  let i = index;
  while (i >= 0) {
    name = String.fromCharCode(65 + (i % 26)) + name;
    i = Math.floor(i / 26) - 1;
  }
  return name;
}

/** Offsets a base A1 address like "B2" by (rowOffset, colOffset). */
function offsetAddress(base: string, rowOffset: number, colOffset: number): string {
  const m = base.match(/^([A-Z]+)(\d+)$/i);
  if (!m) return `${base}+${rowOffset},${colOffset}`;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  col -= 1;
  const row = parseInt(m[2], 10);
  return `${columnName(col + colOffset)}${row + rowOffset}`;
}

function matchError(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase();
  for (const marker of EXCEL_ERROR_MARKERS) {
    if (value === marker) return marker;
  }
  return null;
}

export function scanRangeForErrors(
  baseAddress: string,
  values: unknown[][],
  formulas?: string[][],
): { scannedCells: number; errors: CellErrorFinding[] } {
  const errors: CellErrorFinding[] = [];
  let scanned = 0;
  for (let r = 0; r < values.length; r++) {
    const row = values[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      scanned += 1;
      const error = matchError(row[c]);
      if (!error) continue;
      const formula = formulas?.[r]?.[c];
      errors.push({
        address: offsetAddress(baseAddress, r, c),
        formula: typeof formula === "string" && formula.startsWith("=")
          ? formula
          : undefined,
        error,
      });
    }
  }
  return { scannedCells: scanned, errors };
}

export function createVerifyEditsTool(_ctx: AgentContext) {
  return defineTool({
    name: "verify_edits",
    label: "Verify Edited Ranges",
    description:
      "Post-edit audit: re-read the ranges you just wrote and scan every cell for " +
      "Excel error values (#REF!, #VALUE!, #NAME?, #DIV/0!, #N/A, #NUM!, #SPILL!, #CALC!). " +
      "Call this after each batch of edits, before reporting success. If errors are " +
      "found, fix them or explain them explicitly to the user.",
    parameters: Type.Object({
      ranges: Type.Array(Type.String(), {
        description:
          "A1 ranges to scan, e.g. ['B2:F40','H2:H10'] (max 10). Cover every range you modified.",
        minItems: 1,
        maxItems: 10,
      }),
      sheet: Type.Optional(
        Type.String({ description: "Worksheet name; defaults to the active sheet" }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      if (!Array.isArray(params.ranges) || params.ranges.length === 0) {
        return toolError("Provide at least one A1 range to verify.");
      }
      try {
        const findings: CellErrorFinding[] = [];
        const checkedRanges: string[] = [];
        let scannedCells = 0;

        await Excel.run(async (context) => {
          const sheet = params.sheet
            ? context.workbook.worksheets.getItem(params.sheet)
            : context.workbook.worksheets.getActiveWorksheet();

          const loaded = params.ranges.map((address: string) => {
            const range = sheet.getRange(address);
            range.load("address,values,formulas");
            return range;
          });
          await context.sync();

          for (const range of loaded) {
            const result = scanRangeForErrors(
              range.address,
              range.values as unknown[][],
              range.formulas as string[][],
            );
            scannedCells += result.scannedCells;
            findings.push(...result.errors);
            checkedRanges.push(range.address);
          }
        });

        return toolSuccess({
          ok: findings.length === 0,
          scannedCells,
          checkedRanges,
          errors: findings,
        });
      } catch (error) {
        if (
          typeof OfficeExtension !== "undefined" &&
          error instanceof OfficeExtension.Error
        ) {
          return toolError(
            `${error.message}${error.debugInfo?.errorLocation ? ` (at ${error.debugInfo.errorLocation})` : ""}`,
          );
        }
        return toolError(
          error instanceof Error ? error.message : "Failed to verify edits",
        );
      }
    },
  });
}
