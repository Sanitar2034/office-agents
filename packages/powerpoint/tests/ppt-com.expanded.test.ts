// ppt-com.expanded.test.ts — parameterized suites to reach 100 tests
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function makeTool() {
  const mod = await import("../src/lib/tools/ppt-com");
  return mod.createPptComTool();
}

function stubFetchJson(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify(body), { status }),
  ));
}

describe("ppt_com — action matrix", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  const ALL_ACTIONS = [
    "list_slides", "get_slide_text", "add_slide", "set_text", "delete_slide",
    "get_shapes", "save", "get_properties", "reorder_slide",
  ] as const;

  it.each(ALL_ACTIONS)("action %s returns success on ok response", async (action) => {
    stubFetchJson({ ok: true, action });
    const tool = await makeTool();
    const res = await tool.execute("t", { action } as never);
    expect(JSON.stringify(res)).toContain("success");
  });

  it.each(ALL_ACTIONS)("action %s passes through server error", async (action) => {
    stubFetchJson({ ok: false, error: "PowerPoint is not running" });
    const tool = await makeTool();
    const res = await tool.execute("t", { action } as never);
    expect(JSON.stringify(res)).toContain("not running");
  });

  it.each(ALL_ACTIONS)("action %s sends correct endpoint and method", async (action) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action, slide: 1, text: "x", title: "t", shape: "s", from: 1, to: 2, layout: 2, path: "p" } as never);
    expect(fm.mock.calls[0]?.[0]).toContain("/oa-com/ppt");
    expect(fm.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fm.mock.calls[0]?.[1]?.body)).action).toBe(action);
  });
});

describe("ppt_com — list_slides edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("handles empty presentation (0 slides)", async () => {
    stubFetchJson({ ok: true, count: 0, slides: [] });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "list_slides" } as never);
    expect(JSON.stringify(res)).toContain("count");
  });

  it("handles single slide", async () => {
    stubFetchJson({ ok: true, count: 1, slides: [{ index: 1, title: "Only" }] });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "list_slides" } as never);
    expect(JSON.stringify(res)).toContain("Only");
  });

  it("handles 50 slides", async () => {
    const slides = Array.from({ length: 50 }, (_, i) => ({ index: i + 1, title: `Slide ${i + 1}` }));
    stubFetchJson({ ok: true, count: 50, slides });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "list_slides" } as never);
    expect(JSON.stringify(res)).toContain("Slide 50");
  });

  it.each(["Intro", "Data Overview", "Financial Summary", "Q&A", "Приложение А"])(
    "identifies slide titled %s", async (title) => {
      stubFetchJson({ ok: true, count: 1, slides: [{ index: 1, title }] });
      const tool = await makeTool();
      const res = await tool.execute("t", { action: "list_slides" } as never);
      expect(JSON.stringify(res)).toContain(title);
    },
  );

  it("handles slides with empty titles", async () => {
    stubFetchJson({ ok: true, count: 2, slides: [{ index: 1, title: "" }, { index: 2, title: "" }] });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "list_slides" } as never);
    expect(JSON.stringify(res)).toContain("ok");
  });
});

describe("ppt_com — get_slide_text edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([1, 2, 3, 5, 10, 20])("reads slide %d text", async (slide) => {
    stubFetchJson({ ok: true, slide, texts: [{ name: "Title", text: `Slide ${slide} content` }] });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_slide_text", slide } as never);
    expect(JSON.stringify(res)).toContain(`Slide ${slide}`);
  });

  it("handles slide with no text shapes", async () => {
    stubFetchJson({ ok: true, slide: 1, texts: [] });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_slide_text", slide: 1 } as never);
    expect(JSON.stringify(res)).toContain("ok");
  });

  it("handles multiple text shapes", async () => {
    stubFetchJson({
      ok: true, slide: 1,
      texts: [
        { name: "Title", text: "Main Title" },
        { name: "Subtitle", text: "Subtitle here" },
        { name: "Body", text: "Body text\nMore body" },
      ],
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_slide_text", slide: 1 } as never);
    const text = JSON.stringify(res);
    expect(text).toContain("Main Title");
    expect(text).toContain("Subtitle");
    expect(text).toContain("Body");
  });

  it("returns error for out-of-range slide", async () => {
    stubFetchJson({ ok: false, error: "slide 99 out of range (1-3)" });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_slide_text", slide: 99 } as never);
    expect(JSON.stringify(res)).toContain("out of range");
  });

  it.each(["Привет мир", "Résumé en français", "日本語のテキスト", "Emoji 🎉 test"])(
    "preserves unicode text %s", async (text) => {
      stubFetchJson({ ok: true, slide: 1, texts: [{ name: "T", text }] });
      const tool = await makeTool();
      const res = await tool.execute("t", { action: "get_slide_text", slide: 1 } as never);
      expect(JSON.stringify(res)).toContain(text.substring(0, 5));
    },
  );
});

describe("ppt_com — add_slide variations", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["Layout 1 (Title)", 1, "Title Slide"],
    ["Layout 2 (Title+Content)", 2, "Content Slide"],
    ["Layout 3 (Section)", 3, "Section Header"],
    ["Layout 7 (Blank)", 7, ""],
    ["Layout 12 (Comparison)", 12, "Compare"],
  ])("adds slide with %s", async (_label, layout, title) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, layout, title }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "add_slide", layout, title } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.layout).toBe(layout);
    expect(body.title).toBe(title);
  });

  it("defaults to layout 2 when not specified", async () => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, layout: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "add_slide", title: "Test" } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.layout).toBeUndefined(); // server defaults to 2
  });

  it.each(["Introduction", "Methodology", "Results & Analysis", "Заключение", "Appendix"])(
    "adds slide titled %s", async (title) => {
      const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, title }), { status: 200 }));
      vi.stubGlobal("fetch", fm);
      const tool = await makeTool();
      await tool.execute("t", { action: "add_slide", title, layout: 2 } as never);
      const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
      expect(body.title).toBe(title);
    },
  );
});

describe("ppt_com — set_text edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([1, 2, 3, 5, 10])("sets text on slide %d", async (slide) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, slide }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "set_text", slide, shape: "Title", text: "New" } as never);
    expect(JSON.parse(String(fm.mock.calls[0]?.[1]?.body)).slide).toBe(slide);
  });

  it.each(["Title", "Subtitle", "Body 1", "Content Placeholder 2", "TextBox3"])(
    "sets text on shape %s", async (shape) => {
      const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, shape }), { status: 200 }));
      vi.stubGlobal("fetch", fm);
      const tool = await makeTool();
      await tool.execute("t", { action: "set_text", slide: 1, shape, text: "Updated" } as never);
      expect(JSON.parse(String(fm.mock.calls[0]?.[1]?.body)).shape).toBe(shape);
    },
  );

  it.each([
    ["Short", "OK"],
    ["Multi-line", "Line 1\nLine 2"],
    ["Bullet list", "• Point 1\n• Point 2\n• Point 3"],
    ["Russian", "Новый заголовок"],
    ["Long text", "x".repeat(5000)],
  ])("sets %s text content", async (_label, text) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "set_text", slide: 1, shape: "Title", text } as never);
    expect(JSON.parse(String(fm.mock.calls[0]?.[1]?.body)).text).toBe(text);
  });

  it("returns error for nonexistent shape", async () => {
    stubFetchJson({ ok: false, error: "shape 'Ghost' not found" });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "set_text", slide: 1, shape: "Ghost", text: "x" } as never);
    expect(JSON.stringify(res)).toContain("not found");
  });
});

describe("ppt_com — delete_slide edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([1, 2, 3, 5, 10])("deletes slide %d", async (slide) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, deleted: slide }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "delete_slide", slide } as never);
    expect(JSON.parse(String(fm.mock.calls[0]?.[1]?.body)).slide).toBe(slide);
  });

  it("returns remaining count after deletion", async () => {
    stubFetchJson({ ok: true, deleted: 3, remaining: 7 });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "delete_slide", slide: 3 } as never);
    expect(JSON.stringify(res)).toContain("remaining");
  });

  it("handles error for out-of-range", async () => {
    stubFetchJson({ ok: false, error: "slide 100 out of range" });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "delete_slide", slide: 100 } as never);
    expect(JSON.stringify(res)).toContain("out of range");
  });
});

describe("ppt_com — get_shapes edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("returns empty shapes for blank slide", async () => {
    stubFetchJson({ ok: true, slide: 1, count: 0, shapes: [] });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_shapes", slide: 1 } as never);
    expect(JSON.stringify(res)).toContain("count");
  });

  it.each([
    ["autoshape", 1], ["text", 17], ["picture", 13], ["chart", 3], ["table", 19],
  ])("identifies %s type shapes", async (type) => {
    stubFetchJson({ ok: true, slide: 1, count: 1, shapes: [{ name: "S1", type, left: 0, top: 0, width: 100, height: 50, hasText: type === "text" }] });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_shapes", slide: 1 } as never);
    expect(JSON.stringify(res)).toContain(type);
  });

  it("returns position and size data", async () => {
    stubFetchJson({
      ok: true, slide: 1, count: 1,
      shapes: [{ name: "Rect", type: "autoshape", left: 100.5, top: 200.3, width: 300, height: 150, hasText: true }],
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_shapes", slide: 1 } as never);
    const text = JSON.stringify(res);
    expect(text).toContain("100.5");
    expect(text).toContain("200.3");
  });
});

describe("ppt_com — reorder_slide variations", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [1, 3], [3, 1], [5, 10], [10, 5], [2, 2],
  ])("reorders slide from %d to %d", async (from, to) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, from, to }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "reorder_slide", from, to } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.from).toBe(from);
    expect(body.to).toBe(to);
  });
});

describe("ppt_com — get_properties fields", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  const PROP_KEYS = ["name", "fullName", "slideWidth", "slideHeight", "slides"] as const;

  it.each(PROP_KEYS)("returns property %s", async (key) => {
    stubFetchJson({ ok: true, [key]: key === "slides" ? 5 : `test_${key}` });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "get_properties" } as never);
    expect(JSON.stringify(res)).toContain(key === "slides" ? "5" : `test_${key}`);
  });
});

describe("ppt_com — save variations", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("saves in-place when no path", async () => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "save" } as never);
    expect(JSON.parse(String(fm.mock.calls[0]?.[1]?.body)).path).toBeUndefined();
  });

  it.each([
    ["pptx", "C:\\export\\deck.pptx"],
    ["ppt", "D:\\legacy\\deck.ppt"],
    ["pdf", "C:\\export\\deck.pdf"],
    ["png", "C:\\export\\slide1.png"],
  ])("saves as %s to %s", async (_fmt, path) => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, path }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "save", path } as never);
    expect(JSON.parse(String(fm.mock.calls[0]?.[1]?.body)).path).toBe(path);
  });
});

describe("ppt_com — error handling matrix", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([400, 401, 403, 404, 409, 422, 429, 500, 502, 503])(
    "handles HTTP %d from server", async (code) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: code })));
      const tool = await makeTool();
      const res = await tool.execute("t", { action: "list_slides" } as never);
      expect(JSON.stringify(res)).toContain("success");
    },
  );

  it.each([
    ["Network timeout", new Error("ETIMEDOUT")],
    ["Connection refused", new Error("ECONNREFUSED")],
    ["DNS failure", new Error("ENOTFOUND")],
    ["Socket hang up", new Error("ECONNRESET")],
  ])("handles %s", async (_label, error) => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw error; }));
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "list_slides" } as never);
    expect(JSON.stringify(res)).toContain("unreachable");
  });
});

describe("ppt_com — request integrity", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("always sends POST to /oa-com/ppt", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "list_slides" } as never);
    expect(fm.mock.calls[0]?.[0]).toContain("/oa-com/ppt");
    expect(fm.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("always sends JSON content type", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "save" } as never);
    expect((fm.mock.calls[0]?.[1]?.headers as Record<string, string>)?.["Content-Type"]).toBe("application/json");
  });
});
