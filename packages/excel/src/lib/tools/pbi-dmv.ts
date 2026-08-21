import { Type } from "@sinclair/typebox";
import { defineTool, toolSuccess } from "./types";

// Query DMV system views ($SYSTEM.TMSCHEMA_*) to introspect the PBI model:
// tables, columns, measures, relationships, partitions, hierarchies.

function bridgeOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin ?? "https://localhost:3000";
}

export function createPbiDmvTool() {
  return defineTool({
    name: "pbi_dmv",
    label: "Power BI DMV Query",
    description:
      "Query DMV (Data Management View) system tables to inspect the PBI model. " +
      "Useful views: TMSCHEMA_TABLES (all tables), TMSCHEMA_COLUMNS (all columns), " +
      "TMSCHEMA_MEASURES (all measures), TMSCHEMA_RELATIONSHIPS, TMSCHEMA_PARTITIONS, " +
      "TMSCHEMA_HIERARCHIES, DISCOVER_STORAGE_TABLES (data sizes). " +
      "Query must start with SELECT. Requires 'Desktop power tools' + PBI Desktop running.",
    parameters: Type.Object({
      query: Type.String({
        description:
          'DMV query, e.g. "SELECT Name, Description FROM $SYSTEM.TMSCHEMA_TABLES"',
      }),
      explanation: Type.Optional(
        Type.String({ description: "Brief explanation (max 50 chars)", maxLength: 50 }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const query = params.query.trim();
      if (!/^SELECT\b/i.test(query)) {
        return toolSuccess({
          success: false,
          error: "Query must start with SELECT (read-only DMV).",
        });
      }
      try {
        const res = await fetch(`${bridgeOrigin()}/oa-pbi/dmv`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (res.status === 503) {
          return toolSuccess({
            success: false,
            disabled: true,
            error: "Desktop power tools are disabled — enable them in Settings.",
          });
        }
        const data = await res.json();
        return toolSuccess({ success: res.ok, ...data });
      } catch (err) {
        return toolSuccess({
          success: false,
          error: `offline server unreachable: ${err instanceof Error ? err.message : "failed"}`,
        });
      }
    },
  });
}
