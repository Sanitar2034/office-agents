<script lang="ts">
  import { Paperclip, Send, Square, X } from "lucide-svelte";
  import { getChatContext } from "./chat-runtime-context";

  const LINE_HEIGHT = 20;
  const MIN_ROWS = 1;
  const MAX_ROWS = 2;

  const chat = getChatContext();
  const runtimeState = chat.state;

  let input = $state("");
  let textareaRef: HTMLTextAreaElement | null = null;
  let fileInputRef: HTMLInputElement | null = null;

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  function autoResize() {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    const min = LINE_HEIGHT * MIN_ROWS;
    const max = LINE_HEIGHT * MAX_ROWS;
    const clamped = Math.max(min, Math.min(textareaRef.scrollHeight, max));
    textareaRef.style.height = `${clamped}px`;
    textareaRef.style.overflowY =
      textareaRef.scrollHeight > max ? "auto" : "hidden";
  }

  async function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || $runtimeState.isStreaming) return;

    if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
      input = "";
      await chat.compactContext();
      return;
    }

    if (trimmed === "/undo" || trimmed.startsWith("/undo ")) {
      input = "";
      await chat.sendMessage(
        "Undo the agent's recent workbook edits using the undo_edits tool " +
          "(all recorded edits).",
      );
      return;
    }

    if (trimmed === "/skill-create" || trimmed.startsWith("/skill-create ")) {
      input = "";
      await chat.sendMessage(
        "I want to create a new skill. Help me design it by asking what task it should automate, " +
        "then generate a properly formatted SKILL.md with frontmatter (name, description with trigger " +
        "phrases), numbered steps, verification, error handling, and 2-3 examples. " +
        "Output the skill inside <skill-file>...</skill-file> tags so I can install it.",
      );
      return;
    }

    if (trimmed === "/skill-test" || trimmed.startsWith("/skill-test ")) {
      const skillName = trimmed.replace("/skill-test", "").trim();
      input = "";
      await chat.sendMessage(
        skillName
          ? `Test the skill "${skillName}". Load it from /home/skills/${skillName}/SKILL.md, create 3 test scenarios (happy path, edge case, negative), evaluate trigger reliability, simulate execution, and report a Skill Test Report.`
          : "List all installed skills with their descriptions, then ask me which one to test.",
      );
      return;
    }

    if (trimmed === "/skill-list") {
      input = "";
      await chat.sendMessage(
        "List all installed skills with their names, descriptions, and file locations from /home/skills/.",
      );
      return;
    }

    const attachmentNames = $runtimeState.uploads.map((upload) => upload.name);
    input = "";
    await chat.sendMessage(
      trimmed,
      attachmentNames.length > 0 ? attachmentNames : undefined,
    );
  }

  async function handleFileSelect(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    await chat.processFiles(Array.from(files));
    if (fileInputRef) {
      fileInputRef.value = "";
    }
  }

  $effect(() => {
    input;
    queueMicrotask(autoResize);
  });

  // --- input autocomplete: / commands, @ files, # skills, $ session vars ---
  interface Suggestion {
    label: string;
    hint: string;
    insert: string;
  }

  const CHAT_COMMANDS: Suggestion[] = [
    { label: "/compact", hint: "сжать контекст вручную", insert: "/compact" },
    { label: "/undo", hint: "отменить правки агента", insert: "/undo" },
    { label: "/skill-create", hint: "AI создаст новый скилл по описанию", insert: "/skill-create" },
    { label: "/skill-test", hint: "протестировать скилл (триггеры+выполнение)", insert: "/skill-test" },
    { label: "/skill-list", hint: "список установленных скиллов", insert: "/skill-list" },
  ];

  let suggest = $state<{
    trigger: string;
    query: string;
    start: number;
  } | null>(null);
  let selIndex = $state(0);

  const suggestions = $derived.by(() => {
    if (!suggest) return [] as Suggestion[];
    const q = suggest.query.toLowerCase();
    let list: Suggestion[] = [];
    if (suggest.trigger === "/") {
      list = CHAT_COMMANDS;
    } else if (suggest.trigger === "@") {
      list = $runtimeState.uploads.map((u) => ({
        label: `@${u.name}`,
        hint: u.size > 0 ? formatFileSize(u.size) : "upload",
        insert: `/home/user/uploads/${u.name}`,
      }));
      if (list.length === 0) {
        list = [
          {
            label: "@файлы",
            hint: "нет загруженных — прикрепите скрепкой",
            insert: "",
          },
        ];
      }
    } else if (suggest.trigger === "#") {
      list = $runtimeState.skills.map((sk) => ({
        label: `#${sk.name}`,
        hint: sk.description.slice(0, 60),
        insert: sk.name,
      }));
      if (list.length === 0) {
        list = [
          {
            label: "#скиллы",
            hint: "нет установленных (Settings → Skills)",
            insert: "",
          },
        ];
      }
    } else if (suggest.trigger === "$") {
      const pc = $runtimeState.providerConfig;
      const stats = $runtimeState.sessionStats;
      const pct =
        stats.contextWindow > 0
          ? Math.min(
              100,
              Math.round((stats.lastInputTokens / stats.contextWindow) * 100),
            )
          : 0;
      list = [
        {
          label: "$model",
          hint: pc ? pc.model : "не настроено",
          insert: pc ? `модель: ${pc.model}` : "",
        },
        {
          label: "$context",
          hint: `${stats.lastInputTokens}/${stats.contextWindow} (${pct}%)`,
          insert: `контекст: ${stats.lastInputTokens}/${stats.contextWindow} токенов (${pct}%)`,
        },
      ];
    }
    return q
      ? list.filter((item) => item.label.toLowerCase().includes(q))
      : list;
  });

  function updateSuggest() {
    const pos = textareaRef?.selectionStart ?? -1;
    if (pos < 0) {
      suggest = null;
      return;
    }
    const before = input.slice(0, pos);
    const m = before.match(/(^|\s)([\/@#\$])([\w.\-\/]*)$/);
    if (!m) {
      suggest = null;
      return;
    }
    suggest = { trigger: m[2], query: m[3], start: pos - m[3].length - 1 };
    selIndex = 0;
  }

  function acceptSuggestion(item: Suggestion) {
    if (!suggest || !item.insert) {
      suggest = null;
      return;
    }
    const pos = textareaRef?.selectionStart ?? input.length;
    input = input.slice(0, suggest.start) + item.insert + " " + input.slice(pos);
    suggest = null;
    queueMicrotask(() => {
      textareaRef?.focus();
      autoResize();
    });
  }
</script>

<div
  class="border-t border-(--chat-border) px-3 py-2 bg-(--chat-bg)"
  style="font-family: var(--chat-font-mono)"
>
  {#if $runtimeState.error}
    <div class="text-(--chat-error) text-xs mb-2 px-1">
      {$runtimeState.error}
    </div>
  {/if}

  {#if $runtimeState.uploads.length > 0}
    <div class="flex flex-wrap gap-1.5 mb-2">
      {#each $runtimeState.uploads as file (file.name)}
        <div
          class="flex items-center gap-1 px-2 py-1 text-[10px] bg-(--chat-bg-secondary) border border-(--chat-border) text-(--chat-text-secondary)"
          style="border-radius: var(--chat-radius)"
        >
          <span class="max-w-[120px] truncate" title={file.name}>
            {file.name}
          </span>
          {#if file.size > 0}
            <span class="text-(--chat-text-muted)">
              {formatFileSize(file.size)}
            </span>
          {/if}
          <button
            type="button"
            onclick={() => chat.removeUpload(file.name)}
            class="ml-0.5 text-(--chat-text-muted) hover:text-(--chat-error) transition-colors"
            title="Remove from list"
          >
            <X size={10} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <input
    bind:this={fileInputRef}
    type="file"
    multiple
    onchange={handleFileSelect}
    class="hidden"
    accept="image/*,.txt,.csv,.json,.xml,.md,.html,.css,.js,.ts,.py,.sh"
  />

  <div
    class="relative bg-(--chat-input-bg) border border-(--chat-border) focus-within:border-(--chat-border-active) transition-colors"
    style="border-radius: var(--chat-radius)"
  >
    {#if suggest && suggestions.length > 0}
      <div
        class="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto bg-(--chat-bg-secondary) border border-(--chat-border) shadow-lg z-10"
      >
        <div class="px-2 py-1 text-[10px] uppercase tracking-wide text-(--chat-text-muted)">
          {suggest.trigger === "/"
            ? "команды"
            : suggest.trigger === "@"
              ? "файлы"
              : suggest.trigger === "#"
                ? "скиллы"
                : "переменные сессии"}
        </div>
        {#each suggestions as item, i (item.label)}
          <button
            type="button"
            onclick={() => acceptSuggestion(item)}
            onmouseenter={() => (selIndex = i)}
            class={`w-full text-left px-2 py-1.5 flex items-baseline justify-between gap-2 transition-colors ${i === selIndex ? "bg-(--chat-accent)/20" : "hover:bg-(--chat-bg)"}`}
          >
            <span class="text-xs text-(--chat-text-primary) truncate">{item.label}</span>
            <span class="text-[10px] text-(--chat-text-muted) truncate max-w-[55%]">{item.hint}</span>
          </button>
        {/each}
      </div>
    {/if}
    <textarea
      bind:this={textareaRef}
      bind:value={input}
      oninput={() => {
        autoResize();
        updateSuggest();
      }}
      onkeydown={(event) => {
        if (suggest && suggestions.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            selIndex = Math.min(selIndex + 1, suggestions.length - 1);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            selIndex = Math.max(selIndex - 1, 0);
            return;
          }
          if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
            event.preventDefault();
            acceptSuggestion(suggestions[selIndex]);
            return;
          }
          if (event.key === "Escape") {
            suggest = null;
            return;
          }
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void handleSubmit();
        }
      }}
      placeholder={$runtimeState.providerConfig
        ? "Type a message..."
        : "Configure API key in settings"}
      disabled={!$runtimeState.providerConfig}
      class="w-full resize-none bg-transparent text-(--chat-text-primary) text-sm px-3 pt-2 pb-0 border-none outline-none placeholder:text-(--chat-text-muted) disabled:opacity-50 disabled:cursor-not-allowed"
      style={`font-family: var(--chat-font-mono); line-height: ${LINE_HEIGHT}px; height: ${LINE_HEIGHT * MIN_ROWS}px;`}
    ></textarea>

    <div class="flex items-center justify-between px-1.5 py-1">
      <button
        type="button"
        onclick={() => fileInputRef?.click()}
        disabled={$runtimeState.isUploading || $runtimeState.isStreaming}
        class="flex items-center justify-center w-6 h-5 text-(--chat-text-muted) hover:text-(--chat-text-primary) disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Upload files"
      >
        <Paperclip
          size={13}
          class={$runtimeState.isUploading ? "animate-pulse" : ""}
        />
      </button>

      {#if $runtimeState.isStreaming}
        <button
          type="button"
          onclick={() => chat.abort()}
          class="flex items-center justify-center w-6 h-5 text-(--chat-error) hover:text-(--chat-bg) hover:bg-(--chat-error) transition-colors"
          style="border-radius: var(--chat-radius)"
        >
          <Square size={13} />
        </button>
      {:else}
        <button
          type="button"
          onclick={handleSubmit}
          disabled={!$runtimeState.providerConfig || !input.trim()}
          class="flex items-center justify-center w-6 h-5 text-(--chat-text-muted) hover:text-(--chat-text-primary) disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={13} />
        </button>
      {/if}
    </div>
  </div>
</div>
