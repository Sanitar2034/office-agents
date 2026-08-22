/**
 * Where to cut the transcript for summary compaction. Guarantees:
 * - kept (right side) never starts with a toolResult (pair safety);
 * - the cut prefers a user-message boundary; when none exists in the
 *   window (long agent-driven batch runs), it falls back to the START of
 *   an assistant turn so the split always makes progress (oldMessages
 *   has real content) - never the old degenerate split=1 that summarized
 *   a single message and could loop without freeing anything.
 */

type Msg = { role: string };

const SEARCH_WINDOW = 30;

export function findCompactSplit(messages: Msg[], keepRecent: number): number {
  const len = messages.length;
  const start = Math.max(1, len - keepRecent);

  // 1) preferred: the newest user boundary outside keepRecent
  for (let i = start; i >= Math.max(1, start - SEARCH_WINDOW); i--) {
    if (messages[i]?.role === "user") return i;
  }

  // 2) fallback: start of an assistant TURN (assistant not preceded by
  //    toolResult = not a continuation inside a tool batch)
  for (let i = start; i >= 2; i--) {
    if (
      messages[i]?.role === "assistant" &&
      messages[i - 1]?.role !== "toolResult"
    ) {
      return i;
    }
  }

  // 3) nothing splittable found
  return 0;
}
