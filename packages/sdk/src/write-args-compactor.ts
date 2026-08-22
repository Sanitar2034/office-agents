/**
 * Structure-preserving compaction for /compact: our write tools carry the
 * payload in ARGUMENTS (cell values, slide texts, code) while results are
 * tiny {"success":true}. Instead of replacing the conversation with a
 * summary, OLD bulky arguments are substituted with short digests.
 *
 * Digests always name WHAT was touched (range / slide / shape - the fields
 * the model needs for verification and reporting), never the payload:
 * the data itself lives in the document and can be re-read via get tools.
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

/** tool name -> argument fields identifying WHAT was touched */
const ADDRESS_FIELDS: Record<string, string[]> = {
  set_cell_range: ["range", "sheet"],
  edit_slide_text: ["slide_index", "shape_id"],
  edit_slide_xml: ["slide_index"],
  edit_slide_chart: ["slide_index"],
};

const ARRAY_THRESHOLD = 24;
const STRING_THRESHOLD = 600;

interface ToolCallLike {
  type: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

function describeAddress(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const field of ["sheet", "range", "slide_index", "shape_id"]) {
    const v = args[field];
    if (v === undefined || v === null || v === "") continue;
    if (field === "slide_index") {
      parts.push(`slide ${(v as number) + 1}`);
    } else if (field === "shape_id") {
      parts.push(`shape ${v}`);
    } else {
      parts.push(String(v).slice(0, 60));
    }
  }
  return parts.join(", ");
}

function compactValue(
  value: unknown,
  field: string,
  args: Record<string, unknown>,
): unknown | undefined {
  const size = Array.isArray(value)
    ? value.length
    : typeof value === "string"
      ? value.length
      : 0;
  if (size === 0) return undefined;
  if (Array.isArray(value) && size <= ARRAY_THRESHOLD) return undefined;
  if (typeof value === "string" && size <= STRING_THRESHOLD) return undefined;

  const where = describeAddress(args);
  const what = where || (typeof args.explanation === "string" ? args.explanation.slice(0, 100) : "");
  const unit = Array.isArray(value) ? `${size} ${field} items` : `${size} chars of ${field}`;
  return (
    `[COMPACTED: ${unit} omitted${what ? ` (${what})` : ""} - ` +
    "the payload lives in the document; re-read it via the get tools if needed]"
  );
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
        const replacement = compactValue(call.arguments[field], field, call.arguments);
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
