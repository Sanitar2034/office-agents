import { Type } from "@sinclair/typebox";
import {
  getSessionSlideJournal,
  undoAllSlideEdits,
} from "../pptx/slide-journal";
import { defineTool, toolError, toolSuccess } from "./types";

export const undoSlideEditsTool = defineTool({
  name: "undo_slide_edits",
  label: "Undo Agent Slide Edits",
  description:
    "Roll back the agent's slide edits made in this session: every slide the agent " +
    "modified is restored to its original content (recorded before each edit). " +
    "Use when the user asks to undo or revert changes.",
  parameters: Type.Object({
    explanation: Type.Optional(
      Type.String({ description: "Brief description (max 50 chars)", maxLength: 50 }),
    ),
  }),
  execute: async () => {
    try {
      const count = getSessionSlideJournal().size();
      const result = await undoAllSlideEdits(getSessionSlideJournal());
      return toolSuccess({
        success: true,
        restoredSlides: result.restored,
        hadSnapshots: count,
      });
    } catch (error) {
      return toolError(
        error instanceof Error ? error.message : "Failed to undo slide edits",
      );
    }
  },
});
