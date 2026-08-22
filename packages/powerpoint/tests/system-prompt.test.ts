import { describe, expect, it, vi } from "vitest";
import { buildPowerPointSystemPrompt } from "../src/lib/system-prompt";

// the core barrel pulls pdfjs (DOMMatrix is undefined in plain node)
vi.mock("@office-agents/core", () => ({
  buildSkillsPromptSection: (skills: unknown[]) =>
    Array.isArray(skills) && skills.length > 0
      ? `Skills: ${skills.length}`
      : "",
}));

describe("buildPowerPointSystemPrompt slide-size fallback", () => {
  const prompt = buildPowerPointSystemPrompt([]);

  it("tells the agent to fall back to ppt/presentation.xml sldSz when slideWidth is null", () => {
    expect(prompt).toContain("sldSz");
    expect(prompt).toContain("ppt/presentation.xml");
  });

  it("documents the EMU-to-points conversion", () => {
    expect(prompt).toContain("EMU / 12700");
  });
  it("tells the agent to track multi-step work with todo_write", () => {
    expect(prompt).toContain("todo_write");
  });
});
