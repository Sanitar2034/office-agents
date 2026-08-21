import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function makeTool() {
  const mod = await import("../src/lib/tools/ppt-com");
  return mod.createPptComTool();
}

function stubFetchJson(map: Record<string, { status?: number; body: unknown }>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    for (const [key, val] of Object.entries(map)) {
      const [m, u] = key.split(" ");
      if (init?.method === m && url === u) {
        return new Response(JSON.stringify(val.body), { status: val.status ?? 200 });
      }
    }
    return new Response("{}", { status: 503 });
  }));
}

describe("ppt_com tool", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("reports disabled on 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "list_slides" } as never);
    expect(JSON.stringify(res)).toContain("disabled");
  });

  it("reports offline on network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "list_slides" } as never);
    expect(JSON.stringify(res)).toContain("unreachable");
  });

  it("rejects unknown action client-side", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "explode" } as never);
    expect(JSON.stringify(res)).toContain("Unknown action");
    expect(fm).not.toHaveBeenCalled();
  });

  it.each(["list_slides", "get_slide_text", "get_shapes", "get_properties", "save"])(
    "action %s works with defaults", async (action) => {
      stubFetchJson({ "POST https://localhost:3000/oa-com/ppt": { body: { ok: true, action } } });
      const tool = await makeTool();
      const res = await tool.execute("t", { action } as never);
      expect(JSON.stringify(res)).toContain("ok");
    },
  );

  it("list_slides returns slide data", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/ppt": {
        body: { ok: true, count: 3, slides: [{ index: 1, title: "Intro" }, { index: 2, title: "Data" }, { index: 3 }] },
      },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "list_slides" } as never);
    const text = JSON.stringify(res);
    expect(text).toContain("Intro");
    expect(text).toContain("count");
  });

  it("add_slide sends title and layout", async () => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, index: 4 }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "add_slide", title: "New Slide", layout: 2 } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.title).toBe("New Slide");
    expect(body.layout).toBe(2);
  });

  it("set_text sends slide and shape", async () => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "set_text", slide: 2, shape: "Title", text: "Hello" } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.slide).toBe(2);
    expect(body.shape).toBe("Title");
    expect(body.text).toBe("Hello");
  });

  it("delete_slide sends slide index", async () => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true, deleted: 3 }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "delete_slide", slide: 3 } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.slide).toBe(3);
  });

  it("reorder_slide sends from and to", async () => {
    const fm = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const tool = await makeTool();
    await tool.execute("t", { action: "reorder_slide", from: 1, to: 3 } as never);
    const body = JSON.parse(String(fm.mock.calls[0]?.[1]?.body));
    expect(body.from).toBe(1);
    expect(body.to).toBe(3);
  });

  it("error from server is passed through", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-com/ppt": { body: { ok: false, error: "PowerPoint is not running" } },
    });
    const tool = await makeTool();
    const res = await tool.execute("t", { action: "list_slides" } as never);
    expect(JSON.stringify(res)).toContain("not running");
  });
});
