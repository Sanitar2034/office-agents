import type { AgentContext } from "@office-agents/core";
import { undoDocumentEditsTool } from "./undo-document-edits";
import { createBashTool, createReadTool } from "@office-agents/core";
import { createExecuteOfficeJsTool } from "./execute-office-js";
import { getDocumentStructureTool } from "./get-document-structure";
import { getDocumentTextTool } from "./get-document-text";
import { createGetOoxmlTool } from "./get-ooxml";
import { screenshotDocumentTool } from "./screenshot-document";

import { createWordComTool } from "./word-com";

export function createWordTools(ctx: AgentContext) {
  return [
    // fs tools
    createReadTool(ctx),
    createBashTool(ctx),
    undoDocumentEditsTool,
    // Word read tools
    screenshotDocumentTool,
    getDocumentTextTool,
    getDocumentStructureTool,
    createGetOoxmlTool(ctx),
    // Word write tools
    createExecuteOfficeJsTool(ctx),
    createWordComTool(),
  ];
}

export {
  createBashTool,
  createReadTool,
  createExecuteOfficeJsTool,
  getDocumentStructureTool,
  getDocumentTextTool,
  createGetOoxmlTool,
  screenshotDocumentTool,
};

export {
  defineTool,
  type ToolResult,
  toolError,
  toolImage,
  toolSuccess,
  toolText,
} from "./types";
