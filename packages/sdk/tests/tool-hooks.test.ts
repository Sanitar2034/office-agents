import { describe, expect, it } from "vitest";
import {
  loadToolHooks,
  matchToolHook,
  saveToolHooks,
  validateHookRules,
  type ToolHookRule,
} from "../src/tool-hooks";

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

describe("validateHookRules", () => {
  it("accepts well-formed rules and rejects malformed ones", () => {
    const good = validateHookRules([
      { toolPattern: "pbi_*", action: "block", note: "no BI changes" },
      { toolPattern: "set_cell_range", action: "log" },
    ]);
    expect(good.rules).toHaveLength(2);
    expect(good.errors).toEqual([]);

    const bad = validateHookRules([
      { toolPattern: "", action: "block" },
      { toolPattern: "x", action: "explode" },
      "nonsense",
    ] as unknown as ToolHookRule[]);
    expect(bad.rules).toHaveLength(0);
    expect(bad.errors).toHaveLength(3);
  });
});

describe("matchToolHook", () => {
  const rules: ToolHookRule[] = [
    { toolPattern: "pbi_*", action: "block", note: "BI locked" },
    { toolPattern: "set_cell_range", action: "log" },
  ];

  it("matches exact names and glob patterns", () => {
    expect(matchToolHook("pbi_execute_tmsl", rules)?.action).toBe("block");
    expect(matchToolHook("set_cell_range", rules)?.action).toBe("log");
    expect(matchToolHook("pbi_query", rules)?.action).toBe("block");
  });

  it("returns null for unmatched or non-matching tools", () => {
    expect(matchToolHook("get_cell_ranges", rules)).toBeNull();
    expect(matchToolHook("pbiX", rules)).toBeNull();
  });

  it("first matching rule wins (order matters)", () => {
    const ordered: ToolHookRule[] = [
      { toolPattern: "pbi_query", action: "log" },
      { toolPattern: "pbi_*", action: "block" },
    ];
    expect(matchToolHook("pbi_query", ordered)?.action).toBe("log");
    expect(matchToolHook("pbi_dmv", ordered)?.action).toBe("block");
  });
});

describe("persistence", () => {
  it("round-trips rules and survives corrupt JSON", () => {
    const s = memStorage();
    saveToolHooks(ns, [{ toolPattern: "bash", action: "log" }], s);
    expect(loadToolHooks(ns, s)).toEqual([
      { toolPattern: "bash", action: "log" },
    ]);

    s.setItem("office-agents-tool-hooks", "{broken");
    expect(loadToolHooks(ns, s)).toEqual([]);
  });
});
