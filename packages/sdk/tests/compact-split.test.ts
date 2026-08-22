import { describe, expect, it } from "vitest";
import { findCompactSplit } from "../src/compact-split";

/* eslint-disable @typescript-eslint/no-explicit-any */

const user = (t: string) => ({ role: "user", content: t, timestamp: 1 }) as any;
const assistant = (calls = 1, text = "") =>
  ({
    role: "assistant",
    content: [
      ...(text ? [{ type: "text", text }] : []),
      ...Array.from({ length: calls }, (_, i) => ({
        type: "toolCall",
        id: `c${i}`,
        name: "set_cell_range",
        arguments: {},
      })),
    ],
    timestamp: 2,
  }) as any;
const result = (id: string) =>
  ({ role: "toolResult", toolCallId: id, content: [], isError: false, timestamp: 3 }) as any;

describe("findCompactSplit", () => {
  it("splits on the last user boundary outside keepRecent", () => {
    const messages = [
      user("task A"),
      assistant(2),
      result("c0"),
      result("c1"),
      user("task B"),
      assistant(1),
      result("c0"),
      user("task C"),
      assistant(1),
      result("c0"),
    ];
    const split = findCompactSplit(messages, 3);
    expect(messages[split].role).toBe("user");
    expect(split).toBeLessThanOrEqual(messages.length - 3);
  });

  it("parallel-tail transcript: still makes PROGRESS (oldMessages >= 2, kept < length)", () => {
    // no user message in the whole search window; ends with a parallel batch tail
    const messages = [
      user("go"), // index 0 - far outside the search window
      ...Array.from({ length: 6 }, (_, i) => assistant(1, `step ${i}`)),
      ...Array.from({ length: 8 }, (_, i) => result(`c${i}`)),
    ]; // len 15, keepRecent 6
    const split = findCompactSplit(messages, 6);
    expect(split).toBeLessThan(messages.length - 1); // kept is non-trivial
    expect(split).toBeGreaterThanOrEqual(2); // oldMessages has real content
    // kept must not start with a toolResult (pair safety)
    expect(messages[split].role).not.toBe("toolResult");
  });

  it("never starts kept on a toolResult (walks whole result runs)", () => {
    const messages = [
      user("go"),
      assistant(3),
      result("c0"),
      result("c1"),
      user("next"),
      assistant(1),
      result("c0"),
    ];
    const split = findCompactSplit(messages, 2);
    expect(messages[split].role).not.toBe("toolResult");
  });

  it("returns 0 when there is nothing splittable", () => {
    const messages = [user("hi"), assistant(1), result("c0")];
    expect(findCompactSplit(messages, 6)).toBe(0);
  });
});
