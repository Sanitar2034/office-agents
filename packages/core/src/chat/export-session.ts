import type { ChatMessage } from "@office-agents/sdk";

const MAX_TOOL_RESULT = 500;

function trimResult(result: string | undefined): string {
  if (!result) return "";
  if (result.length <= MAX_TOOL_RESULT) return result;
  return `${result.slice(0, MAX_TOOL_RESULT)}\n… [trimmed ${result.length - MAX_TOOL_RESULT} chars]`;
}

function quoteBlock(label: string, text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
    .replace(/^>/, `> [${label}]`);
}

export function renderSessionMarkdown(
  messages: ChatMessage[],
  meta: { title: string; exportedAt: Date },
): string {
  const date = meta.exportedAt.toISOString().slice(0, 10);
  const lines: string[] = [
    `# ${meta.title}`,
    "",
    `_${date} · ${messages.length} message${messages.length === 1 ? "" : "s"}_`,
    "",
    "---",
    "",
  ];

  for (const message of messages) {
    const time = new Date(message.timestamp).toISOString().slice(11, 19);
    lines.push(`## ${message.role === "user" ? "User" : "Assistant"} · ${time}`);
    lines.push("");
    for (const part of message.parts) {
      if (part.type === "text") {
        lines.push(part.text, "");
      } else if (part.type === "thinking") {
        lines.push(quoteBlock("thinking", part.thinking), "");
      } else {
        lines.push(
          `**tool:** \`${part.name}\` · ${part.status}${
            Object.keys(part.args ?? {}).length > 0
              ? ` · \`${JSON.stringify(part.args).slice(0, 160)}\``
              : ""
          }`,
          "",
          "```",
          trimResult(part.result),
          "```",
          "",
        );
      }
    }
    lines.push("---", "");
  }

  return lines.join("\n");
}

export function downloadTextFile(
  content: string,
  filename: string,
  mime = "text/plain;charset=utf-8",
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadSessionMarkdown(markdown: string, filename: string) {
  downloadTextFile(markdown, filename, "text/markdown;charset=utf-8");
}
