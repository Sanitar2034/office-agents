import { describe, expect, it } from "vitest";
import { buildStreamOptions } from "../src/stream-options";

describe("buildStreamOptions", () => {
  it("passes the api key through", () => {
    const opts = buildStreamOptions({ stream: true }, "sk-test", undefined);
    expect(opts.apiKey).toBe("sk-test");
    expect(opts.stream).toBe(true);
  });

  it("asks the backend to reuse the prompt prefix cache (llama.cpp cache_prompt)", () => {
    const opts = buildStreamOptions({}, "sk", undefined);
    expect(opts.cache_prompt).toBe(true);
  });

  it("adds temperature only when configured", () => {
    expect(buildStreamOptions({}, "sk", 0.2).temperature).toBe(0.2);
    expect("temperature" in buildStreamOptions({}, "sk", undefined)).toBe(false);
    expect("temperature" in buildStreamOptions({}, "sk", 0)).toBe(true);
  });

  it("does not mutate the incoming options object", () => {
    const base = Object.freeze({ stream: true });
    expect(() => buildStreamOptions(base, "sk", 0.3)).not.toThrow();
    expect(base).toEqual({ stream: true });
  });
});
