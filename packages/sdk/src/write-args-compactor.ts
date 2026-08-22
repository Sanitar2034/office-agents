/**
 * Structure-preserving compaction for /compact.
 *
 * Two per-review policies:
 * 1. Each bulky tool gets ITS OWN digest transformation that keeps what the
 *    model needs (addresses, grid shape, the code opening, the TMSL target)
 *    and omits what the document already holds (numbers, formulas, full code).
 * 2. FAILED tool calls are noise: their (call + result) pairs are removed
 *    entirely from the old region - only recent failures stay so the model
 *    can still learn from the immediate error.
 */

const ARRAY_THRESHOLD = 24;
const STRING_THRESHOLD = 600;

interface ToolCallLike {
  type: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}
interface ResultLike {
  role: string;
  toolCallId?: string;
  isError?: boolean;
}
type Msg = { role: string; content?: unknown };

const TAIL =
  "- the payload lives in the document; re-read it via the get tools if needed]";

function gridShape(values: unknown): string | null {
  if (!Array.isArray(values) || values.length <= ARRAY_THRESHOLD) return null;
  const cols = Array.isArray(values[0]) ? values[0].length : 1;
  return `${values.length}×${cols}`;
}

function firstLine(text: unknown, max = 80): string {
  return String(text ?? "").split("\n")[0].slice(0, max);
}

/** per-tool argument transformers; return new args or null to keep as-is */
const TOOL_DIGESTERS: Record<
  string,
  (args: Record<string, unknown>) => Record<string, unknown> | null
> = {
  set_cell_range: (args) => {
    let changed = false;
    const out = { ...args };
    for (const field of ["values", "formulas"] as const) {
      const shape = gridShape(args[field]);
      if (!shape) continue;
      out[field] =
        `[COMPACTED ${field}: ${shape} grid${args.range ? ` → ${args.range}` : ""} ${TAIL}`;
      changed = true;
    }
    return changed ? out : null;
  },
  edit_slide_text: (args) => {
    const text = args.text;
    if (typeof text !== "string" || text.length <= STRING_THRESHOLD) return null;
    const at =
      `slide ${(args.slide_index as number) + 1}` +
      (args.shape_id !== undefined ? `, shape ${args.shape_id}` : "");
    return {
      ...args,
      text: `[COMPACTED text: ${text.length} chars → ${at} (first line: "${firstLine(text)}") ${TAIL}`,
    };
  },
  edit_slide_xml: (args) => slideXmlDigest(args, "xml"),
  edit_slide_chart: (args) => slideXmlDigest(args, "xml"),
  execute_office_js: (args) => codeDigest(args),
  eval_officejs: (args) => codeDigest(args),
  pbi_execute_tmsl: (args) => {
    const command = args.command;
    if (typeof command !== "string" || command.length <= STRING_THRESHOLD) return null;
    let target = "";
    try {
      const parsed = JSON.parse(command);
      const verb = Object.keys(parsed)[0];
      const table =
        parsed?.[verb]?.table?.name ?? parsed?.[verb]?.object?.name ?? undefined;
      target = ` (${verb}${table ? ` ${table}` : ""})`;
    } catch {
      // not JSON-shaped TMSL - fall back to size only
    }
    return {
      ...args,
      command: `[COMPACTED TMSL command: ${command.length} chars${target} - already applied to the model]`,
    };
  },
};

function slideXmlDigest(
  args: Record<string, unknown>,
  field: string,
): Record<string, unknown> | null {
  const xml = args[field];
  if (typeof xml !== "string" || xml.length <= STRING_THRESHOLD) return null;
  return {
    ...args,
    [field]:
      `[COMPACTED ${field}: ${xml.length} chars → slide ${(args.slide_index as number) + 1} ${TAIL}`,
  };
}

function codeDigest(args: Record<string, unknown>): Record<string, unknown> | null {
  const code = args.code;
  if (typeof code !== "string" || code.length <= STRING_THRESHOLD) return null;
  const why =
    typeof args.explanation === "string" && args.explanation.trim()
      ? args.explanation.slice(0, 100)
      : "";
  return {
    ...args,
    code:
      `[COMPACTED code: ${code.length} chars` +
      `${why ? ` (${why}` : ""}${why ? `; starts: "${firstLine(code, 60)}")` : ")"}` +
      ` ${TAIL}`,
  };
}

export function compactBulkyToolArgs<T extends Msg>(
  messages: T[],
  keepRecent: number,
): { messages: T[]; compactedCalls: number; removedFailedCalls: number } {
  const cutoff = Math.max(0, messages.length - keepRecent);
  let compactedCalls = 0;
  let removedFailedCalls = 0;
  let changed = false;

  // Pass 1: ids of FAILED tool results in the old region
  const failedIds = new Set<string>();
  messages.forEach((msg, index) => {
    if (index >= cutoff) return;
    const r = msg as unknown as ResultLike;
    if (r.role === "toolResult" && r.isError && r.toolCallId) {
      failedIds.add(r.toolCallId);
      removedFailedCalls += 1;
    }
  });

  // Pass 2: rebuild the old region - drop failed pairs, digest bulky args
  const out: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (i >= cutoff) {
      out.push(msg);
      continue;
    }

    const asResult = msg as unknown as ResultLike;
    if (asResult.role === "toolResult" && failedIds.has(asResult.toolCallId ?? "")) {
      changed = true; // dropped failed result
      continue;
    }

    if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
      out.push(msg);
      continue;
    }

    let msgChanged = false;
    const newBlocks = (msg.content as unknown[])
      .map((block) => {
        const call = block as ToolCallLike;
        if (call?.type !== "toolCall") return block;
        if (failedIds.has(call.id ?? "")) {
          msgChanged = true;
          return null; // drop the failed call
        }
        const digester = call.name ? TOOL_DIGESTERS[call.name] : undefined;
        if (!digester || !call.arguments) return block;
        const digested = digester(call.arguments);
        if (!digested) return block;
        msgChanged = true;
        compactedCalls += 1;
        return { ...call, arguments: digested };
      })
      .filter((b) => b !== null);

    if (!msgChanged) {
      out.push(msg);
      continue;
    }
    changed = true;
    if (newBlocks.length === 0) continue; // whole assistant message was failed calls
    out.push({ ...msg, content: newBlocks } as T);
  }

  return {
    messages: changed ? out : messages,
    compactedCalls,
    removedFailedCalls,
  };
}
