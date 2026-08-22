import { describe, expect, it } from "vitest";
import { compactBulkyToolArgs } from "../src/write-args-compactor";

/* eslint-disable @typescript-eslint/no-explicit-any */

function assistantWithToolCalls(
  calls: Array<{ id: string; name: string; args: Record<string, any> }>,
  text = "",
) {
  return {
    role: "assistant",
    content: [
      ...(text ? [{ type: "text", text }] : []),
      ...calls.map((c) => ({
        type: "toolCall",
        id: c.id,
        name: c.name,
        arguments: c.args,
      })),
    ],
    timestamp: 1,
  } as never;
}
function toolResult(id: string, isError = false) {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "set_cell_range",
    content: [
      { type: "text", text: isError ? '{"success":false,"error":"bad range"}' : '{"success":true}' },
    ],
    isError,
    timestamp: 3,
  } as never;
}
function userMsg(text: string) {
  return { role: "user", content: text, timestamp: 2 } as never;
}

describe("compactBulkyToolArgs: per-tool digests", () => {
  it("set_cell_range: grid shape + range in the digest", () => {
    const values = Array.from({ length: 40 }, () => [1, 2, 3]);
    const messages = [
      assistantWithToolCalls([
        { id: "c1", name: "set_cell_range", args: { range: "B2:D41", values } },
      ]),
      toolResult("c1"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    const call = (res.messages[0] as any).content[0];
    const digest = String(call.arguments.values);
    expect(digest).toMatch(/40×3/);
    expect(digest).toMatch(/B2:D41/);
  });

  it("edit_slide_text: slide/shape plus the first line of the new text", () => {
    const messages = [
      assistantWithToolCalls([
        {
          id: "c1",
          name: "edit_slide_text",
          args: { slide_index: 2, shape_id: 12, text: "Quarterly Revenue\n".repeat(120) },
        },
      ]),
      toolResult("c1"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    const digest = String((res.messages[0] as any).content[0].arguments.text);
    expect(digest).toMatch(/slide 3/);
    expect(digest).toMatch(/shape 12/);
    expect(digest).toMatch(/Quarterly Revenue/);
  });

  it("officejs code: explanation plus the code opening", () => {
    const messages = [
      assistantWithToolCalls([
        {
          id: "c1",
          name: "execute_office_js",
          args: { code: "const sheet = ctx.workbook;\n".repeat(80), explanation: "fill Q3 totals" },
        },
      ]),
      toolResult("c1"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    const digest = String((res.messages[0] as any).content[0].arguments.code);
    expect(digest).toMatch(/fill Q3 totals/);
    expect(digest).toMatch(/const sheet/);
  });

  it("tmsl command: names the operation and table when parseable", () => {
    const cmd = JSON.stringify({
      createOrReplace: { table: { name: "Sales" } },
    }).repeat(1) + " ".repeat(900);
    const messages = [
      assistantWithToolCalls([
        { id: "c1", name: "pbi_execute_tmsl", args: { command: cmd } },
      ]),
      toolResult("c1"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    const digest = String((res.messages[0] as any).content[0].arguments.command);
    expect(digest).toMatch(/createOrReplace/i);
    expect(digest).toMatch(/Sales/);
  });

  it("leaves small payloads and non-bulky tools untouched (identity)", () => {
    const messages = [
      assistantWithToolCalls([
        { id: "c1", name: "set_cell_range", args: { range: "A1:B2", values: [[1, 2]] } },
      ]),
      toolResult("c1"),
      assistantWithToolCalls([{ id: "c2", name: "read", args: { path: "x" } }]),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.compactedCalls).toBe(0);
    expect(res.messages).toBe(messages);
  });
});

describe("compactBulkyToolArgs: failed calls are removed entirely", () => {
  const bigValues = Array.from({ length: 40 }, () => [1, 2]);

  it("drops the failed call and its result as a pair", () => {
    const messages = [
      userMsg("write data"),
      assistantWithToolCalls([
        { id: "bad", name: "set_cell_range", args: { range: "X1", values: bigValues } },
      ]),
      toolResult("bad", true),
      assistantWithToolCalls([
        { id: "good", name: "set_cell_range", args: { range: "B2:C41", values: bigValues } },
      ]),
      toolResult("good"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.removedFailedCalls).toBe(1);
    const text = JSON.stringify(res.messages);
    expect(text).not.toContain('"bad"');
    expect(text).not.toContain("bad range");
    expect(text).toContain('"good"');
  });

  it("keeps assistant text when only one of two sibling calls failed", () => {
    const messages = [
      assistantWithToolCalls(
        [
          { id: "bad", name: "set_cell_range", args: { range: "X1", values: bigValues } },
          { id: "good", name: "set_cell_range", args: { range: "B2:C41", values: bigValues } },
        ],
        "Writing two blocks",
      ),
      toolResult("bad", true),
      toolResult("good"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.removedFailedCalls).toBe(1);
    const first = res.messages[0] as any;
    expect(first.content.some((b: any) => b.type === "text")).toBe(true);
    expect(first.content.filter((b: any) => b.type === "toolCall")).toHaveLength(1);
    expect((first.content.find((b: any) => b.type === "toolCall") as any).id).toBe("good");
  });

  it("removes the assistant message when its only call failed", () => {
    const messages = [
      userMsg("go"),
      assistantWithToolCalls([
        { id: "bad", name: "set_cell_range", args: { range: "X1", values: bigValues } },
      ]),
      toolResult("bad", true),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.messages.map((m: any) => m.role)).toEqual(["user"]);
  });

  it("never removes recent failures (inside keepRecent)", () => {
    const messages = [
      assistantWithToolCalls([
        { id: "bad", name: "set_cell_range", args: { range: "X1", values: bigValues } },
      ]),
      toolResult("bad", true),
    ];
    const res = compactBulkyToolArgs(messages, 2);
    expect(res.removedFailedCalls).toBe(0);
    expect(res.messages).toBe(messages);
  });
});
