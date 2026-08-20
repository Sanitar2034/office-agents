import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The com_bridge agent tool proxies to the offline server's /oa-com/*
// endpoints. Tests stub global fetch; production code must live in
// ../src/lib/tools/com-bridge.ts (this file is written FIRST - TDD).

describe("com_bridge tool", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(responses: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const key = `${init?.method ?? "GET"} ${url} ${JSON.stringify(body)}`;
        const hit = Object.entries(responses).find(([k]) => {
          const [m, u] = k.split(" ");
          return init?.method === m && url === u;
        });
        if (!hit) throw new Error(`unexpected fetch: ${key}`);
        return new Response(JSON.stringify(hit[1]), { status: 200 });
      }),
    );
  }

  it("reports 'disabled' when the bridge is off", async () => {
    stubFetch({
      "POST https://localhost:3000/oa-com/status": { enabled: false },
    });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t1", { action: "status" } as never);
    const text = JSON.stringify(res);
    expect(text).toContain("disabled");
    expect(text).toContain("success");
  });

  it("proxies pq_list and returns the server payload", async () => {
    stubFetch({
      "POST https://localhost:3000/oa-com/status": {
        enabled: true,
        excelRunning: true,
      },
      "POST https://localhost:3000/oa-com/pq-list": {
        ok: true,
        count: 1,
        queries: [{ name: "Main", formula: "let src=1 in src" }],
      },
    });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t2", { action: "pq_list" } as never);
    expect(JSON.stringify(res)).toContain("Main");
  });

  it("rejects unknown actions without touching the server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t3", { action: "nope" } as never);
    expect(JSON.stringify(res)).toContain("Unknown action");
  });
});
