import { describe, expect, it } from "vitest";
import {
  appendCompactionLog,
  exportCompactionLogJson,
  getCompactionLog,
  type CompactionLogEntry,
} from "../src/compaction-log";

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

function entry(partial: Partial<CompactionLogEntry>): CompactionLogEntry {
  return {
    ts: Date.now(),
    kind: "structural",
    messagesBefore: 10,
    messagesAfter: 10,
    tokensBefore: 90000,
    tokensAfter: 40000,
    compactedCalls: [
      { tool: "set_cell_range", digestChars: 130, originalChars: 42000 },
    ],
    removedFailedCalls: [{ tool: "set_cell_range", error: "bad range" }],
    ...partial,
  };
}

describe("compaction log", () => {
  it("round-trips entries through storage", () => {
    const s = memStorage();
    appendCompactionLog(ns, entry({}), s);
    appendCompactionLog(ns, entry({ kind: "summary" }), s);
    const log = getCompactionLog(ns, s);
    expect(log).toHaveLength(2);
    expect(log[0].kind).toBe("structural");
    expect(log[1].kind).toBe("summary");
    expect(log[0].compactedCalls[0].tool).toBe("set_cell_range");
  });

  it("keeps only the most recent 50 entries (ring)", () => {
    const s = memStorage();
    for (let i = 0; i < 60; i++) {
      appendCompactionLog(ns, entry({ tokensBefore: i }), s);
    }
    const log = getCompactionLog(ns, s);
    expect(log).toHaveLength(50);
    expect(log[log.length - 1].tokensBefore).toBe(59); // newest last
    expect(log[0].tokensBefore).toBe(10); // oldest ten dropped
  });

  it("returns [] when storage is missing or corrupt", () => {
    expect(getCompactionLog(ns, null)).toEqual([]);
    const s = memStorage();
    s.setItem("office-agents-compaction-log", "{nope");
    expect(getCompactionLog(ns, s)).toEqual([]);
  });

  it("swallows a throwing storage (logging never breaks compaction)", () => {
    const boom = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
    expect(() => appendCompactionLog(ns, entry({}), boom)).not.toThrow();
    expect(getCompactionLog(ns, boom)).toEqual([]);
  });

  it("exports a readable JSON report", () => {
    const json = exportCompactionLogJson([
      entry({ ts: 1755900000000, tokensBefore: 90000, tokensAfter: 40000 }),
    ]);
    const parsed = JSON.parse(json);
    expect(parsed[0].savedTokens).toBe(50000);
    expect(json).toContain("set_cell_range");
  });
});
