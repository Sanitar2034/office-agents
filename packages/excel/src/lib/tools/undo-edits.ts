import { Type } from "@sinclair/typebox";
import { journalLength, undoEdits } from "../excel/undo-journal";
import { defineTool, toolSuccess } from "./types";

export const undoEditsTool = defineTool({
  name: "undo_edits",
  label: "Undo Agent Edits",
  description:
    "Roll back the user's workbook changes made by your earlier write tools " +
    "(set_cell_range / clear_cell_range) by restoring the exact previous cell " +
    "values, formulas and number formats. Use when the user asks to undo, " +
    "revert or cancel your edits (including the /undo command). " +
    "Operations are replayed in reverse order; undo stops at the first failure. " +
    `Journal currently holds ${journalLength()} operation(s).`,
  parameters: Type.Object({
    count: Type.Optional(
      Type.Number({
        description:
          "How many recent write operations to undo (default 1). " +
          "Use a large number or all=true to undo everything.",
      }),
    ),
    all: Type.Optional(
      Type.Boolean({ description: "Undo ALL recorded agent edits" }),
    ),
    explanation: Type.Optional(
      Type.String({ description: "Brief explanation (max 50 chars)", maxLength: 50 }),
    ),
  }),
  execute: async (_toolCallId, params) => {
    const result = await undoEdits(
      params.all === true ? "all" : Math.max(1, Math.floor(params.count ?? 1)),
    );
    return toolSuccess(result);
  },
});
