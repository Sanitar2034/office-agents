/**
 * Structure-preserving compaction for /compact: our write tools carry the
 * payload in ARGUMENTS (cell values, slide texts, code) while results are
 * tiny {"success":true}. Instead of replacing the conversation with a
 * summary, OLD bulky arguments are substituted with short digests - the
 * conversation skeleton, ranges, ids and results stay verbatim, so the
 * model keeps its full action trace.
 */

/** tool name -> argument fields that hold bulky payloads */
export const BULKY_TOOL_FIELDS: Record<string, string[]> = {
  set_cell_range: ["values", "formulas"],
  edit_slide_text: ["text"],
  edit_slide_xml: ["xml"],
  edit_slide_chart: ["xml"],
  execute_office_js: ["code"],
  eval_officejs: ["code"],
  pbi_execute_tmsl: ["command"],
};

const ARRAY_THRESHOLD = 24;
const STRING_THRESHOLD = 600;

interface ToolCallLike {
  type: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

function compactValue(value: unknown, field: string): unknown | undefined {
  if (Array.isArray(value) && value.length > ARRAY_THRESHOLD) {
    return `[COMPACTED: ${value.length} ${field} items omitted - the write was applied to the document; re-read via the get tools if needed]`;
  }
  if (typeof value === "string" && value.length > STRING_THRESHOLD) {
    return `[COMPACTED: ${value.length} chars of ${field} omitted - the effect is already applied to the document]`;
  }
  return undefined;
}

export function compactBulkyToolArgs<T extends { role: string; content?: unknown }>(
  messages: T[],
  keepRecent: number,
): { messages: T[]; compactedCalls: number } {
  const cutoff = Math.max(0, messages.length - keepRecent);
  let compactedCalls = 0;
  let changed = false;

  const out = messages.map((msg, index) => {
    if (index >= cutoff || msg.role !== "assistant" || !Array.isArray(msg.content)) {
      return msg;
    }
    const blocks = msg.content as unknown[];
    let msgChanged = false;
    const newBlocks = blocks.map((block) => {
      const call = block as ToolCallLike;
      if (!call || call.type !== "toolCall" || !call.name) return block;
      const fields = BULKY_TOOL_FIELDS[call.name];
      if (!fields || !call.arguments) return block;

      const newArgs: Record<string, unknown> = { ...call.arguments };
      let argsChanged = false;
      for (const field of fields) {
        const replacement = compactValue(call.arguments[field], field);
        if (replacement !== undefined) {
          newArgs[field] = replacement;
          argsChanged = true;
        }
      }
      if (!argsChanged) return block;
      msgChanged = true;
      compactedCalls += 1;
      return { ...call, arguments: newArgs };
    });

    if (!msgChanged) return msg;
    changed = true;
    return { ...msg, content: newBlocks };
  });

  return { messages: changed ? out : messages, compactedCalls };
}
