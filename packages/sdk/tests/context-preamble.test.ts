import { describe, expect, it } from "vitest";
import {
  buildContextPreamble,
  injectPreamble,
  PREAMBLE_MARKERS,
} from "../src/context-preamble";

const user = (text: string) =>
  ({ role: "user", content: text, timestamp: 1 }) as never;
const assistant = (text: string) =>
  ({ role: "assistant", content: text, timestamp: 2 }) as never;

describe("buildContextPreamble", () => {
  it("returns null when both conventions and memory are empty", () => {
    expect(buildContextPreamble("", "   ")).toBeNull();
  });

  it("wraps each present section with a stable marker", () => {
    const text = buildContextPreamble("no row 3 edits", "prefers rubles")!;
    expect(text).toContain(PREAMBLE_MARKERS.conventions);
    expect(text).toContain("no row 3 edits");
    expect(text).toContain(PREAMBLE_MARKERS.memory);
    expect(text).toContain("prefers rubles");
    // conventions come first: stable ordering for prefix caching
    expect(text.indexOf(PREAMBLE_MARKERS.conventions)).toBeLessThan(
      text.indexOf(PREAMBLE_MARKERS.memory),
    );
  });

  it("omits the missing section entirely", () => {
    const text = buildContextPreamble("", "only memory")!;
    expect(text).not.toContain(PREAMBLE_MARKERS.conventions);
    expect(text).toContain("only memory");
  });
});

describe("injectPreamble", () => {
  it("returns the same array when nothing changes (identity for cache)", () => {
    const msgs = [user("hi"), assistant("hello")];
    expect(injectPreamble(msgs, null)).toBe(msgs);
  });

  it("prepends the preamble as a user message and keeps history", () => {
    const msgs = [user("hi"), assistant("hello")];
    const out = injectPreamble(msgs, buildContextPreamble("rule", "")!)!;
    expect(out).toHaveLength(3);
    expect(out[0].content).toContain("rule");
    expect(out[1].content).toBe("hi");
    expect(out[2].content).toBe("hello");
  });

  it("re-injecting the same preamble returns the same array", () => {
    const withPreamble = injectPreamble([], buildContextPreamble("rule", "")!)!;
    expect(injectPreamble(withPreamble, buildContextPreamble("rule", "")!)).toBe(
      withPreamble,
    );
  });

  it("replaces a stale preamble without touching the history", () => {
    const stale = injectPreamble([user("hi")], buildContextPreamble("old", "")!)!;
    const fresh = injectPreamble(stale, buildContextPreamble("new rule", "")!)!;
    expect(fresh).toHaveLength(2);
    expect(fresh[0].content).toContain("new rule");
    expect(fresh[1].content).toBe("hi");
  });

  it("removes the preamble when it becomes empty", () => {
    const withPreamble = injectPreamble([user("hi")], buildContextPreamble("x", "")!)!;
    const cleaned = injectPreamble(withPreamble, null);
    expect(cleaned).toHaveLength(1);
    expect(cleaned![0].content).toBe("hi");
  });
});
