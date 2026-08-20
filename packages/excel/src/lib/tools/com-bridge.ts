import { Type } from "@sinclair/typebox";
import { defineTool, toolSuccess } from "./types";

// Opt-in desktop power tools: proxies to the offline PowerShell server's
// /oa-com/* endpoints, which drive the RUNNING Excel via COM (xlwings
// pattern). Gated by the server-side com-bridge toggle; when disabled the
// tool answers with a clear message instead of an error.

const COM_ACTIONS = [
  "status",
  "run_macro",
  "pq_list",
  "pq_refresh_all",
  "pq_edit",
] as const;

type ComAction = (typeof COM_ACTIONS)[number];

function bridgeOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin ?? "https://localhost:3000";
}

export function createComBridgeTool() {
  return defineTool({
    name: "com_bridge",
    label: "COM Bridge",
    description:
      "Optional desktop power tools via the offline server + COM on the " +
      "RUNNING Excel. Actions: status (bridge state, Excel running, workbook), " +
      "run_macro (Application.Run), pq_list (Power Query names + M formulas), " +
      "pq_refresh_all (refresh with wait), pq_edit (create/update a query's M " +
      "code). Requires the 'Desktop power tools' toggle in Settings and an " +
      "open workbook; returns disabled/offline messages otherwise.",
    parameters: Type.Object({
      action: Type.String({
        description: `One of: ${COM_ACTIONS.join(", ")}`,
      }),
      macro: Type.Optional(
        Type.String({ description: "run_macro: macro name" }),
      ),
      args: Type.Optional(
        Type.Array(Type.Unknown(), { description: "run_macro: macro arguments" }),
      ),
      name: Type.Optional(
        Type.String({ description: "pq_edit: query name" }),
      ),
      formula: Type.Optional(
        Type.String({ description: "pq_edit: M formula (let ... in ...)" }),
      ),
      explanation: Type.Optional(
        Type.String({ description: "Brief explanation (max 50 chars)", maxLength: 50 }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const action = params.action as ComAction;
      if (!COM_ACTIONS.includes(action)) {
        return toolSuccess({
          success: false,
          error: `Unknown action: ${params.action}. Use: ${COM_ACTIONS.join(", ")}`,
        });
      }

      const base = bridgeOrigin();
      try {
        // server paths use hyphens (pq-list), action ids use underscores (pq_list)
        const path = action.replace(/_/g, "-");
        const res = await fetch(`${base}/oa-com/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            macro: params.macro,
            args: params.args,
            name: params.name,
            formula: params.formula,
          }),
        });
        const data = (await res.json()) as { enabled?: boolean };
        if (action === "status" && data.enabled === false) {
          return toolSuccess({
            success: false,
            disabled: true,
            enabled: false,
            error:
              "COM bridge is disabled — enable 'Desktop power tools' in Settings.",
          });
        }
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
