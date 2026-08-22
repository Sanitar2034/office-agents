/**
 * Structure-preserving compaction for /compact.
 *
 * Policies:
 * 1. Each bulky tool gets ITS OWN digest transformation matched to its REAL
 *    argument schema (set_cell_range -> cells; slide tools -> code), keeping
 *    what the model needs (range, grid shape, slide/shape, code opening,
 *    TMSL target) and omitting what the document already holds.
 * 2. FAILED tool calls are noise: their (call + result) pairs are removed
 *    from the old region; recent failures stay so the model can still learn.
 *
 * The returned details feed the compaction audit log.
 */

const ROW_THRESHOLD = 24;
const TOTAL_CELL_THRESHOLD = 600;
const STRING_THRESHOLD = 600;

export interface CompactedCallInfo {
  tool: string;
  digestChars: number;
  originalChars: number;
}
export interface RemovedFailedCallInfo {
  tool: string;
  error: string;
}

interface ToolCallLike {
  type: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}
interface ResultLike {
  role: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}
type Msg = { role: string; content?: unknown };

const TAIL =
  "- the payload lives in the document; re-read it via the get tools if needed]";

function firstLine(text: unknown, max = 80): string {
  return String(text ?? "").split("\n")[0].slice(0, max);
}

function codeDigest(args: Record<string, unknown>): Record<string, unknown> | null {
  const code = args.code;
  if (typeof code !== "string" || code.length <= STRING_THRESHOLD) return null;

  const where: string[] = [];
  if (typeof args.slide_index === "number") where.push(`slide ${args.slide_index + 1}`);
  if (args.shape_id !== undefined) where.push(`shape ${args.shape_id}`);
  const why =
    typeof args.explanation === "string" && args.explanation.trim()
      ? args.explanation.slice(0, 100)
      : "";
  const detailParts: string[] = [];
  if (where.length > 0) detailParts.push(where.join(", "));
  if (why) detailParts.push(why);
  const opening = firstLine(code, 60).replace(/["\]]/g, "'");
  detailParts.push(`starts: "${opening}"`);
  const detail = detailParts.length > 0 ? ` (${detailParts.join(" - ")})` : "";

  return { ...args, code: `[COMPACTED code: ${code.length} chars${detail} ${TAIL}` };
}

/** per-tool digesters against the REAL schemas */
const TOOL_DIGESTERS: Record<
  string,
  (args: Record<string, unknown>) => Record<string, unknown> | null
> = {
  set_cell_range: (args) => {
    const cells = args.cells;
    if (!Array.isArray(cells) || cells.length === 0) return null;
    const cols = Array.isArray(cells[0]) ? cells[0].length : 1;
    const total = cells.reduce(
      (sum, row) => sum + (Array.isArray(row) ? row.length : 1),
      0,
    );
    // bulky by ROW count OR by total cell count (24x1000 must not escape)
    if (cells.length <= ROW_THRESHOLD && total <= TOTAL_CELL_THRESHOLD) return null;
    const at = [args.range ? String(args.range) : "", `sheet ${args.sheetId}`]
      .filter(Boolean)
      .join(", ");
    return {
      ...args,
      cells:
        `[COMPACTED cells: ${cells.length}×${cols} grid (${total} cells)` +
        `${at ? ` → ${at}` : ""} ${TAIL}`,
    };
  },
  edit_slide_text: (args) => codeDigest(args),
  edit_slide_master: (args) => codeDigest(args),
  edit_slide_xml: (args) => codeDigest(args),
  edit_slide_chart: (args) => codeDigest(args),
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
      // XMLA-shaped or free-form command - size-only digest
    }
    return {
      ...args,
      command: `[COMPACTED TMSL command: ${command.length} chars${target} - already applied to the model]`,
    };
  },
};

export function compactBulkyToolArgs<T extends Msg>(
  messages: T[],
  keepRecent: number,
): {
  messages: T[];
  compactedCalls: number;
  removedFailedCalls: number;
  compactedDetails: CompactedCallInfo[];
  removedDetails: RemovedFailedCallInfo[];
} {
  const cutoff = Math.max(0, messages.length - keepRecent);
  const compactedDetails: CompactedCallInfo[] = [];
  const removedDetails: RemovedFailedCallInfo[] = [];
  let removedFailedCalls = 0;
  let changed = false;

  // Pass 1: FAILED tool results in the OLD region only
  const failedIds = new Set<string>();
  messages.forEach((msg, index) => {
    if (index >= cutoff) return;
    const r = msg as unknown as ResultLike;
    if (r.role === "toolResult" && r.isError && r.toolCallId) {
      failedIds.add(r.toolCallId);
      removedFailedCalls += 1;
      removedDetails.push({
        tool: r.toolName ?? "unknown",
        error: (r.content?.[0]?.text ?? "").slice(0, 120),
      });
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
        compactedDetails.push({
          tool: call.name,
          digestChars: JSON.stringify(digested).length,
          originalChars: JSON.stringify(call.arguments).length,
        });
        return { ...call, arguments: digested };
      })
      .filter((b) => b !== null);

    if (!msgChanged) {
      out.push(msg);
      continue;
    }
    changed = true;
    if (newBlocks.length === 0) continue; // assistant message was all failed calls
    out.push({ ...msg, content: newBlocks } as T);
  }

  return {
    messages: changed ? out : messages,
    compactedCalls: compactedDetails.length,
    removedFailedCalls,
    compactedDetails,
    removedDetails,
  };
}
