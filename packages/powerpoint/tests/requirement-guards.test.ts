import { afterEach, describe, expect, it, vi } from "vitest";
import {
  guardRequirementSet,
  requirementSetSupported,
} from "../src/lib/requirement-guards";

// slide-zip pulls in the SDK PDF stack (pdfjs needs DOMMatrix in node);
// the guard test only needs safeRun to reach the mocked PowerPoint.run
vi.mock("../src/lib/pptx/slide-zip", () => ({
  safeRun: (cb: (c: unknown) => Promise<unknown>) =>
    (globalThis as { PowerPoint?: { run: (cb: unknown) => unknown } })
      .PowerPoint!.run(cb as never),
}));

// tools/types re-exports resizeImage from core, whose barrel import pulls
// pdfjs (DOMMatrix is undefined in plain node) — stub it, it is not used here
vi.mock("@office-agents/core", () => ({
  resizeImage: async (data: string, mimeType: string) => ({ data, mimeType }),
}));

const { duplicateSlideTool } = await import(
  "../src/lib/tools/duplicate-slide"
);

/* global Office, PowerPoint */

const g = globalThis as Record<string, unknown>;

function mockOffice(sets: Record<string, string[]>) {
  g.Office = {
    context: {
      requirements: {
        isSetSupported: (name: string, version: string) =>
          (sets[name] ?? []).some((v) => parseFloat(v) >= parseFloat(version)),
      },
    },
  };
}

function resultText(res: { content: Array<{ type: string; text?: string }> }) {
  return res.content[0]?.text ?? "";
}

afterEach(() => {
  delete g.Office;
  delete g.PowerPoint;
});

describe("requirementSetSupported", () => {
  it("returns true when the host declares the set", () => {
    mockOffice({ PowerPointApi: ["1.5"] });
    expect(requirementSetSupported("PowerPointApi", "1.3")).toBe(true);
  });

  it("returns false when the host caps below the required version", () => {
    mockOffice({ PowerPointApi: ["1.2"] });
    expect(requirementSetSupported("PowerPointApi", "1.5")).toBe(false);
  });

  it("returns false when the Office requirements API is unavailable", () => {
    expect(requirementSetSupported("PowerPointApi", "1.1")).toBe(false);
  });
});

describe("guardRequirementSet", () => {
  it("returns undefined when the set is supported", () => {
    mockOffice({ PowerPointApi: ["1.5"] });
    expect(
      guardRequirementSet("PowerPointApi", "1.2", "Duplicating slides"),
    ).toBeUndefined();
  });

  it("returns an actionable message naming the set, version and feature", () => {
    mockOffice({ PowerPointApi: ["1.2"] });
    const msg = guardRequirementSet(
      "PowerPointApi",
      "1.5",
      "Slide selection",
    ) as string;
    expect(msg).toContain("PowerPointApi 1.5");
    expect(msg).toContain("Slide selection");
  });
});

describe("duplicate_slide tool guard", () => {
  it("returns a tool error and never touches PowerPoint.run when PowerPointApi 1.2 is missing", async () => {
    mockOffice({ PowerPointApi: ["1.1"] });
    const run = vi.fn();
    g.PowerPoint = { run };

    const res = await duplicateSlideTool.execute("t1", { slide_index: 0 } as never);

    expect(resultText(res)).toContain("PowerPointApi 1.2");
    expect(run).not.toHaveBeenCalled();
  });

  it("proceeds to PowerPoint.run when the set is supported", async () => {
    mockOffice({ PowerPointApi: ["1.5"] });
    const run = vi.fn(async (cb: (c: unknown) => Promise<unknown>) =>
      cb({
        presentation: {
          slides: {
            load: () => {},
            items: [{ id: "s1" }],
            getItemAt: () => ({ exportAsBase64: () => ({ value: "b64" }) }),
          },
          insertSlidesFromBase64: () => {},
        },
        sync: async () => {},
      }),
    );
    g.PowerPoint = { run };

    const res = await duplicateSlideTool.execute("t1", { slide_index: 0 } as never);

    expect(run).toHaveBeenCalled();
    expect(JSON.parse(resultText(res)).success).toBe(true);
  });
});
