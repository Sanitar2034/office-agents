import { Type } from "@sinclair/typebox";
import { defineTool, toolSuccess } from "./types";

// Power BI Desktop Bridge (named pipe via the offline server): app state,
// report page screenshots and file reload. Screenshots are written into the
// VFS as PNGs so the model can view them with the read tool (vision).

export interface PbiBridgeDeps {
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
}

function bridgeOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin ?? "https://localhost:3000";
}

function base64ToBytes(b64: string): Uint8Array {
  const bin =
    typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function createPbiBridgeTool(deps: PbiBridgeDeps) {
  return defineTool({
    name: "pbi_bridge",
    label: "Power BI Desktop Bridge",
    description:
      "Power BI Desktop Bridge actions via the offline server: " +
      "state (open file path, unsaved changes), screenshot (PNG of a report " +
      "page - saved into the VFS, then VIEW it with the read tool), " +
      "manifest (bridge capabilities), reload (re-open the PBIP/PBIR from " +
      "disk - discards unsaved changes, ask the user first). " +
      "Requires 'Desktop power tools' enabled and Power BI Desktop running.",
    parameters: Type.Object({
      action: Type.Union(
        [
          Type.Literal("state"),
          Type.Literal("screenshot"),
          Type.Literal("manifest"),
          Type.Literal("reload"),
        ],
        { description: "Bridge action" },
      ),
      pageId: Type.Optional(
        Type.String({
          description:
            "screenshot: explicit page id (auto-discovered from the open file when omitted)",
        }),
      ),
      scale: Type.Optional(
        Type.Number({
          description: "screenshot: capture scale 1.0-3.0 (default 1.0)",
        }),
      ),
      explanation: Type.Optional(
        Type.String({ description: "Brief explanation (max 50 chars)", maxLength: 50 }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const res = await fetch(`${bridgeOrigin()}/oa-pbi/bridge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: params.action,
            pageId: params.pageId,
            scale: params.scale,
          }),
        });
        if (res.status === 503) {
          return toolSuccess({
            success: false,
            disabled: true,
            error: "Desktop power tools are disabled — enable them in Settings.",
          });
        }
        const data = (await res.json()) as {
          ok?: boolean;
          action?: string;
          error?: string;
          result?: {
            payload?: string;
            mimeType?: string;
            pageDisplayName?: string | null;
          };
        };
        if (!data.ok) {
          return toolSuccess({ success: false, error: data.error });
        }
        if (params.action === "screenshot" && data.result?.payload) {
          const path = `/home/user/pbi-page-${Date.now()}.png`;
          await deps.writeFile(path, base64ToBytes(data.result.payload));
          return toolSuccess({
            success: true,
            action: "screenshot",
            page: data.result.pageDisplayName ?? undefined,
            savedTo: path,
            hint:
              "PNG saved to the VFS - use the read tool on it to SEE the report page.",
          });
        }
        return toolSuccess({ success: true, action: params.action, result: data.result });
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
