import { Type } from "@sinclair/typebox";

type ToolResult = Record<string, unknown>;

function defineTool(config: {
  name: string; label: string; description: string; parameters: unknown;
  execute: (id: string, params: never) => Promise<ToolResult>;
}) {
  return config as unknown as { name: string; execute: (id: string, params: never) => Promise<ToolResult> };
}
function toolSuccess(data: unknown): ToolResult {
  if (typeof data === "object" && data !== null) return { ...data } as ToolResult;
  return { result: data };
}

const PPT_COM_ACTIONS = [
  "list_slides", "get_slide_text", "add_slide", "set_text", "delete_slide",
  "get_shapes", "save", "get_properties", "reorder_slide",
] as const;
type PptAction = (typeof PPT_COM_ACTIONS)[number];

function bridgeOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin ?? "https://localhost:3000";
}

export function createPptComTool() {
  return defineTool({
    name: "ppt_com",
    label: "PowerPoint COM Bridge",
    description:
      "PowerPoint operations via COM beyond Office.js. Actions: list_slides, " +
      "get_slide_text (all text from shapes), add_slide (with layout+title), " +
      "set_text (shape text), delete_slide, get_shapes (position/size), " +
      "save, get_properties, reorder_slide. Requires Desktop power tools + PowerPoint running.",
    parameters: Type.Object({
      action: Type.String({ description: `Action: ${PPT_COM_ACTIONS.join(", ")}` }),
      slide: Type.Optional(Type.Number({ description: "Slide index (1-based)" })),
      title: Type.Optional(Type.String({ description: "add_slide: title text" })),
      layout: Type.Optional(Type.Number({ description: "add_slide: layout enum (2=title+content)" })),
      shape: Type.Optional(Type.String({ description: "set_text: shape name or 'Title'" })),
      text: Type.Optional(Type.String({ description: "set_text: new text" })),
      from: Type.Optional(Type.Number({ description: "reorder_slide: source index" })),
      to: Type.Optional(Type.Number({ description: "reorder_slide: target index" })),
      path: Type.Optional(Type.String({ description: "save: full path" })),
      explanation: Type.Optional(Type.String({ description: "Brief (max 50 chars)", maxLength: 50 })),
    }),
    execute: async (_id, params) => {
      const action = params.action as PptAction;
      if (!PPT_COM_ACTIONS.includes(action)) {
        return toolSuccess({ success: false, error: `Unknown action: ${action}. Use: ${PPT_COM_ACTIONS.join(", ")}` });
      }
      try {
        const res = await fetch(`${bridgeOrigin()}/oa-com/ppt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action, slide: params.slide, title: params.title, layout: params.layout,
            shape: params.shape, text: params.text, from: params.from, to: params.to, path: params.path,
          }),
        });
        if (res.status === 503) {
          return toolSuccess({ success: false, disabled: true, error: "Desktop power tools are disabled." });
        }
        const data = await res.json();
        return toolSuccess({ success: res.ok, ...data });
      } catch (err) {
        return toolSuccess({ success: false, error: `offline server unreachable: ${err instanceof Error ? err.message : "failed"}` });
      }
    },
  });
}
