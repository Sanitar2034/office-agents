import { afterEach, describe, expect, it } from "vitest";
import {
  buildConventionsSection,
  getDocumentConventions,
  setDocumentConventions,
} from "../src/storage/conventions";

const ns = {
  dbName: "test",
  dbVersion: 1,
  localStoragePrefix: "office-agents",
  documentSettingsPrefix: "office-agents",
};

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("document conventions storage", () => {
  afterEach(() => {
    try {
      localStorage.clear();
    } catch {
      // no localStorage in this environment
    }
  });

  it("round-trips per document and falls back to empty", () => {
    const s = memStorage();
    expect(getDocumentConventions(ns, "doc-1", s)).toBe("");
    setDocumentConventions(ns, "doc-1", "Blue corporate template", s);
    expect(getDocumentConventions(ns, "doc-1", s)).toBe("Blue corporate template");
    expect(getDocumentConventions(ns, "doc-2", s)).toBe("");
  });

  it("uses a global slot when the document id is unknown", () => {
    const s = memStorage();
    setDocumentConventions(ns, null, "global rule", s);
    expect(getDocumentConventions(ns, null, s)).toBe("global rule");
    expect(getDocumentConventions(ns, "doc-9", s)).toBe("");
  });

  it("caps the text at 8000 chars", () => {
    const s = memStorage();
    setDocumentConventions(ns, "d", "x".repeat(9000), s);
    expect(getDocumentConventions(ns, "d", s).length).toBe(8000);
  });

  it("empty text clears the slot", () => {
    const s = memStorage();
    setDocumentConventions(ns, "d", "keep me", s);
    setDocumentConventions(ns, "d", "   ", s);
    expect(getDocumentConventions(ns, "d", s)).toBe("");
  });

  it("falls back to the global localStorage when no storage is passed", () => {
    const g = globalThis as Record<string, unknown>;
    const prev = g.localStorage;
    const s = memStorage();
    g.localStorage = s;
    try {
      setDocumentConventions(ns, "doc-ls", "persisted");
      expect(getDocumentConventions(ns, "doc-ls")).toBe("persisted");
    } finally {
      g.localStorage = prev;
    }
  });
});

describe("buildConventionsSection", () => {
  it("formats a prompt section with a clear heading", () => {
    const section = buildConventionsSection("Always use rubles\nNever delete row 3");
    expect(section).toContain("## Document Conventions");
    expect(section).toContain("Always use rubles");
    expect(section).toContain("Never delete row 3");
  });

  it("returns an empty string for blank input", () => {
    expect(buildConventionsSection("   ")).toBe("");
    expect(buildConventionsSection("")).toBe("");
  });
});
