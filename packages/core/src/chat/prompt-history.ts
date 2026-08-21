/**
 * Classic CLI-style prompt history for the chat input: ArrowUp recalls the
 * previous sent prompt, ArrowDown walks back to what you were typing.
 * entries[0] is the newest; index -1 means "live editing, not browsing".
 */

const STORAGE_KEY = "office-agents.prompt-history.v1";
const DEFAULT_LIMIT = 100;

export interface BrowseState {
  /** -1 = live editing; otherwise position in entries */
  index: number;
  /** text captured from the input when browsing started */
  draft: string;
}

export function addPrompt(
  entries: string[],
  text: string,
  limit: number = DEFAULT_LIMIT,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return entries;
  if (entries[0] === trimmed) return entries;
  return [trimmed, ...entries].slice(0, limit);
}

export function recallUp(
  entries: string[],
  browse: BrowseState,
  currentText: string,
): { browse: BrowseState; text: string } {
  if (entries.length === 0) return { browse, text: currentText };
  const next = Math.min(browse.index + 1, entries.length - 1);
  const draft = browse.index === -1 ? currentText : browse.draft;
  return { browse: { index: next, draft }, text: entries[next] };
}

export function recallDown(
  entries: string[],
  browse: BrowseState,
  currentText: string,
): { browse: BrowseState; text: string } {
  if (browse.index === -1) return { browse, text: currentText };
  const next = browse.index - 1;
  if (next < 0) return { browse: { index: -1, draft: "" }, text: browse.draft };
  return { browse: { index: next, draft: browse.draft }, text: entries[next] };
}

export function savePromptHistory(
  storage: Storage | null,
  entries: string[],
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, DEFAULT_LIMIT)));
  } catch {
    // storage full or unavailable - history is best-effort
  }
}

export function loadPromptHistory(storage: Storage | null): string[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
