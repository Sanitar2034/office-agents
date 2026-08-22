import { describe, expect, it } from "vitest";
import {
  createTodoTool,
  type TodoItem,
  type TodoStore,
} from "../src/tools/todo";

function memStore(initial: TodoItem[] = []): TodoStore & { snapshot: () => TodoItem[] } {
  const s = { value: initial };
  return {
    get: () => s.value,
    set: (todos: TodoItem[]) => {
      s.value = todos;
    },
    snapshot: () => s.value,
  };
}

describe("todo_write tool", () => {
  it("replaces the whole list in the store and reports counts", async () => {
    const store = memStore([{ content: "old", status: "completed" }]);
    const tool = createTodoTool(store);

    const res = await tool.execute("t1", {
      todos: [
        { content: "fetch data", status: "completed" },
        { content: "write report", status: "in_progress" },
        { content: "verify", status: "pending" },
      ],
    });

    const text = res.content[0] as { type: string; text?: string };
    const parsed = JSON.parse(text.text ?? "{}");
    expect(parsed.ok).toBe(true);
    expect(parsed.total).toBe(3);
    expect(parsed.completed).toBe(1);
    expect(store.snapshot().map((t) => t.content)).toEqual([
      "fetch data",
      "write report",
      "verify",
    ]);
  });

  it("accepts an empty list (clears the ledger)", async () => {
    const store = memStore([{ content: "stale", status: "pending" }]);
    const tool = createTodoTool(store);

    const res = await tool.execute("t1", { todos: [] });

    const text = res.content[0] as { type: string; text?: string };
    expect(JSON.parse(text.text ?? "{}").ok).toBe(true);
    expect(store.snapshot()).toEqual([]);
  });

  it("rejects more than one in_progress task with guidance", async () => {
    const store = memStore();
    const tool = createTodoTool(store);

    const res = await tool.execute("t1", {
      todos: [
        { content: "a", status: "in_progress" },
        { content: "b", status: "in_progress" },
      ],
    });

    const text = res.content[0] as { type: string; text?: string };
    const parsed = JSON.parse(text.text ?? "{}");
    expect(parsed.success).toBe(false);
    expect(String(parsed.error)).toMatch(/in_progress at a time/i);
    expect(store.snapshot()).toEqual([]);
  });

  it("rejects lists over 20 items", async () => {
    const store = memStore();
    const tool = createTodoTool(store);

    const todos = Array.from({ length: 21 }, (_, i) => ({
      content: `task ${i}`,
      status: "pending" as const,
    }));
    const res = await tool.execute("t1", { todos });

    const text = res.content[0] as { type: string; text?: string };
    expect(JSON.parse(text.text ?? "{}").success).toBe(false);
    expect(store.snapshot()).toEqual([]);
  });

  it("maps close status spellings to canonical ones, unknowns to pending", async () => {
    const store = memStore();
    const tool = createTodoTool(store);

    const res = await tool.execute("t1", {
      todos: [
        { content: "a", status: "done" },
        { content: "b", status: "started" },
        { content: "c", status: "weird" },
      ] as unknown as TodoItem[],
    });

    expect(store.snapshot().map((t) => t.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
    const text = res.content[0] as { type: string; text?: string };
    expect(JSON.parse(text.text ?? "{}").ok).toBe(true);
  });
});
