import { describe, expect, it } from "vitest";
import {
  ApprovalGate,
  isDangerousTool,
  summarizeToolArgs,
} from "../src/approval";

describe("isDangerousTool", () => {
  it("flags document-mutating tools", () => {
    for (const name of [
      "set_cell_range",
      "clear_cell_range",
      "modify_object",
      "delete_slide",
      "insert_paragraph",
      "edit_slide_text",
      "resize_range",
      "undo_edits",
      "eval_officejs",
      "execute_office_js",
      "pbi_execute_tmsl",
      "run-macro",
      "duplicate_slide",
    ]) {
      expect(isDangerousTool(name), name).toBe(true);
    }
  });

  it("lets read-only and harness tools pass", () => {
    for (const name of [
      "get_cell_ranges",
      "read",
      "bash",
      "todo_write",
      "verify_edits",
      "pbi_query",
      "screenshot_range",
      "ask_user_question",
    ]) {
      expect(isDangerousTool(name), name).toBe(false);
    }
  });
});

describe("summarizeToolArgs", () => {
  it("prefers the explanation field", () => {
    expect(
      summarizeToolArgs({ explanation: "fill Q3 totals", range: "B2:F9" }),
    ).toBe("fill Q3 totals");
  });

  it("falls back to trimmed JSON", () => {
    const summary = summarizeToolArgs({ values: "x".repeat(500) });
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary).toContain("values");
  });
});

describe("ApprovalGate", () => {
  it("auto mode resolves immediately without a pending card", async () => {
    const gate = new ApprovalGate("auto");
    expect(gate.requestConfirm("set_cell_range", {})).toBeNull();
    expect(gate.pending).toBeNull();
  });

  it("ask mode waits for approval and clears the card", async () => {
    const gate = new ApprovalGate("ask");
    const p = gate.requestConfirm("set_cell_range", {
      explanation: "write totals",
    })!;
    expect(gate.pending?.kind).toBe("confirm");
    expect(gate.pending?.toolName).toBe("set_cell_range");
    expect(gate.pending?.summary).toBe("write totals");

    gate.resolve(gate.pending!.id, { approved: true });
    await expect(p).resolves.toBe(true);
    expect(gate.pending).toBeNull();
  });

  it("deny resolves false with the reason available to the model", async () => {
    const gate = new ApprovalGate("ask");
    const p = gate.requestConfirm("clear_cell_range", {})!;
    gate.resolve(gate.pending!.id, { approved: false });
    await expect(p).resolves.toBe(false);
  });

  it("queues concurrent requests and resolves them in order", async () => {
    const gate = new ApprovalGate("ask");
    const first = gate.requestConfirm("set_cell_range", {})!;
    const second = gate.requestConfirm("modify_object", {})!;
    expect(gate.pending?.toolName).toBe("set_cell_range");

    gate.resolve(gate.pending!.id, { approved: true });
    await expect(first).resolves.toBe(true);
    expect(gate.pending?.toolName).toBe("modify_object");
    gate.resolve(gate.pending!.id, { approved: false });
    await expect(second).resolves.toBe(false);
  });

  it("questions return the typed answer, or null when dismissed", async () => {
    const gate = new ApprovalGate("ask");
    const p = gate.requestAnswer("Which column holds prices?")!;
    expect(gate.pending?.kind).toBe("question");
    expect(gate.pending?.question).toBe("Which column holds prices?");
    gate.resolve(gate.pending!.id, { answer: "column E" });
    await expect(p).resolves.toBe("column E");

    const p2 = gate.requestAnswer("Continue?")!;
    gate.resolve(gate.pending!.id, {}); // dismissed
    await expect(p2).resolves.toBeNull();
  });
});
