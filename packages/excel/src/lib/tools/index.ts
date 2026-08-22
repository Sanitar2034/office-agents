export { createBashTool, createReadTool } from "@office-agents/core";
export { clearCellRangeTool } from "./clear-cell-range";
export { copyToTool } from "./copy-to";
export { createEvalOfficeJsTool } from "./eval-officejs";
export { getAllObjectsTool } from "./get-all-objects";
export { getCellRangesTool } from "./get-cell-ranges";
export { getRangeAsCsvTool } from "./get-range-as-csv";
export { modifyObjectTool } from "./modify-object";
export { modifySheetStructureTool } from "./modify-sheet-structure";
export { modifyWorkbookStructureTool } from "./modify-workbook-structure";
export { resizeRangeTool } from "./resize-range";
export { screenshotRangeTool } from "./screenshot-range";
export { searchDataTool } from "./search-data";
export { setCellRangeTool } from "./set-cell-range";
export {
  defineTool,
  type ToolResult,
  toolError,
  toolSuccess,
  toolText,
} from "./types";

import type { AgentContext } from "@office-agents/core";
import { createBashTool, createReadTool } from "@office-agents/core";
import { clearCellRangeTool } from "./clear-cell-range";
import { copyToTool } from "./copy-to";
import { createEvalOfficeJsTool } from "./eval-officejs";
import { getAllObjectsTool } from "./get-all-objects";
import { getCellRangesTool } from "./get-cell-ranges";
import { getRangeAsCsvTool } from "./get-range-as-csv";
import { modifyObjectTool } from "./modify-object";
import { modifySheetStructureTool } from "./modify-sheet-structure";
import { modifyWorkbookStructureTool } from "./modify-workbook-structure";
import { resizeRangeTool } from "./resize-range";
import { screenshotRangeTool } from "./screenshot-range";
import { undoEditsTool } from "./undo-edits";
import { createComBridgeTool } from "./com-bridge";
import { createPbiQueryTool } from "./pbi-query";
import { createPbiBridgeTool } from "./pbi-bridge";
import { createPbiExecuteTmslTool } from "./pbi-execute-tmsl";
import { createPbiDmvTool } from "./pbi-dmv";
import { initUndoJournal } from "../excel/undo-journal";
import { searchDataTool } from "./search-data";
import { setCellRangeTool } from "./set-cell-range";
import { createVerifyEditsTool } from "./verify-edits";

export function createExcelTools(ctx: AgentContext) {
  initUndoJournal(ctx.namespace.localStoragePrefix);
  return [
    // fs tools
    createReadTool(ctx),
    createBashTool(ctx),
    // Excel read tools
    getCellRangesTool,
    getRangeAsCsvTool,
    searchDataTool,
    screenshotRangeTool,
    getAllObjectsTool,
    // Excel write tools
    setCellRangeTool,
    clearCellRangeTool,
    createVerifyEditsTool(ctx),
    copyToTool,
    modifySheetStructureTool,
    modifyWorkbookStructureTool,
    resizeRangeTool,
    modifyObjectTool,
    createEvalOfficeJsTool(ctx),
    undoEditsTool,
    createComBridgeTool(),
    createPbiQueryTool(),
    createPbiBridgeTool({ writeFile: (p, d) => ctx.writeFile(p, d) }),
    createPbiExecuteTmslTool(),
    createPbiDmvTool(),
  ];
}
