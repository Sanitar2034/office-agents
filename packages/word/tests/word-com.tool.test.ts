// word-com.tool.test.ts - comprehensive test suite for the Word COM tool
// Covers: all 9 actions, validation, disabled contract, error passthrough,
// fetch stubbing, payload shapes, edge cases

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// polyfill browser APIs pulled in by @office-agents/core (via types.ts)
vi.stubGlobal("DOMMatrix", class DOMMatrix { constructor() {} });
vi.stubGlobal("Image", class Image { width = 0; height = 0; });

// Factory to create the tool fresh per test group
async function makeTool() {
  const mod = await import("../src/lib/tools/word-com");
  return mod.createWordComTool();
}

function stubFetchJson(map: Record<string, { status?: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      for (const [key, val] of Object.entries(map)) {
        const [m, u] = key.split(" ");
        if (init?.method === m && url === u) {
          return new Response(JSON.stringify(val.body), {
            status: val.status ?? 200,
          });
        }
      }
      return new Response("{}", { status: 503 });
    }),
  );
}

describe("word_com tool — gating", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("reports disabled on 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_text" } as never);
    expect(JSON.stringify(res)).toContain("disabled");
  });

  it("reports offline on network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_text" } as never);
    expect(JSON.stringify(res)).toContain("unreachable");
  });
});

describe("word_com tool — validation", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["get_text", {}],
    ["get_stats", {}],
    ["get_paragraphs", {}],
    ["get_properties", {}],
    ["save", {}],
  ])("action %s works with no extra params", async (action) => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/word": { body: { ok: true, action } },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action } as never);
    expect(JSON.stringify(res)).toContain("ok");
  });

  it("find_replace requires find param", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "find_replace" } as never);
    expect(JSON.stringify(res)).toContain("find is required");
    expect(fm).not.toHaveBeenCalled();
  });

  it("find_replace with find and replace works", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/word": { body: { ok: true, replaced: 3 } },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "find_replace", find: "a", replace: "b" } as never);
    expect(JSON.stringify(res)).toContain("replaced");
  });

  it("insert_text requires text param", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "insert_text" } as never);
    expect(JSON.stringify(res)).toContain("text is required");
  });

  it("insert_text with text works", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/word": { body: { ok: true, inserted: 5 } },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "insert_text", text: "hello" } as never);
    expect(JSON.stringify(res)).toContain("inserted");
  });

  it("insert_text respects where param (start/end/cursor)", async () => {
    const fm = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, inserted: 1 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "insert_text", text: "x", where: "start" } as never);
    const call = fm.mock.calls[0];
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.where).toBe("start");
  });

  it("set_style requires style and paragraph", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    const r1 = await tool.execute("t", { action: "set_style" } as never);
    expect(JSON.stringify(r1)).toContain("style is required");
    const r2 = await tool.execute("t", { action: "set_style", style: "Heading 1" } as never);
    expect(JSON.stringify(r2)).toContain("paragraph is required");
  });

  it("add_table validates rows and cols", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/word": { body: { ok: true, rows: 3, cols: 4 } },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "add_table", rows: 3, cols: 4 } as never);
    expect(JSON.stringify(res)).toContain("rows");
  });

  it("rejects unknown action client-side", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "hack_the_doc" } as never);
    expect(JSON.stringify(res)).toContain("Unknown action");
    expect(fm).not.toHaveBeenCalled();
  });
});

describe("word_com tool — payload passthrough", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("get_text returns the document text", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/word": {
        body: { ok: true, text: "Hello World", length: 11 },
      },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_text" } as never);
    expect(JSON.stringify(res)).toContain("Hello World");
  });

  it("get_stats returns paragraph and word counts", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/word": {
        body: { ok: true, paragraphs: 5, words: 100, pages: 2 },
      },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_stats" } as never);
    const text = JSON.stringify(res);
    expect(text).toContain("paragraphs");
    expect(text).toContain("100");
  });

  it("get_properties returns built-in properties", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/word": {
        body: { ok: true, properties: { Title: "My Doc", Author: "IA" } },
      },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_properties" } as never);
    expect(JSON.stringify(res)).toContain("My Doc");
  });

  it("get_paragraphs returns indexed list", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/word": {
        body: { ok: true, count: 2, paragraphs: [{ index: 1, text: "First" }, { index: 2, text: "Second" }] },
      },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_paragraphs" } as never);
    expect(JSON.stringify(res)).toContain("First");
    expect(JSON.stringify(res)).toContain("Second");
  });

  it("error from server is passed through", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/word": {
        body: { ok: false, error: "Word is not running" },
      },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_text" } as never);
    expect(JSON.stringify(res)).toContain("not running");
  });
});

describe("word_com tool — request body construction", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["find_replace", { find: "old", replace: "new" }, { find: "old", replace: "new" }],
    ["insert_text", { text: "hello", where: "end" }, { text: "hello", where: "end" }],
    ["set_style", { style: "Heading 1", paragraph: 3 }, { style: "Heading 1", paragraph: 3 }],
    ["add_table", { rows: 5, cols: 3 }, { rows: 5, cols: 3 }],
  ])("sends correct body for %s", async (action, params, expectedInBody) => {
    const fm = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action, ...params } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    for (const [k, v] of Object.entries(expectedInBody)) {
      expect(body[k]).toBe(v);
    }
  });
});
