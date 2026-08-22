/**
 * Dynamic context (document conventions + agent memory) is injected as the
 * FIRST user message instead of the system prompt tail: the system prompt +
 * tool schemas stay byte-identical across requests, so the llama.cpp prefix
 * cache survives. Changing conventions/memory costs exactly one re-prefill.
 */

export const PREAMBLE_MARKERS = {
  conventions: "[DOCUMENT CONVENTIONS - rules for this document]",
  memory: "[AGENT MEMORY - facts about the user across sessions]",
} as const;

export function buildContextPreamble(
  conventions: string,
  memory: string,
): string | null {
  const conv = conventions.trim();
  const mem = memory.trim();
  if (!conv && !mem) return null;

  const blocks: string[] = [];
  if (conv) {
    blocks.push(
      `${PREAMBLE_MARKERS.conventions}\n${conv}\nApply these rules to every action in this document.`,
    );
  }
  if (mem) {
    blocks.push(
      `${PREAMBLE_MARKERS.memory}\n${mem}\nApply these facts proactively; add new stable facts with memory_write.`,
    );
  }
  return blocks.join("\n\n");
}

function isPreambleMessage(msg: { role?: string; content?: unknown }): boolean {
  if (msg.role !== "user") return false;
  const text =
    typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? ""
        : "";
  return (
    text.startsWith(PREAMBLE_MARKERS.conventions) ||
    text.startsWith(PREAMBLE_MARKERS.memory)
  );
}

/**
 * Returns a NEW array only when the preamble actually changed; identity is
 * preserved otherwise (callers can rely on reference equality for caching).
 */
export function injectPreamble<T extends { role: string; content: unknown }>(
  messages: T[],
  preamble: string | null,
): T[] {
  const existing = messages[0];
  const hasExisting = existing ? isPreambleMessage(existing) : false;

  if (!preamble) {
    return hasExisting ? messages.slice(1) : messages;
  }

  if (hasExisting && existing.content === preamble) {
    return messages; // unchanged: keep identity
  }

  const rest = hasExisting ? messages.slice(1) : messages;
  const preambleMessage = {
    role: "user",
    content: preamble,
    timestamp: 0,
  } as unknown as T;
  return [preambleMessage, ...rest];
}
