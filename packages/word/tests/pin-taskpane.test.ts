import { afterEach, describe, expect, it, vi } from "vitest";
import { pinTaskpane } from "../src/taskpane/pin-taskpane";

/* global Office */

describe("pinTaskpane", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).Office;
  });

  it("asks Office to auto-open the pane on next document start", async () => {
    const setStartupBehavior = vi.fn().mockResolvedValue(undefined);
    (globalThis as Record<string, unknown>).Office = {
      addin: { setStartupBehavior },
      StartupBehavior: { none: 0, load: 1 },
    };

    await expect(pinTaskpane()).resolves.toBe(true);
    expect(setStartupBehavior).toHaveBeenCalledTimes(1);
    expect(setStartupBehavior).toHaveBeenCalledWith(1);
  });

  it("returns false instead of throwing when Office.addin is missing", async () => {
    (globalThis as Record<string, unknown>).Office = {};

    await expect(pinTaskpane()).resolves.toBe(false);
  });

  it("returns false when the Office global is absent (e.g. plain browser)", async () => {
    await expect(pinTaskpane()).resolves.toBe(false);
  });

  it("returns false when the host rejects setStartupBehavior", async () => {
    const setStartupBehavior = vi.fn().mockRejectedValue(new Error("not supported"));
    (globalThis as Record<string, unknown>).Office = {
      addin: { setStartupBehavior },
      StartupBehavior: { none: 0, load: 1 },
    };

    await expect(pinTaskpane()).resolves.toBe(false);
  });
});
