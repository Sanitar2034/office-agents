/**
 * Human-in-the-loop gate for document-mutating tools (Codex-style
 * permission modes) plus the ask_user_question channel. The gate lives in
 * the runtime; the UI renders `pending` as a card above the chat input and
 * resolves it via approve/deny/answer.
 */

export type PermissionMode = "ask" | "auto";

export interface PendingApproval {
  id: string;
  kind: "confirm" | "question";
  toolName?: string;
  summary?: string;
  question?: string;
}

/** Tool names that mutate the document (or an external model) and need consent. */
const DANGEROUS_TOOL_PATTERNS: RegExp[] = [
  /^set_/,
  /^clear_/,
  /^modify_/,
  /^delete_/,
  /^insert_/,
  /^edit_/,
  /^resize_/,
  /^copy_to/,
  /^undo_/,
  /^duplicate_/,
  /^eval_officejs$/,
  /^execute_office_js$/,
  /^pbi_execute_tmsl$/,
  /^run[-_]macro$/,
];

export function isDangerousTool(name: string): boolean {
  return DANGEROUS_TOOL_PATTERNS.some((p) => p.test(name));
}

export function summarizeToolArgs(args: Record<string, unknown>): string {
  const explanation = args?.explanation;
  if (typeof explanation === "string" && explanation.trim()) {
    return explanation.trim().slice(0, 200);
  }
  try {
    const json = JSON.stringify(args ?? {});
    return json.length > 200 ? `${json.slice(0, 197)}…` : json;
  } catch {
    return "";
  }
}

interface Waiting {
  approval: PendingApproval;
  settle: (value: boolean | string | null) => void;
}

export class ApprovalGate {
  #mode: PermissionMode;
  #queue: Waiting[] = [];
  #nextId = 1;
  #onChange: (pending: PendingApproval | null) => void;

  constructor(
    mode: PermissionMode,
    onChange: (pending: PendingApproval | null) => void = () => {},
  ) {
    this.#mode = mode;
    this.#onChange = onChange;
  }

  get mode(): PermissionMode {
    return this.#mode;
  }

  setMode(mode: PermissionMode) {
    this.#mode = mode;
  }

  get pending(): PendingApproval | null {
    return this.#queue[0]?.approval ?? null;
  }

  /**
   * Ask the user to confirm a dangerous tool call.
   * Returns null when auto mode allows the call without asking.
   */
  requestConfirm(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<boolean> | null {
    if (this.#mode === "auto") return null;
    return new Promise<boolean>((resolve) => {
      this.#enqueue(
        {
          id: `approval-${this.#nextId++}`,
          kind: "confirm",
          toolName,
          summary: summarizeToolArgs(args),
        },
        (value) => resolve(value === true),
      );
    });
  }

  /** Ask the user a free-text question; resolves null when dismissed. */
  requestAnswer(question: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.#enqueue(
        {
          id: `question-${this.#nextId++}`,
          kind: "question",
          question,
        },
        (value) => resolve(typeof value === "string" ? value : null),
      );
    });
  }

  /** Dismiss the pending card without an answer (stream aborted etc). */
  cancelPending() {
    const w = this.#queue.shift();
    if (w) {
      w.settle(null);
      this.#emit();
    }
  }

  resolve(id: string, outcome: { approved?: boolean; answer?: string }) {
    const w = this.#queue[0];
    if (!w || w.approval.id !== id) return;
    this.#queue.shift();
    if (w.approval.kind === "confirm") {
      w.settle(outcome.approved === true);
    } else {
      w.settle(typeof outcome.answer === "string" ? outcome.answer : null);
    }
    this.#emit();
  }

  #enqueue(
    approval: PendingApproval,
    settle: (value: boolean | string | null) => void,
  ) {
    this.#queue.push({ approval, settle });
    this.#emit();
  }

  #emit() {
    this.#onChange(this.pending);
  }
}
