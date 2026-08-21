import { afterEach, describe, expect, it } from "vitest";
import {
  guardRequirementSet,
  requirementSetSupported,
} from "../src/lib/requirement-guards";

/* global Office */

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

afterEach(() => {
  delete g.Office;
});

describe("requirementSetSupported", () => {
  it("returns true when the host declares the set", () => {
    mockOffice({ WordApi: ["1.5"] });
    expect(requirementSetSupported("WordApi", "1.5")).toBe(true);
  });

  it("returns false for a desktop-only set on a host without it", () => {
    mockOffice({ WordApi: ["1.3"] });
    expect(requirementSetSupported("WordApiDesktop", "1.2")).toBe(false);
  });

  it("returns false when the Office requirements API is unavailable", () => {
    expect(requirementSetSupported("WordApi", "1.1")).toBe(false);
  });
});

describe("guardRequirementSet", () => {
  it("returns undefined when supported", () => {
    mockOffice({ WordApiOnline: ["1.1"] });
    expect(
      guardRequirementSet("WordApiOnline", "1.1", "Change tracking"),
    ).toBeUndefined();
  });

  it("returns an actionable message naming the set, version and feature", () => {
    mockOffice({ WordApi: ["1.3"] });
    const msg = guardRequirementSet(
      "WordApi",
      "1.5",
      "Style inspection",
    ) as string;
    expect(msg).toContain("WordApi 1.5");
    expect(msg).toContain("Style inspection");
  });
});
