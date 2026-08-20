import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pbi_bridge agent tool: Desktop Bridge actions (manifest/state/screenshot/
// reload) via /oa-pbi/bridge. Screenshot payload lands in the VFS as a PNG
// so the model can view it with the read tool (we have vision).

describe("pbi_bridge tool", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  function stubFetchJson(map: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        for (const [key, val] of Object.entries(map)) {
          const [m, u] = key.split(" ");
          if (init?.method === m && url === u) {
            return new Response(JSON.stringify(val), { status: 200 });
          }
        }
        return new Response("{}", { status: 503 });
      }),
    );
  }

  it("reports disabled on 503", async () => {
    stubFetchJson({});
    const { createPbiBridgeTool } = await import("../src/lib/tools/pbi-bridge");
    const tool = createPbiBridgeTool({ writeFile: vi.fn() });
    const res = await tool.execute("t1", { action: "state" } as never);
    expect(JSON.stringify(res)).toContain("disabled");
  });

  it("state passthrough returns the server payload", async () => {
    stubFetchJson({
      "POST https://localhost:3000/oa-pbi/bridge": {
        ok: true,
        action: "state",
        result: { currentFilePath: "C:\\test.pbix" },
      },
    });
    const { createPbiBridgeTool } = await import("../src/lib/tools/pbi-bridge");
    const tool = createPbiBridgeTool({ writeFile: vi.fn() });
    const res = await tool.execute("t2", { action: "state" } as never);
    expect(JSON.stringify(res)).toContain("test.pbix");
  });

  it("screenshot writes the PNG into the VFS and returns the path", async () => {
    const writeFile = vi.fn(async () => undefined);
    stubFetchJson({
      "POST https://localhost:3000/oa-pbi/bridge": {
        ok: true,
        action: "screenshot",
        result: {
          payload: Buffer.from("fakepng").toString("base64"),
          mimeType: "image/png",
          encoding: "Base64",
          pageDisplayName: "Page 1",
        },
      },
    });
    const { createPbiBridgeTool } = await import("../src/lib/tools/pbi-bridge");
    const tool = createPbiBridgeTool({ writeFile });
    const res = await tool.execute("t3", { action: "screenshot" } as never);
    const text = JSON.stringify(res);
    expect(text).toContain("pbi-page");
    expect(writeFile).toHaveBeenCalled();
  });

  it("screenshot failure returns the server error without writing files", async () => {
    const writeFile = vi.fn(async () => undefined);
    stubFetchJson({
      "POST https://localhost:3000/oa-pbi/bridge": {
        ok: false,
        error: "pageId required",
      },
    });
    const { createPbiBridgeTool } = await import("../src/lib/tools/pbi-bridge");
    const tool = createPbiBridgeTool({ writeFile });
    const res = await tool.execute("t4", { action: "screenshot" } as never);
    expect(JSON.stringify(res)).toContain("pageId required");
    expect(writeFile).not.toHaveBeenCalled();
  });
});
