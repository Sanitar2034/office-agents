import type { StorageNamespace } from "./context";

/**
 * Deterministic pre-tool hooks (Claude-Code-style guardrails without
 * trusting the LLM): user-defined rules that block or log tool calls by
 * name pattern, applied BEFORE the tool executes.
 */

export type ToolHookAction = "block" | "log";

export interface ToolHookRule {
  /** Tool name or glob pattern with * (e.g. "pbi_*", "set_cell_range"). */
  toolPattern: string;
  action: ToolHookAction;
  /** Explanation returned to the model when the call is blocked. */
  note?: string;
}

function hooksKey(ns: StorageNamespace): string {
  return `${ns.localStoragePrefix}-tool-hooks`;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

const VALID_ACTIONS: ToolHookAction[] = ["block", "log"];

/** Validate raw (possibly user-typed JSON) rules; bad entries get errors. */
export function validateHookRules(
  raw: unknown,
): { rules: ToolHookRule[]; errors: string[] } {
  const rules: ToolHookRule[] = [];
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    return { rules, errors: ["hooks must be a JSON array"] };
  }
  raw.forEach((item, i) => {
    if (typeof item !== "object" || item === null) {
      errors.push(`rule ${i}: must be an object`);
      return;
    }
    const r = item as Record<string, unknown>;
    const toolPattern = typeof r.toolPattern === "string" ? r.toolPattern.trim() : "";
    const action = r.action;
    if (!toolPattern) errors.push(`rule ${i}: toolPattern is required`);
    else if (/[^\w*?\-]/.test(toolPattern))
      errors.push(`rule ${i}: toolPattern may only use letters, digits, *, ?, - and _`);
    if (!VALID_ACTIONS.includes(action as ToolHookAction))
      errors.push(`rule ${i}: action must be "block" or "log"`);
    if (errors.length === 0 || !errors.some((e) => e.startsWith(`rule ${i}:`))) {
      rules.push({
        toolPattern,
        action: action as ToolHookAction,
        note: typeof r.note === "string" ? r.note.slice(0, 200) : undefined,
      });
    }
  });
  return { rules, errors };
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/** First matching rule wins. */
export function matchToolHook(
  toolName: string,
  rules: ToolHookRule[],
): ToolHookRule | null {
  for (const rule of rules) {
    if (globToRegExp(rule.toolPattern).test(toolName)) return rule;
  }
  return null;
}

export function loadToolHooks(
  ns: StorageNamespace,
  storage: Storage | null = safeStorage(),
): ToolHookRule[] {
  try {
    const raw = storage?.getItem(hooksKey(ns));
    if (!raw) return [];
    const { rules } = validateHookRules(JSON.parse(raw));
    return rules;
  } catch {
    return [];
  }
}

export function saveToolHooks(
  ns: StorageNamespace,
  rules: ToolHookRule[],
  storage: Storage | null = safeStorage(),
): void {
  try {
    storage?.setItem(hooksKey(ns), JSON.stringify(rules.slice(0, 50)));
  } catch {
    // best-effort
  }
}
