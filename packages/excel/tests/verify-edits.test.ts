import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createVerifyEditsTool,
  scanRangeForErrors,
} from "../src/lib/tools/verify-edits";

/* global Excel */

describe("scanRangeForErrors", () => {
  it("finds Excel error values with addresses and formulas", () => {
    const values = [
      [1, "#REF!"],
      ["#VALUE!", "ok"],
    ];
    const formulas = [
      [1, "=A1/B1"],
      ["=VLOOKUP(x)", "text"],
    ];
    const res = scanRangeForErrors("B2", values, formulas);
    expect(res.scannedCells).toBe(4);
    expect(res.errors).toEqual([
      { address: "C2", formula: "=A1/B1", error: "#REF!" },
      { address: "B3", formula: "=VLOOKUP(x)", error: "#VALUE!" },
    ]);
  });

  it("matches error markers case-insensitively with padding", () => {
    const res = scanRangeForErrors("A1", [[" #name? ", "#Div/0!"]]);
    expect(res.errors.map((e) => e.error)).toEqual(["#NAME?", "#DIV/0!"]);
  });

  it("treats numbers, strings and blanks as clean", () => {
    const res = scanRangeForErrors("A1", [[0, "", "profit #REF marker", 42]]);
    // "#REF marker" lacks the ! so it is NOT an Excel error
    expect(res.errors).toEqual([]);
    expect(res.scannedCells).toBe(4);
  });

  it("handles missing formulas gracefully", () => {
    const res = scanRangeForErrors("A1", [["#N/A"]]);
    expect(res.errors).toEqual([{ address: "A1", formula: undefined, error: "#N/A" }]);
  });
});

describe("verify_edits tool", () => {
  const g = globalThis as Record<string, unknown>;

  afterEach(() => {
    delete g.Excel;
  });

  function mockExcelRun(rangeData: {
    address: string;
    values: unknown[][];
    formulas: string[][];
  }[]) {
    const sync = vi.fn(async () => {});
    const ranges = rangeData.map((r) => ({
      address: r.address,
      values: r.values,
      formulas: r.formulas,
      load: () => {},
    }));
    let rangeIndex = 0;
    g.Excel = {
      run: async (cb: (ctx: unknown) => Promise<unknown>) =>
        cb({
          workbook: {
            worksheets: {
              getActiveWorksheet: () => ({
                getRange: () => ranges[rangeIndex++ % ranges.length],
              }),
            },
          },
          sync,
        }),
    };
    return { sync, ranges };
  }

  it("returns ok:true with zero errors on a clean range", async () => {
    mockExcelRun([{ address: "B2", values: [[1, 2]], formulas: [["=1", "=2"]] }]);
    const tool = createVerifyEditsTool({} as never);

    const res = await tool.execute("t1", { ranges: ["B2:C2"] } as never);
    const text = res.content[0] as { type: string; text?: string };
    const parsed = JSON.parse(text.text ?? "{}");
    expect(parsed.ok).toBe(true);
    expect(parsed.scannedCells).toBe(2);
    expect(parsed.errors).toEqual([]);
    expect(parsed.checkedRanges).toEqual(["B2"]);
  });

  it("reports every formula error with its address", async () => {
    mockExcelRun([
      { address: "B2", values: [["#REF!", "ok"]], formulas: [["=X", "5"]] },
    ]);
    const tool = createVerifyEditsTool({} as never);

    const res = await tool.execute("t1", { ranges: ["B2:C2"] } as never);
    const text = res.content[0] as { type: string; text?: string };
    const parsed = JSON.parse(text.text ?? "{}");
    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0].address).toBe("B2");
    expect(parsed.errors[0].error).toBe("#REF!");
  });

  it("rejects an empty ranges list", async () => {
    mockExcelRun([]);
    const tool = createVerifyEditsTool({} as never);

    const res = await tool.execute("t1", { ranges: [] } as never);
    const text = res.content[0] as { type: string; text?: string };
    expect(JSON.parse(text.text ?? "{}").success).toBe(false);
  });
});
