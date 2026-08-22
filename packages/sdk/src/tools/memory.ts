import { Type } from "@sinclair/typebox";
import type { StorageNamespace } from "../context";
import {
  appendAgentMemory,
  getAgentMemory,
  setAgentMemory,
} from "../storage/agent-memory";
import { defineTool, toolError, toolSuccess } from "./types";

export function createMemoryTool(ns: StorageNamespace) {
  return defineTool({
    name: "memory_write",
    label: "Save to Agent Memory",
    description:
      "Persist a STABLE fact about the user or their workflow for future sessions " +
      "(preferences, conventions, recurring formats). Do not store transient task " +
      "details. mode=append adds one fact; mode=replace rewrites the whole memory " +
      "(use only to fix wrong facts).",
    parameters: Type.Object({
      content: Type.String({
        description: "The fact to remember (one line, max 200 chars)",
        maxLength: 200,
      }),
      mode: Type.Optional(
        Type.Union([Type.Literal("append"), Type.Literal("replace")], {
          description: "append (default) or replace",
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const content = String(params.content ?? "").trim();
      if (!content) {
        return toolError("content must be a non-empty fact");
      }
      const mode = params.mode === "replace" ? "replace" : "append";
      if (mode === "replace") {
        setAgentMemory(ns, content);
      } else {
        appendAgentMemory(ns, content);
      }
      const stored = getAgentMemory(ns);
      return toolSuccess({
        ok: true,
        mode,
        totalChars: stored.length,
        lines: stored ? stored.split("\n").length : 0,
      });
    },
  });
}
