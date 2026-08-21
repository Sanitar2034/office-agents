import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pbi_execute_tmsl: TMSL/XMLA commands (CREATE/ALTER/DELETE tables, measures)
// pbi_dmv: DMV system views (TMSCHEMA_*)
// pbi_model: TOM model introspection (list tables/columns/measures/relationships)

describe("pbi_execute_tmsl tool", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("answers disabled on 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const { createPbiExecuteTmslTool } = await import("../src/lib/tools/pbi-execute-tmsl");
    const tool = createPbiExecuteTmslTool();
    const res = await tool.execute("t", { command: '{"create":{}}' } as never);
    expect(JSON.stringify(res)).toContain("disabled");
  });

  it("rejects empty command before calling the server", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const { createPbiExecuteTmslTool } = await import("../src/lib/tools/pbi-execute-tmsl");
    const tool = createPbiExecuteTmslTool();
    const res = await tool.execute("t", { command: "" } as never);
    expect(JSON.stringify(res)).toContain("non-empty TMSL");
    expect(fm).not.toHaveBeenCalled();
  });

  it("passes through the server payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, response: "<return/>" }), { status: 200 }),
      ),
    );
    const { createPbiExecuteTmslTool } = await import("../src/lib/tools/pbi-execute-tmsl");
    const tool = createPbiExecuteTmslTool();
    const res = await tool.execute("t", { command: '{"create":{}}' } as never);
    expect(JSON.stringify(res)).toContain("ok");
  });
});

describe("pbi_dmv tool", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("answers disabled on 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const { createPbiDmvTool } = await import("../src/lib/tools/pbi-dmv");
    const tool = createPbiDmvTool();
    const res = await tool.execute("t", { query: "SELECT * FROM $SYSTEM.TMSCHEMA_TABLES" } as never);
    expect(JSON.stringify(res)).toContain("disabled");
  });

  it("requires SELECT-only DMV queries", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const { createPbiDmvTool } = await import("../src/lib/tools/pbi-dmv");
    const tool = createPbiDmvTool();
    const res = await tool.execute("t", { query: "DROP TABLE x" } as never);
    expect(JSON.stringify(res)).toContain("must start with SELECT");
    expect(fm).not.toHaveBeenCalled();
  });

  it("passes through the server payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ ok: true, columns: ["Name"], rows: [["t1"]], rowCount: 1 }),
          { status: 200 },
        ),
      ),
    );
    const { createPbiDmvTool } = await import("../src/lib/tools/pbi-dmv");
    const tool = createPbiDmvTool();
    const res = await tool.execute("t", { query: "SELECT Name FROM $SYSTEM.TMSCHEMA_TABLES" } as never);
    expect(JSON.stringify(res)).toContain("t1");
  });
});
