import { describe, expect, it } from "vitest";
import { extractSummaryBlock } from "../src/runtime";

// The compaction summarizer is instructed (after the Claude Code pattern) to
// think inside <analysis> and answer inside <summary>; the extractor must keep
// only the summary block, and degrade gracefully when tags are missing.
describe("extractSummaryBlock", () => {
  it("keeps only the <summary> block", () => {
    const text =
      "<analysis>\nline1\nline2\n</analysis>\n<summary>\n1. Primary Request\n2. Document State\n</summary>";
    const out = extractSummaryBlock(text);
    expect(out).toContain("Primary Request");
    expect(out).not.toContain("line1");
    expect(out).not.toContain("analysis");
  });

  it("strips the analysis block when no summary tags are present", () => {
    const out = extractSummaryBlock("<analysis>secret reasoning</analysis>\nplain answer");
    expect(out).toBe("plain answer");
  });

  it("returns plain text untouched", () => {
    expect(extractSummaryBlock("just an answer")).toBe("just an answer");
  });

  it("is case-insensitive on tags", () => {
    const out = extractSummaryBlock("<ANALYSIS>x</ANALYSIS><SUMMARY>y</SUMMARY>");
    expect(out).toBe("y");
  });
});
