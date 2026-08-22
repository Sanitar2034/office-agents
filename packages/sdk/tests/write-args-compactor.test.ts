import { describe, expect, it } from "vitest";
import { compactBulkyToolArgs } from "../src/write-args-compactor";

/* eslint-disable @typescript-eslint/no-explicit-any */

function assistantWithToolCall(name: string, args: Record<string, any>) {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name, arguments: args }],
    timestamp: 1,
  } as never;
}
function userMsg(text: string) {
  return { role: "user", content: text, timestamp: 2 } as never;
}
function toolResult() {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    content: [{ type: "text", text: '{"success":true}' }],
    timestamp: 3,
  } as never;
}

describe("compactBulkyToolArgs", () => {
  it("replaces large values arrays in OLD write calls with a digest", () => {
    const bigValues = Array.from({ length: 40 }, (_, i) => [i, i * 2]);
    const messages = [
      assistantWithToolCall("set_cell_range", { range: "B2:C41", values: bigValues }),
      toolResult(),
      userMsg("done?"),
    ];

    const res = compactBulkyToolArgs(messages, 1);
    expect(res.compactedCalls).toBe(1);
    const first = res.messages[0] as any;
    const call = first.content[0];
    expect(call.name).toBe("set_cell_range");
    expect(call.id).toBe("call-1");
    expect(call.arguments.range).toBe("B2:C41");
    expect(String(call.arguments.values)).toMatch(/COMPACTED/i);
    // the tool result pair is untouched
    expect((res.messages[1] as any).content[0].text).toBe('{"success":true}');
  });

  it("leaves recent messages byte-identical (identity preserved)", () => {
    const bigValues = Array.from({ length: 40 }, () => [1, 2]);
    const old = assistantWithToolCall("set_cell_range", { range: "A1", values: bigValues });
    const recent = assistantWithToolCall("set_cell_range", { range: "B9", values: bigValues });
    const messages = [old, toolResult(), recent];

    const res = compactBulkyToolArgs(messages, 2);
    expect(res.compactedCalls).toBe(1);
    expect(res.messages[2]).toBe(recent); // same reference, untouched
    expect(res.messages[1]).toBe(messages[1]);
    expect(res.messages[0]).not.toBe(old); // copied and compacted
  });

  it("ignores small arrays and short strings", () => {
    const messages = [
      assistantWithToolCall("set_cell_range", { range: "A1:B2", values: [[1, 2]] }),
      toolResult(),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.compactedCalls).toBe(0);
    expect(res.messages).toBe(messages); // identity: nothing changed
  });

  it("compacts long code arguments of officejs tools", () => {
    const messages = [
      assistantWithToolCall("eval_officejs", {
        code: "const x = 1;\n".repeat(200),
      }),
      toolResult(),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.compactedCalls).toBe(1);
    const call = (res.messages[0] as any).content[0];
    expect(String(call.arguments.code)).toMatch(/COMPACTED.*code/i);
  });

  it("never touches non-bulky tools (read, todo_write, bash)", () => {
    const messages = [
      assistantWithToolCall("read", { path: "x".repeat(2000) }),
      toolResult(),
      assistantWithToolCall("todo_write", { todos: new Array(20).fill({ content: "x", status: "pending" }) }),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.compactedCalls).toBe(0);
    expect(res.messages).toBe(messages);
  });
});
