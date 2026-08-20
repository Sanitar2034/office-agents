import { Type } from "@sinclair/typebox";
import { defineTool, toolSuccess } from "./types";

// Power BI Desktop bridge: DAX queries against the local Analysis Services
// engine (msmdsrv) of a running Power BI Desktop, proxied through the
// offline server's /oa-pbi/dax endpoint. Gated by the same desktop-power
// toggle as the COM bridge. Read-only by contract (EVALUATE only).

function bridgeOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin ?? "https://localhost:3000";
}

export function createPbiQueryTool() {
  return defineTool({
    name: "pbi_query",
    label: "Power BI DAX Query",
    description:
      "Run a read-only DAX query against the model open in Power BI Desktop " +
      "(its local engine, no cloud). Query MUST start with EVALUATE. Returns " +
      "columns + rows as JSON. Requires 'Desktop power tools' enabled in " +
      "Settings AND a .pbix open in Power BI Desktop; otherwise returns a " +
      "disabled/not-running message.",
    parameters: Type.Object({
      query: Type.String({
        description:
          'DAX query starting with EVALUATE, e.g. \'EVALUATE ROW("sum", SUM(T[Col]))\'',
      }),
      explanation: Type.Optional(
        Type.String({ description: "Brief explanation (max 50 chars)", maxLength: 50 }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const query = params.query.trim();
      if (!/^EVALUATE\b/i.test(query)) {
        return toolSuccess({
          success: false,
          error:
            "Query must start with EVALUATE (read-only DAX; no commands, only queries).",
        });
      }
      try {
        const res = await fetch(`${bridgeOrigin()}/oa-pbi/dax`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (res.status === 503) {
          return toolSuccess({
            success: false,
            disabled: true,
            error:
              "Desktop power tools are disabled — enable them in Settings.",
          });
        }
        const data = await res.json();
        return toolSuccess({ success: res.ok, ...data });
      } catch (err) {
        return toolSuccess({
          success: false,
          error:
            "offline server unreachable: " +
            (err instanceof Error ? err.message : "request failed"),
        });
      }
    },
  });
}
