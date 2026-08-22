import type { StorageNamespace } from "./context";

/**
 * Audit trail of compaction runs: what was digested / removed, token
 * savings - the ground truth needed to verify compaction correctness and
 * to tune thresholds later. Ring buffer of the last 50 runs in
 * localStorage; export from the Settings panel for offline analysis.
 */

export interface CompactedCallInfo {
  tool: string;
  /** digest length in chars */
  digestChars: number;
  /** original argument size in chars */
  originalChars: number;
}

export interface RemovedFailedCallInfo {
  tool: string;
  /** first chars of the error result */
  error: string;
}

export interface CompactionLogEntry {
  ts: number;
  kind: "structural" | "summary";
  messagesBefore: number;
  messagesAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  compactedCalls: CompactedCallInfo[];
  removedFailedCalls: RemovedFailedCallInfo[];
}

const MAX_ENTRIES = 50;

function logKey(ns: StorageNamespace): string {
  return `${ns.localStoragePrefix}-compaction-log`;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function appendCompactionLog(
  ns: StorageNamespace,
  entry: CompactionLogEntry,
  storage: Storage | null = safeStorage(),
): void {
  try {
    const log = getCompactionLog(ns, storage);
    log.push(entry);
    storage?.setItem(
      logKey(ns),
      JSON.stringify(log.slice(-MAX_ENTRIES)),
    );
  } catch {
    // best-effort: logging must never break compaction
  }
}

export function getCompactionLog(
  ns: StorageNamespace,
  storage: Storage | null = safeStorage(),
): CompactionLogEntry[] {
  try {
    const raw = storage?.getItem(logKey(ns));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is CompactionLogEntry =>
        e && typeof e === "object" && typeof e.ts === "number",
    );
  } catch {
    return [];
  }
}

/** Human-readable export: token savings computed per entry. */
export function exportCompactionLogJson(
  entries: CompactionLogEntry[],
): string {
  return JSON.stringify(
    entries.map((e) => ({
      ...e,
      savedTokens: Math.max(0, e.tokensBefore - e.tokensAfter),
      savedMessages: Math.max(0, e.messagesBefore - e.messagesAfter),
    })),
    null,
    2,
  );
}
