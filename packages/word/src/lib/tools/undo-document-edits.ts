import { Type } from "@sinclair/typebox";
import {
  getSessionWordJournal,
  restoreAllBodySnapshots,
} from "../word-journal";
import { defineTool, toolError, toolSuccess } from "./types";

export const undoDocumentEditsTool = defineTool({
  name: "undo_document_edits",
  label: "Undo Agent Document Edits",
  description:
    "Roll back the agent's edits made in this session: the document body is " +
    "restored to its state before the agent's FIRST edit (body OOXML snapshot). " +
    "Headers/footers and styles set outside the body are not restored. " +
    "Use when the user asks to undo or revert changes.",
  parameters: Type.Object({
    explanation: Type.Optional(
      Type.String({ description: "Brief description (max 50 chars)", maxLength: 50 }),
    ),
  }),
  execute: async () => {
    try {
      const result = await restoreAllBodySnapshots(getSessionWordJournal());
      return toolSuccess({ success: true, restored: result.restored });
    } catch (error) {
      return toolError(
        error instanceof Error
          ? error.message
          : "Failed to undo document edits",
      );
    }
  },
});
