import { Type } from "@sinclair/typebox";
import { defineTool, toolSuccess } from "./types";

// Execute TMSL/XMLA commands against the PBI model (CREATE/ALTER/DELETE
// tables, measures, partitions, relationships). Gated by desktop power tools.

function bridgeOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin ?? "https://localhost:3000";
}

export function createPbiExecuteTmslTool() {
  return defineTool({
    name: "pbi_execute_tmsl",
    label: "Power BI TMSL Command",
    description:
      "Execute a TMSL (Tabular Model Scripting Language) JSON command against the " +
      "Power BI model - CREATE/ALTER/DELETE tables, calculated columns, measures, " +
      "partitions, relationships. The command is a JSON object like " +
      '{"create":{"parentObject":{"table":"T"},"object":{"name":"M","kind":"measure",' +
      '"expression":"SUM(T[Col])","table":"T"}}}. ' +
      "Use pbi_dmv with TMSCHEMA_* views to inspect the model first. " +
      "Requires 'Desktop power tools' enabled + Power BI Desktop running.",
    parameters: Type.Object({
      command: Type.String({
        description: "TMSL JSON command (string)",
      }),
      explanation: Type.Optional(
        Type.String({ description: "Brief explanation (max 50 chars)", maxLength: 50 }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const command = params.command.trim();
      if (!command) {
        return toolSuccess({
          success: false,
          error: "Command must be a non-empty TMSL JSON string.",
        });
      }
      try {
        const res = await fetch(`${bridgeOrigin()}/oa-pbi/tmsl`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command }),
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
