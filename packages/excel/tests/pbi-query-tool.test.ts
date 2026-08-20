import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pbi_query agent tool: proxies DAX to /oa-pbi/dax. Tests stub fetch.
// Implementation target: ../src/lib/tools/pbi-query.ts (written AFTER this).

describe("pbi_query tool", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("answers 'disabled' when desktop power tools are off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    const { createPbiQueryTool } = await import("../src/lib/tools/pbi-query");
    const tool = createPbiQueryTool();
    const res = await tool.execute("t1", { query: "EVALUATE 1" } as never);
    const text = JSON.stringify(res);
    expect(text).toContain("disabled");
  });

  it("returns columns and rows from the server payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string, init?: RequestInit) =>
          new Response(
            url.endsWith("/oa-pbi/dax")
              ? JSON.stringify({
                  ok: true,
                  columns: ["probe"],
                  rows: [[2]],
                  rowCount: 1,
                })
              : "{}",
            { status: 200 },
          ),
      ),
    );
    const { createPbiQueryTool } = await import("../src/lib/tools/pbi-query");
    const tool = createPbiQueryTool();
    const res = await tool.execute("t2", { query: "EVALUATE ROW(\"x\",1)" } as never);
    const text = JSON.stringify(res);
    expect(text).toContain("probe");
    expect(text).toContain("rowCount");
  });

  it("rejects queries without EVALUATE before calling the server", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { createPbiQueryTool } = await import("../src/lib/tools/pbi-query");
    const tool = createPbiQueryTool();
    const res = await tool.execute("t3", { query: "DROP TABLE x" } as never);
    expect(JSON.stringify(res)).toContain("must start with EVALUATE");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
