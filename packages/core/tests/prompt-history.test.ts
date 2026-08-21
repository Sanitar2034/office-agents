import { describe, expect, it } from "vitest";
import {
  addPrompt,
  loadPromptHistory,
  recallDown,
  recallUp,
  savePromptHistory,
  type BrowseState,
} from "../src/chat/prompt-history";

const live: BrowseState = { index: -1, draft: "" };

function memStorage(): Storage & { dump(): string } {
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
    dump: () => map.get("office-agents.prompt-history.v1") ?? "",
  } as Storage & { dump(): string };
}

describe("addPrompt", () => {
  it("prepends the prompt and trims whitespace", () => {
    expect(addPrompt([], "  hello  ")).toEqual(["hello"]);
    expect(addPrompt(["hello"], "world")).toEqual(["world", "hello"]);
  });

  it("ignores empty and whitespace-only input", () => {
    expect(addPrompt([], "   ")).toEqual([]);
    expect(addPrompt(["x"], "")).toEqual(["x"]);
  });

  it("does not duplicate consecutive repeats", () => {
    expect(addPrompt(["same"], "same")).toEqual(["same"]);
  });

  it("caps the history at the limit, dropping the oldest", () => {
    let entries: string[] = [];
    for (let i = 1; i <= 5; i++) entries = addPrompt(entries, `p${i}`, 3);
    expect(entries).toEqual(["p5", "p4", "p3"]);
  });
});

describe("recallUp / recallDown", () => {
  const entries = ["newest", "middle", "oldest"];

  it("returns the newest entry from live input and stores the draft", () => {
    const r = recallUp(entries, live, "half-typed draft");
    expect(r.text).toBe("newest");
    expect(r.browse).toEqual({ index: 0, draft: "half-typed draft" });
  });

  it("walks further back on repeated Up", () => {
    const r1 = recallUp(entries, live, "");
    const r2 = recallUp(entries, r1.browse, r1.text);
    const r3 = recallUp(entries, r2.browse, r2.text);
    expect(r2.text).toBe("middle");
    expect(r3.text).toBe("oldest");
  });

  it("stays on the oldest entry at the top of the history", () => {
    const r1 = recallUp(entries, live, "");
    const r2 = recallUp(entries, r1.browse, r1.text);
    const r3 = recallUp(entries, r2.browse, r2.text);
    const r4 = recallUp(entries, r3.browse, r3.text);
    expect(r4.text).toBe("oldest");
    expect(r4.browse.index).toBe(2);
  });

  it("Down walks forward and finally restores the draft", () => {
    const up1 = recallUp(entries, live, "draft");
    const up2 = recallUp(entries, up1.browse, up1.text); // standing on "middle"
    const down1 = recallDown(entries, up2.browse, up2.text);
    expect(down1.text).toBe("newest");
    const down2 = recallDown(entries, down1.browse, down1.text);
    expect(down2.text).toBe("draft");
    expect(down2.browse.index).toBe(-1);
    const down3 = recallDown(entries, down2.browse, down2.text);
    expect(down3.text).toBe("draft"); // no-op once back live
  });

  it("Down is a no-op while live editing (not browsing)", () => {
    const r = recallDown(entries, live, "current text");
    expect(r.text).toBe("current text");
    expect(r.browse).toEqual(live);
  });

  it("Up on an empty history is a no-op", () => {
    const r = recallUp([], live, "typed");
    expect(r.text).toBe("typed");
    expect(r.browse).toEqual(live);
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const storage = memStorage();
    savePromptHistory(storage, ["a", "b"]);
    expect(loadPromptHistory(storage)).toEqual(["a", "b"]);
    expect(JSON.parse(storage.dump())).toEqual(["a", "b"]);
  });

  it("returns an empty list for missing or corrupt data", () => {
    const storage = memStorage();
    expect(loadPromptHistory(storage)).toEqual([]);
    storage.setItem("office-agents.prompt-history.v1", "{not json");
    expect(loadPromptHistory(storage)).toEqual([]);
  });

  it("survives a null storage (private mode)", () => {
    savePromptHistory(null, ["a"]);
    expect(loadPromptHistory(null)).toEqual([]);
  });
});
