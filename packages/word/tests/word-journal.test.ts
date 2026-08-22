import { describe, expect, it } from "vitest";
import {
  createWordJournal,
  recordBodySnapshot,
  restoreAllBodySnapshots,
} from "../src/lib/word-journal";

describe("word journal", () => {
  it("records body OOXML snapshots and pops them LIFO with a cap of 10", () => {
    const j = createWordJournal();
    for (let i = 0; i < 12; i++) recordBodySnapshot(j, `<body v="${i}"/>`);
    expect(j.size()).toBe(10);
    expect(j.pop()).toBe('<body v="11"/>');
    expect(j.pop()).toBe('<body v="10"/>');
    expect(j.clear(), "clear returns the number dropped").toBe(8);
    expect(j.size()).toBe(0);
  });
});

describe("restoreAllBodySnapshots", () => {
  it("replaces the body with the OLDEST snapshot (full rollback)", async () => {
    const j = createWordJournal();
    recordBodySnapshot(j, "<body v='first'/>");
    recordBodySnapshot(j, "<body v='second'/>");

    const inserted: string[] = [];
    const g = globalThis as Record<string, unknown>;
    const prevWord = g.Word;
    g.Word = {
      run: async (cb: (ctx: unknown) => Promise<unknown>) =>
        cb({
          document: {
            body: {
              getOoxml: () => ({ value: "<body v='current'/>" }),
              insertOoxml: (xml: string, mode: string) => {
                inserted.push(`${mode}:${xml}`);
              },
            },
          },
          sync: async () => {},
        }),
    };
    try {
      const result = await restoreAllBodySnapshots(j);
      expect(result.restored).toBe(true);
      expect(inserted).toEqual(["Replace:<body v='first'/>"]);
      expect(j.size()).toBe(0);
    } finally {
      g.Word = prevWord;
    }
  });

  it("reports nothing to restore when the journal is empty", async () => {
    const j = createWordJournal();
    const result = await restoreAllBodySnapshots(j);
    expect(result.restored).toBe(false);
  });
});
