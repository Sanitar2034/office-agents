import { describe, expect, it } from "vitest";
import {
  createSlideJournal,
  recordSlideSnapshot,
  undoAllSlideEdits,
} from "../src/lib/pptx/slide-journal";

describe("slide journal", () => {
  it("records snapshots and pops them LIFO", () => {
    const j = createSlideJournal();
    recordSlideSnapshot(j, 3, "b64-original-3");
    recordSlideSnapshot(j, 5, "b64-original-5");

    const last = j.pop();
    expect(last).toEqual({ slideIndex: 5, originalBase64: "b64-original-5" });
    const first = j.pop();
    expect(first).toEqual({ slideIndex: 3, originalBase64: "b64-original-3" });
    expect(j.pop()).toBeNull();
  });

  it("keeps at most 20 snapshots", () => {
    const j = createSlideJournal();
    for (let i = 0; i < 25; i++) recordSlideSnapshot(j, i, `b64-${i}`);
    expect(j.size()).toBe(20);
    // the oldest five were dropped
    expect(j.pop()!.originalBase64).toBe("b64-24");
  });

  it("clears on demand", () => {
    const j = createSlideJournal();
    recordSlideSnapshot(j, 1, "x");
    j.clear();
    expect(j.size()).toBe(0);
  });
});

describe("undoAllSlideEdits", () => {
  it("replaces edited slides with their snapshots in reverse order", async () => {
    const j = createSlideJournal();
    recordSlideSnapshot(j, 0, "b64-A");
    recordSlideSnapshot(j, 2, "b64-B");

    const calls: string[] = [];
    const inserted: Array<{ base64: string; target?: string }> = [];
    const deleted: string[] = [];
    const g = globalThis as Record<string, unknown>;
    const prevPpt = g.PowerPoint;
    g.PowerPoint = {
      run: async (cb: (ctx: unknown) => Promise<unknown>) =>
        cb({
          presentation: {
            slides: {
              load: () => {},
              items: [
                { id: "s1", delete: () => deleted.push("slide0") },
                { id: "s2", delete: () => deleted.push("slide1") },
                { id: "s3", delete: () => deleted.push("slide2") },
              ],
              getItemAt: (i: number) => {
                calls.push(`getItemAt(${i})`);
                return { delete: () => deleted.push(`slide${i}`) };
              },
            },
            insertSlidesFromBase64: (base64: string, opts: { targetSlideId?: string }) =>
              inserted.push({ base64, target: opts?.targetSlideId }),
          },
          sync: async () => {
            calls.push("sync");
          },
        }),
    };
    try {
      const result = await undoAllSlideEdits(j);
      expect(result.restored).toBe(2);
      // reverse order: slide 2 first, then slide 0
      expect(inserted.map((x) => x.base64)).toEqual(["b64-B", "b64-A"]);
      expect(deleted).toEqual(["slide2", "slide0"]);
      expect(j.size()).toBe(0);
    } finally {
      g.PowerPoint = prevPpt;
    }
  });
});
