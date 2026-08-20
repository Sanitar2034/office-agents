import { describe, expect, it } from "vitest";
import { normalizeCellValue } from "../src/lib/excel/api";

// Regression suite for the "silently empty cells" bug: models following
// Claude-for-Excel conventions send wrapped objects like {"text": "..."} in
// `value`; Office.js range.values accepts only primitives and coerces
// anything else to empty cells while the tool still reports success.
describe("normalizeCellValue", () => {
  it("passes primitives through unchanged", () => {
    expect(normalizeCellValue("hello")).toEqual({ value: "hello", formula: null });
    expect(normalizeCellValue(42)).toEqual({ value: 42, formula: null });
    expect(normalizeCellValue(true)).toEqual({ value: true, formula: null });
    expect(normalizeCellValue(null)).toEqual({ value: null, formula: null });
    expect(normalizeCellValue(undefined)).toEqual({ value: null, formula: null });
  });

  it("unwraps {text: ...} objects (Claude-for-Excel style)", () => {
    expect(normalizeCellValue({ text: "Lease Agreement" })).toEqual({
      value: "Lease Agreement",
      formula: null,
    });
  });

  it("promotes =-prefixed strings to formulas", () => {
    expect(normalizeCellValue("=SUM(A1:A10)")).toEqual({
      value: null,
      formula: "=SUM(A1:A10)",
    });
    expect(normalizeCellValue({ text: "=C2*(1+D2)" })).toEqual({
      value: null,
      formula: "=C2*(1+D2)",
    });
  });

  it("unwraps {formula: ...} and auto-prefixes =", () => {
    expect(normalizeCellValue({ formula: "SUM(A1:A2)" })).toEqual({
      value: null,
      formula: "=SUM(A1:A2)",
    });
    expect(normalizeCellValue({ formula: "=SUM(A1:A2)" })).toEqual({
      value: null,
      formula: "=SUM(A1:A2)",
    });
  });

  it("coerces {number: '5'} to a number but keeps text strings as text", () => {
    expect(normalizeCellValue({ number: "5" })).toEqual({ value: 5, formula: null });
    expect(normalizeCellValue({ text: "5" })).toEqual({ value: "5", formula: null });
  });

  it("unwraps boolean/value/date keys", () => {
    expect(normalizeCellValue({ boolean: true })).toEqual({ value: true, formula: null });
    expect(normalizeCellValue({ value: 7 })).toEqual({ value: 7, formula: null });
    expect(typeof normalizeCellValue({ date: "2026-01-01" }).value).toBe("string");
  });

  it("stringifies unknown shapes instead of losing them to empty cells", () => {
    const res = normalizeCellValue({ weird: { nested: [1, 2] } });
    expect(res.formula).toBeNull();
    expect(String(res.value)).toContain("weird");
  });
});
