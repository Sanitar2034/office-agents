// excel-com.expanded.test.ts — parameterized COM + PBI tool tests
// Brings excel COM module to 100+ and covers all bridge tools

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubFetchJson(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify(body), { status }),
  ));
}

// === COM BRIDGE (com_bridge) ===

describe("com_bridge — action matrix", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  const ACTIONS = ["status", "run_macro", "pq_list", "pq_refresh_all", "pq_edit"] as const;

  it.each(ACTIONS)("action %s returns success on ok", async (action) => {
    stubFetchJson({ ok: true, action });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t", { action } as never);
    expect(JSON.stringify(res)).toContain("success");
  });

  it.each(ACTIONS)("action %s handles server error", async (action) => {
    stubFetchJson({ ok: false, error: "Excel is not running" });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t", { action } as never);
    expect(JSON.stringify(res)).toContain("not running");
  });

  it.each(ACTIONS)("action %s maps underscore to hyphen in URL", async (action) => {
    const fm = vi.fn(async () =>
      new Response(JSON.stringify({ enabled: true, ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fm);
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    await tool.execute("t", { action, macro: "M", name: "q", formula: "let x=1 in x" } as never);
    const url = String(fm.mock.calls[0]?.[0]);
    if (action.includes("_")) {
      expect(url).toContain(action.replace(/_/g, "-"));
    }
  });
});

describe("com_bridge — run_macro edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["Simple name", "MyMacro"],
    ["Qualified", "Module1.MyMacro"],
    ["Workbook qualified", "Workbook.xlsm!MyMacro"],
    ["With args name", "ProcessData"],
    ["Russian name", "МойМакрос"],
  ])("sends macro %s", async (_label, macro) => {
    const fm = vi.fn(async () =>
      new Response(JSON.stringify({ enabled: true, ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fm);
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    await tool.execute("t", { action: "run_macro", macro } as never);
    const body = JSON.parse(String(fm.mock.calls[fm.mock.calls.length - 1]?.[1]?.body));
    expect(body.macro).toBe(macro);
  });

  it.each([["single arg", [42]], ["multiple args", [1, "two", true]], ["no args", undefined]])(
    "run_macro with %s", async (_label, args) => {
      const fm = vi.fn(async () =>
        new Response(JSON.stringify({ enabled: true, ok: true, result: args }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fm);
      const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
      const tool = createComBridgeTool();
      const params: Record<string, unknown> = { action: "run_macro", macro: "M" };
      if (args) params.args = args;
      await tool.execute("t", params as never);
      const body = JSON.parse(String(fm.mock.calls[fm.mock.calls.length - 1]?.[1]?.body));
      expect(body.macro).toBe("M");
    },
  );
});

describe("com_bridge — pq_list edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("returns empty list for no queries", async () => {
    stubFetchJson({ ok: true, count: 0, queries: [] });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t", { action: "pq_list" } as never);
    expect(JSON.stringify(res)).toContain("count");
  });

  it("returns query names and M formulas", async () => {
    stubFetchJson({
      ok: true, count: 2,
      queries: [
        { name: "SalesData", formula: "let Source = Csv.Document(...) in Source" },
        { name: "Filter2024", formula: "let Prev = SalesData, F = Table.SelectRows(...) in F" },
      ],
    });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t", { action: "pq_list" } as never);
    const text = JSON.stringify(res);
    expect(text).toContain("SalesData");
    expect(text).toContain("Csv.Document");
  });

  it.each(["Sales", "Inventory", "HR_Data", "Финансы"])("identifies query %s", async (name) => {
    stubFetchJson({ ok: true, count: 1, queries: [{ name, formula: "let x=1 in x" }] });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t", { action: "pq_list" } as never);
    expect(JSON.stringify(res)).toContain(name);
  });
});

describe("com_bridge — pq_edit edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["Simple query", "TestQ", "let x = 1 in x"],
    ["CSV source", "CSV", 'let Source = Csv.Document(File.Contents("C:\\data.csv")) in Source'],
    ["SQL source", "SQL", 'let Source = Sql.Database("srv", "db") in Source'],
    ["Chained", "Chained", "let A = Step1, B = Step2(A) in B"],
    ["Russian name", "Данные", "let Источник = Excel.CurrentWorkbook() in Источник"],
  ])("creates/updates query %s", async (_label, name, formula) => {
    const fm = vi.fn(async () =>
      new Response(JSON.stringify({ enabled: true, ok: true, name, action: "created" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fm);
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    await tool.execute("t", { action: "pq_edit", name, formula } as never);
    const body = JSON.parse(String(fm.mock.calls[fm.mock.calls.length - 1]?.[1]?.body));
    expect(body.name).toBe(name);
    expect(body.formula).toBe(formula);
  });

  it("distinguishes created vs updated", async () => {
    stubFetchJson({ ok: true, name: "Q", action: "updated" });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t", { action: "pq_edit", name: "Q", formula: "let x=2 in x" } as never);
    expect(JSON.stringify(res)).toContain("updated");
  });
});

describe("com_bridge — pq_refresh_all edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("returns success with workbook name", async () => {
    stubFetchJson({ ok: true, workbook: "data.xlsx" });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t", { action: "pq_refresh_all" } as never);
    expect(JSON.stringify(res)).toContain("data.xlsx");
  });

  it("handles refresh timeout", async () => {
    stubFetchJson({ ok: false, error: "refresh timeout after 120s" });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t", { action: "pq_refresh_all" } as never);
    expect(JSON.stringify(res)).toContain("timeout");
  });
});

describe("com_bridge — status edge cases", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["enabled + running", true, true, "Book1.xlsx"],
    ["enabled + not running", true, false, null],
    ["disabled + running", false, true, "Book1.xlsx"],
    ["disabled + not running", false, false, null],
  ])("status: %s", async (_label, enabled, running, workbook) => {
    stubFetchJson({ enabled, excelRunning: running, workbook });
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t", { action: "status" } as never);
    const text = JSON.stringify(res);
    expect(text).toContain(String(running));
  });
});

// === PBI TOOLS ===

describe("pbi_query — expanded", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["Scalar", "EVALUATE ROW(\"x\", 1+1)"],
    ["Table literal", "EVALUATE {1,2,3}"],
    ["Table reference", "EVALUATE Sales"],
    ["Filter", "EVALUATE FILTER(Sales, Sales[Amount] > 100)"],
    ["Summarize", "EVALUATE SUMMARIZE(Sales, Sales[Year], \"Total\", SUM(Sales[Amount]))"],
    ["Calculate", "EVALUATE CALCULATE(SUM(Sales[Amount]), Sales[Year] = 2024)"],
    ["TopN", "EVALUATE TOPN(10, Sales, Sales[Amount])"],
    ["AddColumns", "EVALUATE ADDCOLUMNS(Sales, \"Double\", Sales[Amount] * 2)"],
  ])("executes %s DAX query", async (_label, query) => {
    stubFetchJson({ ok: true, columns: ["Result"], rows: [[42]], rowCount: 1 });
    const { createPbiQueryTool } = await import("../src/lib/tools/pbi-query");
    const tool = createPbiQueryTool();
    const res = await tool.execute("t", { query } as never);
    expect(JSON.stringify(res)).toContain("success");
  });

  it.each([
    "DROP TABLE Sales",
    "INSERT INTO Sales VALUES (1)",
    "UPDATE Sales SET Amount = 0",
    "DELETE FROM Sales",
    "CREATE TABLE Test (id INT)",
    "EXEC some_stored_proc",
  ])("rejects non-EVALUATE query: %s", async (query) => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const { createPbiQueryTool } = await import("../src/lib/tools/pbi-query");
    const tool = createPbiQueryTool();
    const res = await tool.execute("t", { query } as never);
    expect(JSON.stringify(res)).toContain("must start with EVALUATE");
    expect(fm).not.toHaveBeenCalled();
  });

  it.each([
    ["Russian column", 'EVALUATE ROW("Сумма", SUM(S[Сумма]))'],
    ["Special chars", 'EVALUATE ROW("C++&C#", 1)'],
    ["Spaces in name", 'EVALUATE ROW("Total Sales", 100)'],
    ["Long query", `EVALUATE SUMMARIZECOLUMNS(${Array.from({length: 20}, (_, i) => `S[Col${i}]`).join(", ")})`],
  ])("handles %s query", async (_label, query) => {
    stubFetchJson({ ok: true, columns: ["x"], rows: [[1]], rowCount: 1 });
    const { createPbiQueryTool } = await import("../src/lib/tools/pbi-query");
    const tool = createPbiQueryTool();
    const res = await tool.execute("t", { query } as never);
    expect(JSON.stringify(res)).toContain("success");
  });
});

describe("pbi_dmv — expanded", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["TMSCHEMA_TABLES", "SELECT * FROM $SYSTEM.TMSCHEMA_TABLES"],
    ["TMSCHEMA_COLUMNS", "SELECT * FROM $SYSTEM.TMSCHEMA_COLUMNS"],
    ["TMSCHEMA_MEASURES", "SELECT * FROM $SYSTEM.TMSCHEMA_MEASURES"],
    ["TMSCHEMA_RELATIONSHIPS", "SELECT * FROM $SYSTEM.TMSCHEMA_RELATIONSHIPS"],
    ["TMSCHEMA_PARTITIONS", "SELECT * FROM $SYSTEM.TMSCHEMA_PARTITIONS"],
    ["TMSCHEMA_HIERARCHIES", "SELECT * FROM $SYSTEM.TMSCHEMA_HIERARCHIES"],
    ["DISCOVER_STORAGE_TABLES", "SELECT * FROM $SYSTEM.DISCOVER_STORAGE_TABLES"],
    ["DISCOVER_XML_METADATA", "SELECT * FROM $SYSTEM.DISCOVER_XML_METADATA"],
  ])("queries %s view", async (_view, query) => {
    stubFetchJson({ ok: true, columns: ["Name"], rows: [["Test"]], rowCount: 1 });
    const { createPbiDmvTool } = await import("../src/lib/tools/pbi-dmv");
    const tool = createPbiDmvTool();
    const res = await tool.execute("t", { query } as never);
    expect(JSON.stringify(res)).toContain("success");
  });

  it.each([
    "DROP TABLE $SYSTEM.TMSCHEMA_TABLES",
    "INSERT INTO $SYSTEM.TMSCHEMA_TABLES VALUES (1)",
    "UPDATE $SYSTEM.TMSCHEMA_TABLES SET Name = 'x'",
    "EXEC xp_cmdshell 'dir'",
  ])("rejects non-SELECT DMV: %s", async (query) => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const { createPbiDmvTool } = await import("../src/lib/tools/pbi-dmv");
    const tool = createPbiDmvTool();
    const res = await tool.execute("t", { query } as never);
    expect(JSON.stringify(res)).toContain("must start with SELECT");
    expect(fm).not.toHaveBeenCalled();
  });

  it.each([
    ["Specific columns", "SELECT Name, Description FROM $SYSTEM.TMSCHEMA_TABLES"],
    ["WHERE clause", "SELECT * FROM $SYSTEM.TMSCHEMA_COLUMNS WHERE TableID = 1"],
    ["ORDER BY", "SELECT Name FROM $SYSTEM.TMSCHEMA_MEASURES ORDER BY Name"],
    ["JOIN", "SELECT t.Name, c.Name FROM $SYSTEM.TMSCHEMA_TABLES t JOIN $SYSTEM.TMSCHEMA_COLUMNS c ON t.ID = c.TableID"],
  ])("supports %s in DMV query", async (_label, query) => {
    stubFetchJson({ ok: true, columns: ["Name"], rows: [["x"]], rowCount: 1 });
    const { createPbiDmvTool } = await import("../src/lib/tools/pbi-dmv");
    const tool = createPbiDmvTool();
    const res = await tool.execute("t", { query } as never);
    expect(JSON.stringify(res)).toContain("success");
  });
});

describe("pbi_execute_tmsl — expanded", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["Create measure", '{"create":{"parentObject":{"table":"S"},"object":{"name":"M","kind":"measure","expression":"SUM(S[A])","table":"S"}}}'],
    ["Create calculated table", '{"create":{"parentObject":{},"object":{"name":"T","partitions":[{"name":"p","source":{"type":"calculated","expression":"{1,2,3}"}}]}}}'],
    ["Alter measure", '{"alter":{"object":{"table":"S","name":"M"},"measure":{"expression":"SUM(S[A]) * 2"}}}'],
    ["Delete measure", '{"delete":{"object":{"table":"S","name":"M"}}}'],
    ["Refresh table", '{"refresh":{"object":{"table":"S"}}}'],
  ])("executes %s TMSL command", async (_label, command) => {
    stubFetchJson({ ok: true, response: "<return/>" });
    const { createPbiExecuteTmslTool } = await import("../src/lib/tools/pbi-execute-tmsl");
    const tool = createPbiExecuteTmslTool();
    const res = await tool.execute("t", { command } as never);
    expect(JSON.stringify(res)).toContain("success");
  });

  it("rejects empty command", async () => {
    const fm = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fm);
    const { createPbiExecuteTmslTool } = await import("../src/lib/tools/pbi-execute-tmsl");
    const tool = createPbiExecuteTmslTool();
    const res = await tool.execute("t", { command: "" } as never);
    expect(JSON.stringify(res)).toContain("non-empty");
    expect(fm).not.toHaveBeenCalled();
  });

  it("passes through TMSL error", async () => {
    stubFetchJson({ ok: false, error: "TMSL error: Table 'Ghost' not found" });
    const { createPbiExecuteTmslTool } = await import("../src/lib/tools/pbi-execute-tmsl");
    const tool = createPbiExecuteTmslTool();
    const res = await tool.execute("t", { command: '{"create":{}}' } as never);
    expect(JSON.stringify(res)).toContain("not found");
  });
});

describe("pbi_bridge — expanded", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  const BRIDGE_ACTIONS = ["state", "screenshot", "manifest", "reload"] as const;

  it.each(BRIDGE_ACTIONS)("action %s returns success", async (action) => {
    stubFetchJson({ ok: true, action, result: {} });
    const { createPbiBridgeTool } = await import("../src/lib/tools/pbi-bridge");
    const tool = createPbiBridgeTool({ writeFile: vi.fn() });
    const res = await tool.execute("t", { action } as never);
    expect(JSON.stringify(res)).toContain("success");
  });

  it.each([1.0, 1.5, 2.0, 3.0])("screenshot at scale %s", async (scale) => {
    const fm = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true, action: "screenshot",
        result: { payload: Buffer.from("png").toString("base64"), mimeType: "image/png", pageDisplayName: "P1" },
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fm);
    const { createPbiBridgeTool } = await import("../src/lib/tools/pbi-bridge");
    const tool = createPbiBridgeTool({ writeFile: vi.fn() });
    await tool.execute("t", { action: "screenshot", scale } as never);
    expect(JSON.parse(String(fm.mock.calls[0]?.[1]?.body)).scale).toBe(scale);
  });

  it("screenshot saves PNG to VFS", async () => {
    const writeFile = vi.fn(async () => undefined);
    stubFetchJson({
      ok: true, action: "screenshot",
      result: { payload: Buffer.from("fake-png-data").toString("base64"), mimeType: "image/png", pageDisplayName: "Report" },
    });
    const { createPbiBridgeTool } = await import("../src/lib/tools/pbi-bridge");
    const tool = createPbiBridgeTool({ writeFile });
    const res = await tool.execute("t", { action: "screenshot" } as never);
    const text = JSON.stringify(res);
    expect(text).toContain("pbi-page");
    expect(text).toContain("read tool");
    expect(writeFile).toHaveBeenCalled();
  });

  it("state returns file path and unsaved flag", async () => {
    stubFetchJson({
      ok: true, action: "state",
      result: { currentFilePath: "C:\\test.pbix", hasUnsavedChanges: false },
    });
    const { createPbiBridgeTool } = await import("../src/lib/tools/pbi-bridge");
    const tool = createPbiBridgeTool({ writeFile: vi.fn() });
    const res = await tool.execute("t", { action: "state" } as never);
    expect(JSON.stringify(res)).toContain("test.pbix");
  });
});

describe("all COM/PBI tools — cross-cutting", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("com_bridge handles 503 disabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const { createComBridgeTool } = await import("../src/lib/tools/com-bridge");
    const tool = createComBridgeTool();
    const res = await tool.execute("t", { action: "status" } as never);
    expect(JSON.stringify(res)).toContain("disabled");
  });

  it("pbi_query handles 503 disabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const { createPbiQueryTool } = await import("../src/lib/tools/pbi-query");
    const tool = createPbiQueryTool();
    const res = await tool.execute("t", { query: "EVALUATE 1" } as never);
    expect(JSON.stringify(res)).toContain("disabled");
  });

  it("pbi_dmv handles 503 disabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const { createPbiDmvTool } = await import("../src/lib/tools/pbi-dmv");
    const tool = createPbiDmvTool();
    const res = await tool.execute("t", { query: "SELECT 1" } as never);
    expect(JSON.stringify(res)).toContain("disabled");
  });

  it("pbi_execute_tmsl handles 503 disabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const { createPbiExecuteTmslTool } = await import("../src/lib/tools/pbi-execute-tmsl");
    const tool = createPbiExecuteTmslTool();
    const res = await tool.execute("t", { command: "{}" } as never);
    expect(JSON.stringify(res)).toContain("disabled");
  });

  it("pbi_bridge handles 503 disabled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const { createPbiBridgeTool } = await import("../src/lib/tools/pbi-bridge");
    const tool = createPbiBridgeTool({ writeFile: vi.fn() });
    const res = await tool.execute("t", { action: "state" } as never);
    expect(JSON.stringify(res)).toContain("disabled");
  });

  it.each([
    ["com_bridge", () => import("../src/lib/tools/com-bridge").then(m => m.createComBridgeTool()), { action: "status" }],
    ["pbi_query", () => import("../src/lib/tools/pbi-query").then(m => m.createPbiQueryTool()), { query: "EVALUATE 1" }],
    ["pbi_dmv", () => import("../src/lib/tools/pbi-dmv").then(m => m.createPbiDmvTool()), { query: "SELECT 1" }],
    ["pbi_execute_tmsl", () => import("../src/lib/tools/pbi-execute-tmsl").then(m => m.createPbiExecuteTmslTool()), { command: "{}" }],
  ])("%s handles network error", async (_name, factory, params) => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const tool = await factory();
    const res = await tool.execute("t", params as never);
    expect(JSON.stringify(res)).toContain("unreachable");
  });
});
