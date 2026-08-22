import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@office-agents/sdk";
import { renderSessionMarkdown } from "../src/chat/export-session";

function msg(
  role: "user" | "assistant",
  parts: ChatMessage["parts"],
  timestamp = 1755800000000,
): ChatMessage {
  return { id: `${role}-1`, role, parts, timestamp };
}

const meta = { title: "Budget cleanup", exportedAt: new Date("2026-08-22T12:00:00Z") };

describe("renderSessionMarkdown", () => {
  it("renders user and assistant text with headings", () => {
    const md = renderSessionMarkdown(
      [
        msg("user", [{ type: "text", text: "clean the budget sheet" }]),
        msg("assistant", [{ type: "text", text: "Done, 3 rows removed." }]),
      ],
      meta,
    );
    expect(md).toContain("# Budget cleanup");
    expect(md).toContain("## User");
    expect(md).toContain("clean the budget sheet");
    expect(md).toContain("## Assistant");
    expect(md).toContain("Done, 3 rows removed.");
  });

  it("includes message counts and the export date", () => {
    const md = renderSessionMarkdown(
      [msg("user", [{ type: "text", text: "hi" }])],
      meta,
    );
    expect(md).toMatch(/1 message/);
    expect(md).toContain("2026-08-22");
  });

  it("renders tool calls with name, status and a trimmed result", () => {
    const long = "x".repeat(1200);
    const md = renderSessionMarkdown(
      [
        msg("assistant", [
          {
            type: "toolCall",
            id: "tc1",
            name: "set_cell_range",
            args: { range: "A1:B2" },
            status: "complete",
            result: long,
          },
        ]),
      ],
      meta,
    );
    expect(md).toContain("set_cell_range");
    expect(md).toContain("complete");
    expect(md).not.toContain(long); // trimmed, not the full 1200 chars
    expect(md.length).toBeLessThan(1000);
  });

  it("renders thinking parts as quoted notes", () => {
    const md = renderSessionMarkdown(
      [
        msg("assistant", [
          { type: "thinking", thinking: "plan the edit" },
          { type: "text", text: "ok" },
        ]),
      ],
      meta,
    );
    expect(md).toContain("[thinking]");
    expect(md).toContain("plan the edit");
    expect(md).toContain("ok");
  });

  it("handles an empty session with just the header", () => {
    const md = renderSessionMarkdown([], meta);
    expect(md).toContain("# Budget cleanup");
    expect(md).toContain("0 messages");
  });
});
