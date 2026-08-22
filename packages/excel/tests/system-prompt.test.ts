import { describe, expect, it, vi } from "vitest";
import { buildExcelSystemPrompt } from "../src/lib/system-prompt";

// the core barrel pulls pdfjs (DOMMatrix is undefined in plain node)
vi.mock("@office-agents/core", () => ({
  buildSkillsPromptSection: (skills: unknown[]) =>
    Array.isArray(skills) && skills.length > 0 ? `Skills: ${skills.length}` : "",
}));

describe("buildExcelSystemPrompt formula guidance", () => {
  const prompt = buildExcelSystemPrompt([]);

  it("tells the agent to prefer formulas over hardcoded derived numbers", () => {
    expect(prompt).toMatch(/prefer formulas.*hardcod/i);
  });

  it("tells the agent to reference existing cells instead of duplicating data", () => {
    expect(prompt).toMatch(/reference.*existing.*cells|existing cells.*reference/i);
  });
});
