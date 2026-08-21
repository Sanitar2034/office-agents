import { Type } from "@sinclair/typebox";

// Self-contained defineTool/toolSuccess (avoids importing ./types which pulls
// in @office-agents/core → browser APIs → DOMMatrix crash in Node tests)
type ToolResult = { content: Array<{ type: "text"; text: string }>; details: undefined };

function defineTool(config: {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: never) => Promise<Record<string, unknown>>;
}) {
  return config as unknown as { name: string; execute: (id: string, params: never) => Promise<Record<string, unknown>> };
}

function toolSuccess(data: unknown): Record<string, unknown> {
  if (typeof data === "object" && data !== null) return { ...data } as Record<string, unknown>;
  return { result: data };
}

// Word COM bridge: full document operations beyond Office.js limitations.
// Runs macros, styles, find/replace across the whole doc, tables, properties.

export const WORD_COM_ACTIONS = [
  "get_text",
  "get_stats",
  "find_replace",
  "insert_text",
  "set_style",
  "get_paragraphs",
  "add_table",
  "save",
  "get_properties",
] as const;

type WordComAction = (typeof WORD_COM_ACTIONS)[number];

function bridgeOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin ?? "https://localhost:3000";
}

export function createWordComTool() {
  return defineTool({
    name: "word_com",
    label: "Word COM Bridge",
    description:
      "Full Word document operations via COM on the desktop (beyond Office.js). " +
      "Actions: get_text (full text), get_stats (paragraphs/words/pages), " +
      "find_replace (global search & replace), insert_text (start/end/cursor), " +
      "set_style (apply a named style to a paragraph), get_paragraphs (indexed " +
      "list with styles), add_table, save (optionally to a path), get_properties " +
      "(built-in metadata). Requires 'Desktop power tools' + Word running.",
    parameters: Type.Object({
      action: Type.String({
        description: `Word COM action: ${WORD_COM_ACTIONS.join(", ")}`,
      }),
      find: Type.Optional(Type.String({ description: "find_replace: text to find" })),
      replace: Type.Optional(Type.String({ description: "find_replace: replacement" })),
      text: Type.Optional(Type.String({ description: "insert_text: text to insert" })),
      where: Type.Optional(
        Type.Union([Type.Literal("start"), Type.Literal("end"), Type.Literal("cursor")], {
          description: "insert_text: where (default end)",
        }),
      ),
      style: Type.Optional(Type.String({ description: "set_style: style name e.g. 'Heading 1'" })),
      paragraph: Type.Optional(Type.Number({ description: "set_style: paragraph index" })),
      rows: Type.Optional(Type.Number({ description: "add_table: row count" })),
      cols: Type.Optional(Type.Number({ description: "add_table: column count" })),
      path: Type.Optional(Type.String({ description: "save: full path (empty = in-place)" })),
      explanation: Type.Optional(
        Type.String({ description: "Brief explanation (max 50 chars)", maxLength: 50 }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const action = params.action as WordComAction;

      if (!WORD_COM_ACTIONS.includes(action)) {
        return toolSuccess({
          success: false,
          error: `Unknown action: ${params.action}. Use: ${WORD_COM_ACTIONS.join(", ")}`,
        });
      }

      // client-side validation per action
      if (action === "find_replace" && !params.find) {
        return toolSuccess({ success: false, error: "find is required for find_replace" });
      }
      if (action === "insert_text" && !params.text) {
        return toolSuccess({ success: false, error: "text is required for insert_text" });
      }
      if (action === "set_style" && !params.style) {
        return toolSuccess({ success: false, error: "style is required for set_style" });
      }
      if (action === "set_style" && !params.paragraph) {
        return toolSuccess({ success: false, error: "paragraph is required for set_style" });
      }

      try {
        const res = await fetch(`${bridgeOrigin()}/oa-com/word`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            find: params.find,
            replace: params.replace,
            text: params.text,
            where: params.where,
            style: params.style,
            paragraph: params.paragraph,
            rows: params.rows,
            cols: params.cols,
            path: params.path,
          }),
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
