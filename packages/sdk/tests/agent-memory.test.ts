import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendAgentMemory,
  buildMemorySection,
  getAgentMemory,
  setAgentMemory,
} from "../src/storage/agent-memory";
import { createMemoryTool } from "../src/tools/memory";

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
    removeItem: (k: string) => map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("agent memory storage", () => {
  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    try {
      (g.localStorage as Storage)?.clear();
    } catch {
      // not present
    }
  });

  it("round-trips and clears", () => {
    const s = memStorage();
    setAgentMemory(ns, "prefers rubles", s);
    expect(getAgentMemory(ns, s)).toBe("prefers rubles");
    setAgentMemory(ns, "", s);
    expect(getAgentMemory(ns, s)).toBe("");
  });

  it("caps stored memory at 16000 chars", () => {
    const s = memStorage();
    setAgentMemory(ns, "x".repeat(20000), s);
    expect(getAgentMemory(ns, s).length).toBe(16000);
  });

  it("append adds a dated line without duplicating it back-to-back", () => {
    const s = memStorage();
    appendAgentMemory(ns, "User prefers concise reports", s);
    appendAgentMemory(ns, "User prefers concise reports", s);
    const value = getAgentMemory(ns, s);
    expect(value.match(/User prefers concise reports/g)?.length).toBe(1);
    appendAgentMemory(ns, "Fiscal year starts in April", s);
    expect(getAgentMemory(ns, s)).toContain("Fiscal year starts in April");
  });

  it("section builder renders a prompt block only for non-empty memory", () => {
    expect(buildMemorySection("")).toBe("");
    const section = buildMemorySection("- prefers tables");
    expect(section).toContain("## Agent Memory");
    expect(section).toContain("- prefers tables");
  });
});

describe("memory_write tool", () => {
  it("append mode stores the fact and reports the size", async () => {
    const g = globalThis as Record<string, unknown>;
    const s = memStorage();
    g.localStorage = s;
    try {
      const tool = createMemoryTool(ns);
      const res = await tool.execute("t1", {
        content: "Reports in Russian",
        mode: "append",
      });
      const text = res.content[0] as { type: string; text?: string };
      const parsed = JSON.parse(text.text ?? "{}");
      expect(parsed.ok).toBe(true);
      expect(getAgentMemory(ns, s)).toContain("Reports in Russian");
    } finally {
      delete g.localStorage;
    }
  });

  it("replace mode swaps the whole memory; empty content is rejected", async () => {
    const g = globalThis as Record<string, unknown>;
    const s = memStorage();
    g.localStorage = s;
    try {
      setAgentMemory(ns, "old", s);
      const tool = createMemoryTool(ns);
      await tool.execute("t1", { content: "brand new memory", mode: "replace" });
      expect(getAgentMemory(ns, s)).toBe("brand new memory");

      const bad = await tool.execute("t2", { content: "   ", mode: "append" });
      const text = bad.content[0] as { type: string; text?: string };
      expect(JSON.parse(text.text ?? "{}").success).toBe(false);
    } finally {
      delete g.localStorage;
    }
  });
});
