import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type ThinkingLevel as AgentThinkingLevel,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  getModel,
  getModels,
  getProviders,
  type Model,
  streamSimple,
  type TextContent,
  type ToolResultMessage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import type { AgentContext, StorageNamespace } from "./context";
import {
  agentMessagesToChatMessages,
  type ChatMessage,
  deriveStats,
  extractPartsFromAssistantMessage,
  generateId,
  type SessionStats,
  stripEnrichment,
} from "./message-utils";
import {
  loadOAuthCredentials,
  refreshOAuthToken,
  saveOAuthCredentials,
} from "./oauth";
import {
  applyProxyToModel,
  buildCustomModel,
  loadSavedConfig,
  type ProviderConfig,
  saveConfig,
  type ThinkingLevel,
} from "./provider-config";
import {
  addSkill,
  getInstalledSkills,
  removeSkill,
  type SkillMeta,
  syncSkillsToVfs,
} from "./skills";
import {
  type ChatSession,
  createSession,
  deleteSession,
  getOrCreateCurrentSession,
  getSession,
  listSessions,
  loadVfsFiles,
  saveSession,
  saveVfsFiles,
} from "./storage";
import { createTodoTool, type TodoItem, type TodoStore } from "./tools/todo";
import type { CustomCommandsResult } from "./vfs/custom-commands";

export interface RuntimeAdapter {
  tools: AgentTool[] | ((ctx: AgentContext) => AgentTool[]);
  buildSystemPrompt: (
    skills: SkillMeta[],
    commandSnippets: string[],
    capabilities?: { images: boolean },
  ) => string;
  getDocumentId: () => Promise<string>;
  getDocumentMetadata?: () => Promise<{
    metadata: object;
    nameMap?: Record<number, string>;
  } | null>;
  onToolResult?: (toolCallId: string, result: string, isError: boolean) => void;
  metadataTag?: string;
  staticFiles?: Record<string, string>;
  customCommands?: (ns: StorageNamespace) => CustomCommandsResult;
  storageNamespace?: Partial<StorageNamespace>;
}

export interface UploadedFile {
  name: string;
  size: number;
}

export interface RuntimeState {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  providerConfig: ProviderConfig | null;
  sessionStats: SessionStats;
  currentSession: ChatSession | null;
  sessions: ChatSession[];
  nameMap: Record<number, string>;
  uploads: UploadedFile[];
  isUploading: boolean;
  skills: SkillMeta[];
  vfsInvalidatedAt: number;
  todos: TodoItem[];
}

type StateListener = (state: RuntimeState) => void;

const INITIAL_STATS: SessionStats = { ...deriveStats([]), contextWindow: 0 };

/** Compact when the estimated context reaches this share of the limit. */
const AUTO_COMPACT_THRESHOLD = 0.8;
/** Messages kept verbatim (never summarized) during compaction. */
const COMPACT_KEEP_RECENT = 6;

// Compaction prompt patterned after the open-sourced Claude Code conversation
// summarization prompt (analysis pass -> structured <summary>, user messages and
// security-relevant constraints preserved, next step quoted verbatim), adapted
// to document/spreadsheet/presentation work.
const COMPACT_SYSTEM_PROMPT = [
  "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.",
  "",
  "First analyze the conversation inside <analysis> tags: go through it chronologically and identify each user request, decision, document/spreadsheet/presentation state change, tool call and its result, every error and how it was fixed, and any user feedback.",
  "",
  "Then output the summary inside <summary> tags with exactly these sections:",
  "1. Primary Request and Intent: the user's overall goal and every explicit request, including clarifications made along the way.",
  "2. Key Technical Concepts: document structure, formulas, ranges, styles, OOXML details, formats or conventions that matter for continuing the work.",
  "3. Document State: every file, sheet, slide, range or selection the conversation touched, what was read or written, and its current state.",
  "4. Errors and fixes: every error encountered and how it was resolved, or 'None'.",
  "5. Problem Solving: the approach taken and why; alternatives considered.",
  "6. All user messages: every genuine user request in this conversation, compressed but faithful; quote security-relevant instructions and constraints verbatim so they continue to apply after compaction.",
  "7. Pending Tasks: anything explicitly requested but not yet completed, or 'None'.",
  "8. Current Work: what was being worked on most recently.",
  "9. Optional Next Step: the immediate next action, quoting the last exchange verbatim where work left off.",
  "",
  "Be detailed and factual: this summary replaces the earlier conversation, so nothing important may be lost. Do not invent facts.",
].join("\n");

export function extractSummaryBlock(text: string): string {
  const m = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (m) return m[1].trim();
  return text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();
}

function truncateText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated]`;
}

function textFromContent(
  content: (TextContent | { type: string })[],
): string {
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function thinkingLevelToAgent(level: ThinkingLevel): AgentThinkingLevel {
  return level === "none" ? "off" : level;
}

export class AgentRuntime {
  readonly context: AgentContext;

  private agent: Agent | null = null;
  private config: ProviderConfig | null = null;
  private pendingConfig: ProviderConfig | null = null;
  private streamingMessageId: string | null = null;
  private isStreaming = false;
  private documentId: string | null = null;
  private currentSessionId: string | null = null;
  private sessionLoaded = false;
  private followMode = true;
  private skills: SkillMeta[] = [];

  private adapter: RuntimeAdapter;
  private listeners: Set<StateListener> = new Set();
  private state: RuntimeState;

  private get ns(): StorageNamespace {
    return this.context.namespace;
  }

  private get tools(): AgentTool[] {
    const base =
      typeof this.adapter.tools === "function"
        ? this.adapter.tools(this.context)
        : this.adapter.tools;
    // shared harness tools appended for every application
    return [...base, this.todoTool];
  }

  private todoStore: TodoStore = {
    get: () => this.state.todos,
    set: (todos: TodoItem[]) => this.update({ todos }),
  };

  private todoTool = createTodoTool(this.todoStore);

  constructor(adapter: RuntimeAdapter, context: AgentContext) {
    this.adapter = adapter;
    this.context = context;

    const saved = loadSavedConfig(this.ns);
    const validConfig =
      saved?.provider && saved?.apiKey && saved?.model ? saved : null;
    this.followMode = validConfig?.followMode ?? true;
    this.state = {
      messages: [],
      isStreaming: false,
      error: null,
      providerConfig: validConfig,
      sessionStats: INITIAL_STATS,
      currentSession: null,
      sessions: [],
      nameMap: {},
      uploads: [],
      isUploading: false,
      skills: [],
      vfsInvalidatedAt: 0,
      todos: [],
    };
  }

  getState(): RuntimeState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private update(partial: Partial<RuntimeState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private bumpVfs() {
    this.update({ vfsInvalidatedAt: Date.now() });
  }

  private updateMessages(
    updater: (messages: ChatMessage[]) => ChatMessage[],
    extra?: Partial<RuntimeState>,
  ) {
    this.state = {
      ...this.state,
      messages: updater(this.state.messages),
      ...extra,
    };
    this.emit();
  }

  setAdapter(adapter: RuntimeAdapter) {
    this.adapter = adapter;
  }

  getAvailableProviders(): string[] {
    return getProviders();
  }

  getModelsForProvider(provider: string): Model<Api>[] {
    try {
      return (getModels as (p: string) => Model<Api>[])(provider);
    } catch {
      return [];
    }
  }

  private async getActiveApiKey(config: ProviderConfig): Promise<string> {
    if (config.authMethod !== "oauth") {
      return config.apiKey;
    }
    const creds = loadOAuthCredentials(this.ns, config.provider);
    if (!creds) return config.apiKey;
    if (Date.now() < creds.expires) {
      return creds.access;
    }
    const refreshed = await refreshOAuthToken(
      config.provider,
      creds.refresh,
      config.proxyUrl,
      config.useProxy,
    );
    saveOAuthCredentials(this.ns, config.provider, refreshed);
    return refreshed.access;
  }

  private handleAgentEvent = (event: AgentEvent) => {
    console.log("[Runtime] Agent event:", event.type, event);
    switch (event.type) {
      case "message_start": {
        if (event.message.role === "assistant") {
          const id = generateId();
          this.streamingMessageId = id;
          const parts = extractPartsFromAssistantMessage(event.message);
          const chatMessage: ChatMessage = {
            id,
            role: "assistant",
            parts,
            timestamp: event.message.timestamp,
          };
          this.updateMessages((msgs) => [...msgs, chatMessage]);
        }
        break;
      }
      case "message_update": {
        if (event.message.role === "assistant" && this.streamingMessageId) {
          const streamId = this.streamingMessageId;
          this.updateMessages((msgs) => {
            const messages = [...msgs];
            const idx = messages.findIndex((m) => m.id === streamId);
            if (idx !== -1) {
              const parts = extractPartsFromAssistantMessage(
                event.message,
                messages[idx].parts,
              );
              messages[idx] = { ...messages[idx], parts };
            }
            return messages;
          });
        }
        break;
      }
      case "message_end": {
        if (event.message.role === "assistant") {
          const assistantMsg = event.message as AssistantMessage;
          const isError =
            assistantMsg.stopReason === "error" ||
            assistantMsg.stopReason === "aborted";
          const streamId = this.streamingMessageId;

          this.updateMessages(
            (msgs) => {
              const messages = [...msgs];
              const idx = messages.findIndex((m) => m.id === streamId);

              if (isError) {
                if (idx !== -1) {
                  messages.splice(idx, 1);
                }
              } else if (idx !== -1) {
                const parts = extractPartsFromAssistantMessage(
                  event.message,
                  messages[idx].parts,
                );
                messages[idx] = { ...messages[idx], parts };
              }
              return messages;
            },
            {
              error: isError
                ? assistantMsg.errorMessage || "Request failed"
                : this.state.error,
              sessionStats: isError
                ? this.state.sessionStats
                : {
                    ...deriveStats(this.agent?.state.messages ?? []),
                    contextWindow: this.state.sessionStats.contextWindow,
                  },
            },
          );
          this.streamingMessageId = null;
        }
        break;
      }
      case "tool_execution_start": {
        this.updateMessages((msgs) => {
          const messages = [...msgs];
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const partIdx = msg.parts.findIndex(
              (p) => p.type === "toolCall" && p.id === event.toolCallId,
            );
            if (partIdx !== -1) {
              const parts = [...msg.parts];
              const part = parts[partIdx];
              if (part.type === "toolCall") {
                parts[partIdx] = { ...part, status: "running" };
                messages[i] = { ...msg, parts };
              }
              break;
            }
          }
          return messages;
        });
        break;
      }
      case "tool_execution_update": {
        this.updateMessages((msgs) => {
          const messages = [...msgs];
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const partIdx = msg.parts.findIndex(
              (p) => p.type === "toolCall" && p.id === event.toolCallId,
            );
            if (partIdx !== -1) {
              const parts = [...msg.parts];
              const part = parts[partIdx];
              if (part.type === "toolCall") {
                let partialText: string;
                if (typeof event.partialResult === "string") {
                  partialText = event.partialResult;
                } else if (
                  event.partialResult?.content &&
                  Array.isArray(event.partialResult.content)
                ) {
                  partialText = event.partialResult.content
                    .filter((c: { type: string }) => c.type === "text")
                    .map((c: { text: string }) => c.text)
                    .join("\n");
                } else {
                  partialText = JSON.stringify(event.partialResult, null, 2);
                }
                parts[partIdx] = { ...part, result: partialText };
                messages[i] = { ...msg, parts };
              }
              break;
            }
          }
          return messages;
        });
        break;
      }
      case "tool_execution_end": {
        let resultText: string;
        let resultImages: { data: string; mimeType: string }[] | undefined;
        if (typeof event.result === "string") {
          resultText = event.result;
        } else if (
          event.result?.content &&
          Array.isArray(event.result.content)
        ) {
          resultText = event.result.content
            .filter((c: { type: string }) => c.type === "text")
            .map((c: { text: string }) => c.text)
            .join("\n");
          const images = event.result.content
            .filter((c: { type: string }) => c.type === "image")
            .map((c: { data: string; mimeType: string }) => ({
              data: c.data,
              mimeType: c.mimeType,
            }));
          if (images.length > 0) resultImages = images;
        } else {
          resultText = JSON.stringify(event.result, null, 2);
        }

        if (!event.isError && this.followMode) {
          this.adapter.onToolResult?.(event.toolCallId, resultText, false);
        }

        this.updateMessages((msgs) => {
          const messages = [...msgs];
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const partIdx = msg.parts.findIndex(
              (p) => p.type === "toolCall" && p.id === event.toolCallId,
            );
            if (partIdx !== -1) {
              const parts = [...msg.parts];
              const part = parts[partIdx];
              if (part.type === "toolCall") {
                parts[partIdx] = {
                  ...part,
                  status: event.isError ? "error" : "complete",
                  result: resultText,
                  images: resultImages,
                };
                messages[i] = { ...msg, parts };
              }
              break;
            }
          }
          return messages;
        });
        break;
      }
      case "agent_end": {
        this.isStreaming = false;
        this.streamingMessageId = null;
        this.update({ isStreaming: false });
        this.onStreamingEnd();
        break;
      }
    }
  };

  applyConfig(config: ProviderConfig) {
    let contextWindow = 0;
    let baseModel: Model<Api>;
    if (config.provider === "custom" || config.provider === "openwebui") {
      // Open WebUI exposes exactly one protocol: OpenAI chat completions
      const modelConfig =
        config.provider === "openwebui"
          ? { ...config, apiType: "openai-completions" }
          : config;
      const custom = buildCustomModel(modelConfig);
      if (!custom) return;
      baseModel = custom;
    } else {
      try {
        baseModel = (getModel as (p: string, m: string) => Model<Api>)(
          config.provider,
          config.model,
        );
      } catch {
        return;
      }
    }
    contextWindow = baseModel.contextWindow;
    if (config.contextLimit && config.contextLimit > 0) {
      contextWindow = config.contextLimit;
    }
    this.config = config;

    let modelForAgent = baseModel;
    if (contextWindow !== baseModel.contextWindow) {
      modelForAgent = { ...baseModel, contextWindow };
    }
    const proxiedModel = applyProxyToModel(modelForAgent, config);
    const existingMessages = this.agent?.state.messages ?? [];

    if (this.agent) {
      this.agent.abort();
    }

    const systemPrompt = this.adapter.buildSystemPrompt(
      this.skills,
      this.context.commandSnippets,
      { images: config.supportsImages !== false },
    );

    const tools =
      config.supportsImages === false
        ? this.tools.filter((t) => !t.name.includes("screenshot"))
        : this.tools;

    const agent = new Agent({
      initialState: {
        model: proxiedModel,
        systemPrompt,
        thinkingLevel: thinkingLevelToAgent(config.thinking),
        tools,
        messages: existingMessages,
      },
      streamFn: async (model, context, options) => {
        const cfg = this.config ?? config;
        const apiKey = await this.getActiveApiKey(cfg);
        const streamOptions: Record<string, unknown> = { ...options, apiKey };
        if (typeof cfg.temperature === "number") {
          streamOptions.temperature = cfg.temperature;
        }
        return streamSimple(model, context, streamOptions);
      },
    });
    this.agent = agent;
    agent.subscribe(this.handleAgentEvent);
    this.pendingConfig = null;
    this.followMode = config.followMode ?? true;

    this.update({
      providerConfig: config,
      error: null,
      sessionStats: {
        ...this.state.sessionStats,
        contextWindow,
      },
    });
  }

  setProviderConfig(config: ProviderConfig) {
    if (this.isStreaming) {
      this.pendingConfig = config;
      this.update({ providerConfig: config });
      return;
    }
    this.applyConfig(config);
  }

  abort() {
    this.agent?.abort();
    this.isStreaming = false;
    this.update({ isStreaming: false });
  }

  async sendMessage(content: string, attachments?: string[]) {
    if (this.pendingConfig) {
      this.applyConfig(this.pendingConfig);
    }
    const agent = this.agent;
    if (!agent || !this.state.providerConfig) {
      this.update({ error: "Please configure your API key first" });
      return;
    }

    if (this.shouldAutoCompact()) {
      try {
        await this.compactContext();
      } catch (err) {
        console.error("[Runtime] auto-compact failed:", err);
      }
    }

    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      parts: [{ type: "text", text: content }],
      timestamp: Date.now(),
    };

    this.isStreaming = true;
    this.update({
      messages: [...this.state.messages, userMessage],
      isStreaming: true,
      error: null,
    });

    try {
      let promptContent = content;

      if (this.adapter.getDocumentMetadata) {
        try {
          const meta = await this.adapter.getDocumentMetadata();
          if (meta) {
            const tag = this.adapter.metadataTag || "doc_context";
            promptContent = `<${tag}>\n${JSON.stringify(meta.metadata, null, 2)}\n</${tag}>\n\n${content}`;
            if (meta.nameMap) {
              this.update({ nameMap: meta.nameMap });
            }
          }
        } catch (err) {
          console.error("[Runtime] Failed to get document metadata:", err);
        }
      }

      if (attachments && attachments.length > 0) {
        const paths = attachments
          .map((name) => `/home/user/uploads/${name}`)
          .join("\n");
        promptContent = `<attachments>\n${paths}\n</attachments>\n\n${promptContent}`;
      }

      await agent.prompt(promptContent);
    } catch (err) {
      console.error("[Runtime] sendMessage error:", err);
      this.isStreaming = false;
      this.update({
        isStreaming: false,
        error: err instanceof Error ? err.message : "An error occurred",
      });
    }
  }

  /**
   * Rough context estimate in tokens: max of a chars/4 heuristic over the
   * agent transcript and the real input-token count of the last request.
   */
  estimateContextTokens(): number {
    const agent = this.agent;
    if (!agent) return 0;
    let chars = agent.state.systemPrompt?.length ?? 0;
    for (const msg of agent.state.messages) {
      chars += JSON.stringify(msg).length;
    }
    const estimate = Math.ceil(chars / 4);
    return Math.max(estimate, this.state.sessionStats.lastInputTokens);
  }

  getContextUsage(): { used: number; limit: number; percent: number } {
    const limit = this.state.sessionStats.contextWindow;
    const used = this.estimateContextTokens();
    return {
      used,
      limit,
      percent: limit > 0 ? Math.min(100, (used / limit) * 100) : 0,
    };
  }

  private shouldAutoCompact(): boolean {
    const config = this.config;
    if (!config || !this.agent || this.isStreaming) return false;
    if (config.autoCompact === false) return false;
    const limit = this.state.sessionStats.contextWindow;
    if (!limit || limit <= 0) return false;
    if (this.agent.state.messages.length <= COMPACT_KEEP_RECENT + 2) {
      return false;
    }
    return this.estimateContextTokens() >= limit * AUTO_COMPACT_THRESHOLD;
  }

  private buildCompactTranscript(messages: AgentMessage[]): string {
    const lines: string[] = [];
    for (const msg of messages) {
      if (msg.role === "user") {
        const text = stripEnrichment(
          (msg as UserMessage).content,
          this.adapter.metadataTag,
        );
        lines.push(`USER: ${truncateText(text, 4000)}`);
      } else if (msg.role === "assistant") {
        const parts: string[] = [];
        for (const block of (msg as AssistantMessage).content) {
          if (block.type === "text") {
            parts.push(truncateText(block.text, 2000));
          } else if (block.type === "thinking") {
            // skip reasoning traces
          } else {
            const call = block as { name?: string; arguments?: unknown };
            parts.push(
              `[tool ${call.name ?? "?"}(${truncateText(
                JSON.stringify(call.arguments ?? {}),
                300,
              )})]`,
            );
          }
        }
        lines.push(`ASSISTANT: ${parts.join(" | ") || "(no text)"}`);
      } else if (msg.role === "toolResult") {
        const tr = msg as ToolResultMessage;
        lines.push(
          `TOOL RESULT${tr.isError ? " (error)" : ""}: ${truncateText(
            textFromContent(tr.content as (TextContent | { type: string })[]),
            800,
          )}`,
        );
      }
    }
    return lines.join("\n");
  }

  /**
   * Replace older messages with an LLM-generated summary, keeping the recent
   * tail verbatim. Triggered automatically near the context limit and by the
   * /compact chat command.
   */
  async compactContext(keepRecent: number = COMPACT_KEEP_RECENT): Promise<boolean> {
    const agent = this.agent;
    const config = this.config;
    if (!agent || !config) {
      this.update({ error: "Настройте модель перед сжатием контекста" });
      return false;
    }
    if (this.isStreaming) {
      this.update({ error: "Дождитесь окончания ответа" });
      return false;
    }
    const messages = [...agent.state.messages];
    if (messages.length <= keepRecent + 2) {
      this.update({ error: "Контекст ещё мал — сжимать нечего" });
      return false;
    }

    // Split on a turn boundary (user message) so no tool call/result pair is cut.
    let split = Math.max(1, messages.length - keepRecent);
    for (let i = messages.length - keepRecent; i >= Math.max(1, split - 30); i--) {
      if (messages[i]?.role === "user") {
        split = i;
        break;
      }
    }
    while (split < messages.length && messages[split].role === "toolResult") {
      split++;
    }
    if (split <= 0 || split >= messages.length - 1) {
      this.update({ error: "Контекст ещё мал — сжимать нечего" });
      return false;
    }

    const oldMessages = messages.slice(0, split);
    const kept = messages.slice(split);
    const transcript = this.buildCompactTranscript(oldMessages);

    const apiKey = await this.getActiveApiKey(config);
    const summarizer = new Agent({
      initialState: {
        model: agent.state.model,
        systemPrompt: COMPACT_SYSTEM_PROMPT,
        thinkingLevel: "off",
        tools: [],
        messages: [],
      },
      streamFn: async (model, context, options) =>
        streamSimple(model, context, { ...options, apiKey }),
    });
    let summary = "";
    summarizer.subscribe((event: AgentEvent) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        summary = extractSummaryBlock(
          (event.message as AssistantMessage).content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n")
            .trim(),
        );
      }
    });
    try {
      await summarizer.prompt(
        "Summarize the following conversation history for continuation:\n\n<transcript>\n" +
          transcript +
          "\n</transcript>",
      );
    } catch (err) {
      console.error("[Runtime] summarizer failed:", err);
      this.update({
        error: `Сжатие не удалось: ${err instanceof Error ? err.message : "error"}`,
      });
      return false;
    }

    if (!summary) {
      this.update({ error: "Сжатие не удалось: пустая сводка" });
      return false;
    }

    const summaryMessage = {
      role: "user",
      content:
        `<context_summary>\n${summary}\n</context_summary>\n\n` +
        "(Compact summary of the earlier conversation; recent messages follow.)",
      timestamp: Date.now(),
    } as AgentMessage;

    agent.state.messages = [summaryMessage, ...kept];
    this.update({
      messages: agentMessagesToChatMessages(
        agent.state.messages,
        this.adapter.metadataTag,
      ),
      error: null,
    });

    if (this.currentSessionId) {
      try {
        await saveSession(this.ns, this.currentSessionId, agent.state.messages);
        await this.refreshSessions();
      } catch (e) {
        console.error("[Runtime] saving compacted session failed:", e);
      }
    }
    return true;
  }

  clearMessages() {
    this.abort();
    this.agent?.reset();
    this.context.reset();
    if (this.currentSessionId) {
      Promise.all([
        saveSession(this.ns, this.currentSessionId, []),
        saveVfsFiles(this.ns, this.currentSessionId, []),
      ]).catch(console.error);
    }
    this.update({
      messages: [],
      error: null,
      sessionStats: INITIAL_STATS,
      uploads: [],
    });
  }

  private async refreshSessions() {
    if (!this.documentId) return;
    const sessions = await listSessions(this.ns, this.documentId);
    this.update({ sessions });
  }

  async newSession() {
    if (!this.documentId) return;
    if (this.isStreaming) return;
    try {
      this.agent?.reset();
      this.context.reset();
      const session = await createSession(this.ns, this.documentId);
      this.currentSessionId = session.id;
      await this.refreshSessions();
      this.update({
        messages: [],
        currentSession: session,
        error: null,
        sessionStats: INITIAL_STATS,
        uploads: [],
      });
    } catch (err) {
      console.error("[Runtime] Failed to create session:", err);
    }
  }

  async switchSession(sessionId: string) {
    if (this.currentSessionId === sessionId) return;
    if (this.isStreaming) return;
    this.agent?.reset();
    try {
      const [session, vfsFiles] = await Promise.all([
        getSession(this.ns, sessionId),
        loadVfsFiles(this.ns, sessionId),
      ]);
      if (!session) return;
      await this.context.restoreVfs(vfsFiles);
      this.currentSessionId = session.id;

      if (session.agentMessages.length > 0 && this.agent) {
        this.agent.state.messages = session.agentMessages;
      }

      const uploadNames = await this.context.listUploads();
      const stats = deriveStats(session.agentMessages);
      this.update({
        messages: agentMessagesToChatMessages(
          session.agentMessages,
          this.adapter.metadataTag,
        ),
        currentSession: session,
        error: null,
        sessionStats: {
          ...stats,
          contextWindow: this.state.sessionStats.contextWindow,
        },
        uploads: uploadNames.map((name) => ({ name, size: 0 })),
      });
      await this.refreshNameMap();
    } catch (err) {
      console.error("[Runtime] Failed to switch session:", err);
    }
  }

  async deleteCurrentSession() {
    if (!this.currentSessionId || !this.documentId) return;
    if (this.isStreaming) return;
    this.agent?.reset();
    const deletedId = this.currentSessionId;
    await Promise.all([
      deleteSession(this.ns, deletedId),
      saveVfsFiles(this.ns, deletedId, []),
    ]);
    const session = await getOrCreateCurrentSession(this.ns, this.documentId);
    this.currentSessionId = session.id;
    const vfsFiles = await loadVfsFiles(this.ns, session.id);
    await this.context.restoreVfs(vfsFiles);

    if (session.agentMessages.length > 0 && this.agent) {
      this.agent.state.messages = session.agentMessages;
    }

    await this.refreshSessions();
    const uploadNames = await this.context.listUploads();
    const stats = deriveStats(session.agentMessages);
    this.update({
      messages: agentMessagesToChatMessages(
        session.agentMessages,
        this.adapter.metadataTag,
      ),
      currentSession: session,
      error: null,
      sessionStats: {
        ...stats,
        contextWindow: this.state.sessionStats.contextWindow,
      },
      uploads: uploadNames.map((name) => ({ name, size: 0 })),
    });
  }

  private async onStreamingEnd() {
    if (!this.currentSessionId) return;
    const sessionId = this.currentSessionId;
    const agentMessages = this.agent?.state.messages ?? [];
    try {
      const vfsFiles = await this.context.snapshotVfs();
      await Promise.all([
        saveSession(this.ns, sessionId, agentMessages),
        saveVfsFiles(this.ns, sessionId, vfsFiles),
      ]);
      await this.refreshSessions();
      const updated = await getSession(this.ns, sessionId);
      if (updated) {
        this.update({ currentSession: updated });
      }
      this.bumpVfs();
    } catch (e) {
      console.error(e);
    }
  }

  async init() {
    if (this.sessionLoaded) return;
    this.sessionLoaded = true;

    try {
      // update staticFiles and customCommands jic any changes
      // happened between context init (on app mount) vs session init
      if (this.adapter.staticFiles) {
        await this.context.setStaticFiles(this.adapter.staticFiles);
      }
      if (this.adapter.customCommands) {
        this.context.setCustomCommands(this.adapter.customCommands);
      }

      const id = await this.adapter.getDocumentId();
      this.documentId = id;

      const skills = await getInstalledSkills(this.ns);
      this.skills = skills;
      await syncSkillsToVfs(this.ns, this.context);

      const saved = loadSavedConfig(this.ns);
      if (saved?.provider && saved?.apiKey && saved?.model) {
        this.applyConfig(saved);
      }

      const session = await getOrCreateCurrentSession(this.ns, id);
      this.currentSessionId = session.id;
      const [sessions, vfsFiles] = await Promise.all([
        listSessions(this.ns, id),
        loadVfsFiles(this.ns, session.id),
      ]);
      if (vfsFiles.length > 0) {
        await this.context.restoreVfs(vfsFiles);
      }

      if (session.agentMessages.length > 0 && this.agent) {
        this.agent.state.messages = session.agentMessages;
      }

      const uploadNames = await this.context.listUploads();
      const stats = deriveStats(session.agentMessages);
      this.update({
        messages: agentMessagesToChatMessages(
          session.agentMessages,
          this.adapter.metadataTag,
        ),
        currentSession: session,
        sessions,
        skills,
        sessionStats: {
          ...stats,
          contextWindow: this.state.sessionStats.contextWindow,
        },
        uploads: uploadNames.map((name) => ({ name, size: 0 })),
      });
      await this.refreshNameMap();
    } catch (err) {
      console.error("[Runtime] Failed to load session:", err);
    }
  }

  async uploadFiles(files: { name: string; size: number; data: Uint8Array }[]) {
    if (files.length === 0) return;
    this.update({ isUploading: true });
    try {
      for (const file of files) {
        await this.context.writeFile(file.name, file.data);
        const uploads = [...this.state.uploads];
        const exists = uploads.findIndex((u) => u.name === file.name);
        if (exists !== -1) {
          uploads[exists] = { name: file.name, size: file.size };
        } else {
          uploads.push({ name: file.name, size: file.size });
        }
        this.update({ uploads });
      }
      if (this.currentSessionId) {
        const snapshot = await this.context.snapshotVfs();
        await saveVfsFiles(this.ns, this.currentSessionId, snapshot);
      }
      this.bumpVfs();
    } catch (err) {
      console.error("Failed to upload file:", err);
    } finally {
      this.update({ isUploading: false });
    }
  }

  async removeUpload(name: string) {
    try {
      await this.context.deleteFile(name);
      this.update({
        uploads: this.state.uploads.filter((u) => u.name !== name),
      });
      if (this.currentSessionId) {
        const snapshot = await this.context.snapshotVfs();
        await saveVfsFiles(this.ns, this.currentSessionId, snapshot);
      }
      this.bumpVfs();
    } catch (err) {
      console.error("Failed to delete file:", err);
      this.update({
        uploads: this.state.uploads.filter((u) => u.name !== name),
      });
    }
  }

  private async refreshSkillsAndRebuildAgent() {
    this.skills = await getInstalledSkills(this.ns);
    this.update({ skills: this.skills });
    if (this.state.providerConfig) {
      this.applyConfig(this.state.providerConfig);
    }
  }

  async installSkill(inputs: { path: string; data: Uint8Array }[]) {
    if (inputs.length === 0) return;
    try {
      await addSkill(this.ns, this.context, inputs);
      await this.refreshSkillsAndRebuildAgent();
    } catch (err) {
      console.error("[Runtime] Failed to install skill:", err);
      this.update({
        error: err instanceof Error ? err.message : "Failed to install skill",
      });
    }
  }

  async uninstallSkill(name: string) {
    try {
      await removeSkill(this.ns, this.context, name);
      await this.refreshSkillsAndRebuildAgent();
    } catch (err) {
      console.error("[Runtime] Failed to uninstall skill:", err);
    }
  }

  toggleFollowMode() {
    if (!this.state.providerConfig) return;
    const newFollowMode = !this.state.providerConfig.followMode;
    this.followMode = newFollowMode;
    const newConfig = {
      ...this.state.providerConfig,
      followMode: newFollowMode,
    };
    saveConfig(this.ns, newConfig);
    this.update({ providerConfig: newConfig });
  }

  toggleExpandToolCalls() {
    if (!this.state.providerConfig) return;
    const newConfig = {
      ...this.state.providerConfig,
      expandToolCalls: !this.state.providerConfig.expandToolCalls,
    };
    saveConfig(this.ns, newConfig);
    this.update({ providerConfig: newConfig });
  }

  getName(id: number): string | undefined {
    return this.state.nameMap[id];
  }

  private async refreshNameMap() {
    if (!this.adapter.getDocumentMetadata) return;
    try {
      const meta = await this.adapter.getDocumentMetadata();
      if (meta?.nameMap) {
        this.update({ nameMap: meta.nameMap });
      }
    } catch (err) {
      console.error("[Runtime] Failed to refresh nameMap:", err);
    }
  }

  dispose() {
    this.agent?.abort();
    this.listeners.clear();
  }
}
