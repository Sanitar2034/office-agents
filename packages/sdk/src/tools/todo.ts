import { Type } from "@sinclair/typebox";
import { defineTool, toolError, toolSuccess } from "./types";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

/** Backing store owned by the runtime; the UI reads it from RuntimeState. */
export interface TodoStore {
  get(): TodoItem[];
  set(todos: TodoItem[]): void;
}

const MAX_TODOS = 20;

const STATUS_ALIASES: Record<string, TodoStatus> = {
  pending: "pending",
  todo: "pending",
  queued: "pending",
  in_progress: "in_progress",
  started: "in_progress",
  active: "in_progress",
  doing: "in_progress",
  completed: "completed",
  complete: "completed",
  done: "completed",
  finished: "completed",
};

export function normalizeTodoStatus(raw: unknown): TodoStatus {
  return STATUS_ALIASES[String(raw).toLowerCase()] ?? "pending";
}

export function createTodoTool(store: TodoStore) {
  return defineTool({
    name: "todo_write",
    label: "Update Task List",
    description:
      "Maintain the task ledger for the current job. Each call REPLACES the whole list. " +
      "Call it: right after accepting any task with more than two steps; whenever a step " +
      "starts or finishes; and once when everything is done. Keep exactly one task " +
      "in_progress at a time and mark items completed only after verifying them.",
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String({
            description: "Short imperative task title",
            maxLength: 120,
          }),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
          ]),
        }),
        { description: "The complete task list", maxItems: 20 },
      ),
    }),
    execute: async (_toolCallId, params) => {
      const todos: TodoItem[] = (params.todos ?? []).map((t) => ({
        content: String(t.content ?? "").trim(),
        status: normalizeTodoStatus(t.status),
      }));

      if (todos.length > MAX_TODOS) {
        return toolError(
          `Too many tasks (${todos.length}); the ledger holds at most ${MAX_TODOS}. ` +
            "Split the work or drop finished items.",
        );
      }
      if (todos.some((t) => !t.content)) {
        return toolError("Every task needs a non-empty content string.");
      }
      const inProgress = todos.filter((t) => t.status === "in_progress").length;
      if (inProgress > 1) {
        return toolError(
          `Only one task may be in_progress at a time (got ${inProgress}). ` +
            "Finish or pause the current step before starting the next.",
        );
      }

      store.set(todos);
      return toolSuccess({
        ok: true,
        total: todos.length,
        completed: todos.filter((t) => t.status === "completed").length,
        inProgress,
      });
    },
  });
}
