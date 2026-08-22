import type { StorageNamespace } from "../context";

const MAX_MEMORY_CHARS = 16000;

function memoryKey(ns: StorageNamespace): string {
  return `${ns.localStoragePrefix}-agent-memory`;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function getAgentMemory(
  ns: StorageNamespace,
  storage: Storage | null = safeStorage(),
): string {
  try {
    return storage?.getItem(memoryKey(ns)) ?? "";
  } catch {
    return "";
  }
}

export function setAgentMemory(
  ns: StorageNamespace,
  text: string,
  storage: Storage | null = safeStorage(),
): void {
  try {
    const trimmed = text.trim().slice(0, MAX_MEMORY_CHARS);
    const key = memoryKey(ns);
    if (!trimmed) {
      storage?.removeItem(key);
    } else {
      storage?.setItem(key, trimmed);
    }
  } catch {
    // best-effort
  }
}

/** Append one dated fact; back-to-back duplicates are skipped. */
export function appendAgentMemory(
  ns: StorageNamespace,
  fact: string,
  storage: Storage | null = safeStorage(),
): void {
  const line = fact.trim();
  if (!line) return;
  const current = getAgentMemory(ns, storage);
  const lines = current ? current.split("\n") : [];
  const last = lines[lines.length - 1] ?? "";
  if (last.includes(line)) return; // same fact appended twice in a row
  const stamp = new Date().toISOString().slice(0, 10);
  lines.push(`- ${line} (${stamp})`);
  setAgentMemory(ns, lines.join("\n").slice(-MAX_MEMORY_CHARS), storage);
}

/** Prompt fragment with the remembered facts + write instructions. */
export function buildMemorySection(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return (
    "\n## Agent Memory (persists across sessions)\n" +
    "Facts previously saved about this user - apply them proactively:\n\n" +
    trimmed +
    "\n\nAdd new stable facts with `memory_write` (mode=append); " +
    "rewrite the whole memory with mode=replace only when it is clearly wrong.\n"
  );
}
