import type { StorageNamespace } from "../context";

const MAX_CONVENTIONS_CHARS = 8000;

function conventionsKey(ns: StorageNamespace, documentId: string | null): string {
  return `${ns.documentSettingsPrefix}-conventions:${documentId ?? "global"}`;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function getDocumentConventions(
  ns: StorageNamespace,
  documentId: string | null,
  storage: Storage | null = safeStorage(),
): string {
  try {
    return storage?.getItem(conventionsKey(ns, documentId)) ?? "";
  } catch {
    return "";
  }
}

export function setDocumentConventions(
  ns: StorageNamespace,
  documentId: string | null,
  text: string,
  storage: Storage | null = safeStorage(),
): void {
  try {
    const trimmed = text.trim().slice(0, MAX_CONVENTIONS_CHARS);
    const key = conventionsKey(ns, documentId);
    if (!trimmed) {
      storage?.removeItem(key);
    } else {
      storage?.setItem(key, trimmed);
    }
  } catch {
    // storage full or unavailable - conventions are best-effort
  }
}

/** Prompt fragment appended to the system prompt when conventions exist. */
export function buildConventionsSection(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return (
    "\n## Document Conventions (set by the user for this document)\n" +
    "Follow these rules for every action in this document:\n\n" +
    trimmed +
    "\n"
  );
}
