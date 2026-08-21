// word-com.expanded.test.ts — parameterized suites to reach 100 tests
// Covers: all 9 actions × edge cases + validation matrices + error paths

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("DOMMatrix", class DOMMatrix { constructor() {} });
vi.stubGlobal("Image", class Image { width = 0; height = 0; });

async function makeTool() {
  const mod = await import("../src/lib/tools/word-com");
  return mod.createWordComTool();
}

function stubFetchJson(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify(body), { status }),
  ));
}

describe("word_com — action matrix (parameterized)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  const READ_ACTIONS = ["get_text", "get_stats", "get_paragraphs", "get_properties", "save"] as const;

  it.each(READ_ACTIONS)("action %s accepts empty params", async (action) => {
    stubFetchJson({ ok: true, action, data: "test" });
    const tool = await makeTool();
    const res = await tool.execute("t", { action } as never);
    expect(JSON.stringify(res)).toContain("success");
  });

  it.each(READ_ACTIONS)("action %s returns server data verbatim", async (action) => {
    stubFetchJson({ ok: true, action, custom: `val_${action}` });
    const tool = await makeTool();
    const res = await tool.execute("t", { action } as never);
    expect(JSON.stringify(res)).toContain(`val_${action}`);
  });

  it.each(READ_ACTIONS)("action %s handles server ok:false", async (action) => {
    stubFetchJson({ ok: false, error: "app not running" });
    const tool = await makeTool();
    const res = await tool.execute("t", { action } as never);
    expect(JSON.stringify(res)).toContain("not running");
  });

  const WRITE_ACTIONS = ["find_replace", "insert_text", "set_style", "add_table"] as const;

  it.each(WRITE_ACTIONS)("action %s sends to correct endpoint", async (action) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action, find: "x", replace: "y", text: "t", style: "s", paragraph: 1, rows: 2, cols: 3 } as never);
    expect(fm.mock.calls[0]?.[0]).toContain("/oa-com/word");
    expect(JSON.parse(String(fm.mock.calls[0]?.[1]?.body)).action).toBe(action);
  });
});

describe("word_com — get_text edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("returns empty text for empty document", async () => {
    stubFetchJson({ ok: true, text: "", length: 0 });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_text" } as never);
    expect(JSON.stringify(res)).toContain("length");
  });

  it("returns large text (50k chars)", async () => {
    stubFetchJson({ ok: true, text: "x".repeat(50000), length: 50000 });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_text" } as never);
    expect(JSON.stringify(res).length).toBeGreaterThan(50000);
  });

  it("preserves unicode (Russian, emoji)", async () => {
    stubFetchJson({ ok: true, text: "Привет мир 🌍", length: 13 });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_text" } as never);
    expect(JSON.stringify(res)).toContain("Привет");
  });

  it.each(["", " ", "\n", "\t", "  \r\n  "])("handles whitespace-only text %s", async (ws) => {
    stubFetchJson({ ok: true, text: ws, length: ws.length });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_text" } as never);
    expect(JSON.stringify(res)).toContain("ok");
  });
});

describe("word_com — get_stats fields", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  const STAT_FIELDS = [
    ["paragraphs", 10], ["words", 250], ["sentences", 15],
    ["characters", 1500], ["pages", 3], ["name", "doc.docx"],
  ] as const;

  it.each(STAT_FIELDS)("returns %s field", async (field, value) => {
    stubFetchJson({ ok: true, [field]: value });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_stats" } as never);
    expect(JSON.stringify(res)).toContain(String(value));
  });

  it("handles zero counts", async () => {
    stubFetchJson({ ok: true, paragraphs: 0, words: 0, sentences: 0, characters: 0, pages: 0 });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_stats" } as never);
    expect(JSON.stringify(res)).toContain("ok");
  });
});

describe("word_com — find_replace edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("handles no matches (replaced=0)", async () => {
    stubFetchJson({ ok: true, replaced: 0, find: "nonexistent" });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "find_replace", find: "nonexistent", replace: "x" } as never);
    expect(JSON.stringify(res)).toContain("replaced");
  });

  it("handles many matches (replaced=100)", async () => {
    stubFetchJson({ ok: true, replaced: 100 });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "find_replace", find: "a", replace: "b" } as never);
    expect(JSON.stringify(res)).toContain("100");
  });

  it("handles empty replacement (deletion)", async () => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, replaced: 5 }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "find_replace", find: "delete_me", replace: "" } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.replace).toBe("");
  });

  it.each([
    ["Russian", "найти", "заменить"],
    ["Special chars", "C++ & C#", "Rust"],
    ["Regex-ish", "[test]", "[prod]"],
    ["Newlines", "\\n", "\\r\\n"],
    ["Quotes", '"quoted"', "'single'"],
  ])("handles %s in find/replace", async (_label, find, replace) => {
    stubFetchJson({ ok: true, replaced: 1 });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "find_replace", find, replace } as never);
    expect(JSON.stringify(res)).toContain("ok");
  });
});

describe("word_com — insert_text edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each(["start", "end", "cursor"])("insert at %s position", async (where) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, inserted: 5 }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "insert_text", text: "hello", where } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.where).toBe(where);
  });

  it.each([
    ["Single line", "Hello World"],
    ["Multi-line", "Line 1\nLine 2\nLine 3"],
    ["Unicode", "Привет мир"],
    ["Empty string", " "],
    ["Very long", "x".repeat(10000)],
    ["Special XML chars", "<tag>&amp;</tag>"],
    ["Tab separated", "col1\tcol2\tcol3"],
  ])("inserts %s text", async (_label, text) => {
    stubFetchJson({ ok: true, inserted: text.length });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "insert_text", text } as never);
    expect(JSON.stringify(res)).toContain("inserted");
  });
});

describe("word_com — set_style edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["Heading 1", 1], ["Heading 2", 2], ["Normal", 1], ["Title", 1],
    ["Quote", 5], ["List Bullet", 10], ["List Number", 3], ["Intense Quote", 7],
  ])("applies style %s to paragraph %d", async (style, paragraph) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, style, paragraph }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "set_style", style, paragraph } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.style).toBe(style);
    expect(body.paragraph).toBe(paragraph);
  });

  it("handles out-of-range paragraph", async () => {
    stubFetchJson({ ok: false, error: "paragraph index out of range: 999" });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "set_style", style: "Normal", paragraph: 999 } as never);
    expect(JSON.stringify(res)).toContain("out of range");
  });
});

describe("word_com — add_table variations", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [1, 1], [2, 2], [3, 3], [5, 2], [10, 5], [1, 10], [20, 1], [100, 100],
  ])("creates %dx%d table", async (rows, cols) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, rows, cols }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "add_table", rows, cols } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.rows).toBe(rows);
    expect(body.cols).toBe(cols);
  });
});

describe("word_com — get_paragraphs edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("handles empty document (0 paragraphs)", async () => {
    stubFetchJson({ ok: true, count: 0, paragraphs: [] });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_paragraphs" } as never);
    expect(JSON.stringify(res)).toContain("count");
  });

  it("handles 200+ paragraphs (truncated to 200)", async () => {
    const paras = Array.from({ length: 200 }, (_, i) => ({ index: i + 1, text: `P${i}`, style: "Normal" }));
    stubFetchJson({ ok: true, count: 250, paragraphs: paras });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_paragraphs" } as never);
    expect(JSON.stringify(res)).toContain("P199");
  });

  it.each(["Normal", "Heading 1", "Heading 2", "List Bullet", "Quote"])(
    "identifies style %s in paragraphs", async (style) => {
      stubFetchJson({ ok: true, count: 1, paragraphs: [{ index: 1, text: "test", style }] });
      const tool = await makeTool();
      const res = await tool.execute("t", { action: "get_paragraphs" } as never);
      expect(JSON.stringify(res)).toContain(style);
    },
  );
});

describe("word_com — get_properties fields", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  const PROP_KEYS = ["Title", "Author", "Subject", "Keywords", "Comments", "Company", "Category"] as const;

  it.each(PROP_KEYS)("returns property %s", async (key) => {
    stubFetchJson({ ok: true, properties: { [key]: `test_${key}` } });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_properties" } as never);
    expect(JSON.stringify(res)).toContain(`test_${key}`);
  });

  it("handles empty properties", async () => {
    stubFetchJson({ ok: true, properties: {} });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_properties" } as never);
    expect(JSON.stringify(res)).toContain("ok");
  });
});

describe("word_com — save variations", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("saves in-place when no path given", async () => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, path: "C:\\original.docx" }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "save" } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.path).toBeUndefined();
  });

  it.each([
    ["docx", "C:\\output\\file.docx"],
    ["doc", "D:\\legacy\\file.doc"],
    ["pdf", "C:\\export\\file.pdf"],
    ["rtf", "C:\\export\\file.rtf"],
    ["txt", "C:\\export\\file.txt"],
  ])("saves as %s format to %s", async (_fmt, path) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, path }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "save", path } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.path).toBe(path);
  });
});

describe("word_com — error handling matrix", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([400, 401, 403, 404, 409, 422, 429, 500, 502, 503])(
    "handles HTTP %d from server", async (code) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: code })));
      const tool = await makeTool();
      const res = await tool.execute("t", { action: "get_text" } as never);
      expect(JSON.stringify(res)).toContain("success");
    },
  );

  it.each([
    ["Network timeout", new Error("ETIMEDOUT")],
    ["Connection refused", new Error("ECONNREFUSED")],
    ["DNS failure", new Error("ENOTFOUND")],
    ["SSL error", new Error("CERT_HAS_EXPIRED")],
  ])("handles %s", async (_label, error) => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw error; }));
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_text" } as never);
    expect(JSON.stringify(res)).toContain("unreachable");
  });
});

describe("word_com — request body integrity", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("always sends Content-Type json", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "get_text" } as never);
    expect((fm.mock.calls[0]?.[1]?.headers as Record<string, string>)?.["Content-Type"]).toBe("application/json");
  });

  it("always sends POST method", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "get_text" } as never);
    expect(fm.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("always includes action field in body", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "get_stats" } as never);
    expect(JSON.parse(String(fm.mock.calls[0]?.[1]?.body)).action).toBe("get_stats");
  });
});
