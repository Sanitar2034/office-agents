import { describe, expect, it } from "vitest";
import { compactBulkyToolArgs } from "../src/write-args-compactor";

/* eslint-disable @typescript-eslint/no-explicit-any */

// fixtures use the REAL tool argument shapes:
// set_cell_range -> { sheetId, range, cells: CellSchema[][] }
// edit_slide_*   -> { slide_index, shape_id?, code }
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
      {
        type: "text",
        text: isError ? '{"success":false,"error":"overwrite protection"}' : '{"success":true}',
      },
    ],
    isError,
    timestamp: 3,
  } as never;
}
function userMsg(text: string) {
  return { role: "user", content: text, timestamp: 2 } as never;
}

/** CellSchema: {value, formula?, note?, cellStyles?...} like the real tool */
function cellsGrid(rows: number, cols: number) {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (_, c) => ({
      value: c % 2 === 0 ? c * 3 : `v${c}`,
      cellStyles: { bold: true },
    })),
  );
}

describe("compactBulkyToolArgs: per-tool digests (REAL schemas)", () => {
  it("set_cell_range: cells grid -> shape + range digest, sheetId kept", () => {
    const messages = [
      assistantWithToolCalls([
        { id: "c1", name: "set_cell_range", args: { sheetId: 2, range: "B2:D41", cells: cellsGrid(40, 3) } },
      ]),
      toolResult("c1"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    const call = (res.messages[0] as any).content.find((b: any) => b.type === "toolCall");
    const digest = String(call.arguments.cells);
    expect(digest).toMatch(/40×3/);
    expect(digest).toMatch(/B2:D41/);
    expect(call.arguments.sheetId).toBe(2); // untouched sibling
    expect(call.arguments.range).toBe("B2:D41");
    expect(res.compactedCalls).toBe(1);
    expect(res.compactedDetails[0].tool).toBe("set_cell_range");
    expect(res.compactedDetails[0].originalChars).toBeGreaterThan(
      res.compactedDetails[0].digestChars,
    );
  });

  it("set_cell_range: wide-but-short grids are also bulky (total cells counted)", () => {
    const messages = [
      assistantWithToolCalls([
        { id: "c1", name: "set_cell_range", args: { sheetId: 1, range: "A1:CV24", cells: cellsGrid(24, 100) } },
      ]),
      toolResult("c1"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.compactedCalls).toBe(1);
  });

  it("edit_slide_text: code digest keeps slide/shape and the code opening", () => {
    const messages = [
      assistantWithToolCalls([
        {
          id: "c1",
          name: "edit_slide_text",
          args: { slide_index: 2, shape_id: "12", code: "<a:p>Quarterly</a:p>\n".repeat(120) },
        },
      ]),
      toolResult("c1"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    const digest = String((res.messages[0] as any).content[0].arguments.code);
    expect(digest).toMatch(/slide 3/);
    expect(digest).toMatch(/shape 12/);
    expect(digest).toMatch(/Quarterly/);
  });

  it("officejs code without explanation yields a BALANCED digest", () => {
    const messages = [
      assistantWithToolCalls([
        { id: "c1", name: "execute_office_js", args: { code: "const x=1;\n".repeat(200) } },
      ]),
      toolResult("c1"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    const digest = String((res.messages[0] as any).content[0].arguments.code);
    expect(digest.startsWith("[COMPACTED")).toBe(true);
    expect(digest.endsWith("]")).toBe(true);
    expect((digest.match(/\(/g) ?? []).length).toBe((digest.match(/\)/g) ?? []).length);
  });

  it("tmsl command: parsed verb + table when JSON-shaped", () => {
    const cmd = JSON.stringify({ createOrReplace: { table: { name: "Sales" } } }) + " ".repeat(900);
    const messages = [
      assistantWithToolCalls([{ id: "c1", name: "pbi_execute_tmsl", args: { command: cmd } }]),
      toolResult("c1"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    const digest = String((res.messages[0] as any).content[0].arguments.command);
    expect(digest).toMatch(/createOrReplace/i);
    expect(digest).toMatch(/Sales/);
  });

  it("small payloads and non-bulky tools untouched (identity)", () => {
    const messages = [
      assistantWithToolCalls([
        { id: "c1", name: "set_cell_range", args: { sheetId: 1, range: "A1:B2", cells: cellsGrid(2, 2) } },
      ]),
      toolResult("c1"),
      assistantWithToolCalls([{ id: "c2", name: "read", args: { path: "x" } }]),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.compactedCalls).toBe(0);
    expect(res.messages).toBe(messages);
  });

  it("idempotent: second pass over digests is an identity no-op", () => {
    const first = compactBulkyToolArgs(
      [
        assistantWithToolCalls([
          { id: "c1", name: "set_cell_range", args: { sheetId: 1, range: "B2:D41", cells: cellsGrid(40, 3) } },
        ]),
        toolResult("c1"),
      ],
      0,
    );
    const second = compactBulkyToolArgs(first.messages, 0);
    expect(second.compactedCalls).toBe(0);
    expect(second.messages).toBe(first.messages);
  });

  it("untouched messages keep reference identity while others are digested", () => {
    const victim = assistantWithToolCalls([
      { id: "c1", name: "set_cell_range", args: { sheetId: 1, range: "B2:D41", cells: cellsGrid(40, 3) } },
    ]);
    const keeperMsg = userMsg("hello");
    const keeperRes = toolResult("c1");
    const res = compactBulkyToolArgs([victim, keeperRes, keeperMsg], 0);
    expect(res.messages[1]).toBe(keeperRes);
    expect(res.messages[2]).toBe(keeperMsg);
    expect(res.messages[0]).not.toBe(victim);
  });
});

describe("compactBulkyToolArgs: failed-call removal", () => {
  const big = cellsGrid(40, 2);

  it("drops failed (call+result) pairs and reports details", () => {
    const messages = [
      userMsg("write data"),
      assistantWithToolCalls([
        { id: "bad", name: "set_cell_range", args: { sheetId: 1, range: "X1", cells: big } },
      ]),
      toolResult("bad", true),
      assistantWithToolCalls([
        { id: "good", name: "set_cell_range", args: { sheetId: 1, range: "B2:C41", cells: big } },
      ]),
      toolResult("good"),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.removedFailedCalls).toBe(1);
    expect(res.removedDetails[0].error).toMatch(/overwrite protection/);
    const text = JSON.stringify(res.messages);
    expect(text).not.toContain('"bad"');
    expect(text).toContain('"good"');
  });

  it("cutoff BETWEEN call and result: the pair survives intact", () => {
    // assistant(call) at len-2, result at len-1, keepRecent=1 -> result recent, call old
    const messages = [
      assistantWithToolCalls([
        { id: "c1", name: "set_cell_range", args: { sheetId: 1, range: "B2:C41", cells: big } },
      ]),
      toolResult("c1", true), // even a FAILED one: pair must survive, not orphan
    ];
    const res = compactBulkyToolArgs(messages, 1);
    expect(res.removedFailedCalls).toBe(0); // result is recent -> not collected
    expect(res.messages).toHaveLength(2);
    expect((res.messages[0] as any).content[0].id).toBe("c1");
  });

  it("parallel straddle: only the old failed pair is removed", () => {
    // one assistant with c1,c2; R1 (fail) old, R2 (ok) recent
    const messages = [
      assistantWithToolCalls([
        { id: "c1", name: "set_cell_range", args: { sheetId: 1, range: "X1", cells: big } },
        { id: "c2", name: "set_cell_range", args: { sheetId: 1, range: "B2", cells: big } },
      ]),
      toolResult("c1", true),
      toolResult("c2"),
    ];
    const res = compactBulkyToolArgs(messages, 1); // only R2 recent
    expect(res.removedFailedCalls).toBe(1);
    const assistant = res.messages.find((m: any) => m.role === "assistant") as any;
    const calls = assistant.content.filter((b: any) => b.type === "toolCall");
    expect(calls.map((c: any) => c.id)).toEqual(["c2"]);
    const results = res.messages.filter((m: any) => m.role === "toolResult");
    expect(results).toHaveLength(1);
    expect((results[0] as any).toolCallId).toBe("c2");
  });

  it("removes the assistant message when its only call failed", () => {
    const messages = [
      userMsg("go"),
      assistantWithToolCalls([
        { id: "bad", name: "set_cell_range", args: { sheetId: 1, range: "X1", cells: big } },
      ]),
      toolResult("bad", true),
    ];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.messages.map((m: any) => m.role)).toEqual(["user"]);
  });

  it("never removes recent failures", () => {
    const messages = [
      assistantWithToolCalls([
        { id: "bad", name: "set_cell_range", args: { sheetId: 1, range: "X1", cells: big } },
      ]),
      toolResult("bad", true),
    ];
    const res = compactBulkyToolArgs(messages, 2);
    expect(res.removedFailedCalls).toBe(0);
    expect(res.messages).toBe(messages);
  });

  it("user messages with array content pass through untouched", () => {
    const fancy = {
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image", data: "x".repeat(2000), mimeType: "image/png" },
      ],
      timestamp: 9,
    } as never;
    const messages = [fancy, toolResult("c1")];
    const res = compactBulkyToolArgs(messages, 0);
    expect(res.messages[0]).toBe(fancy);
  });
});
