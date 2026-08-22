# Digest

Research date: 2026-08-22. Mode: deep research (4 facets, 4 conversations, adversarial check included). Baseline: offline fork of office-agents (Excel/Word/PPT taskpane add-in chat agent, local llama.cpp ~35B, single user, no cloud).

## Key findings (with [n] refs to conversations below)

- The 2025-2026 shift is from "better models" to "better agent harness" — the scaffolding wrapping the LLM loop: context engineering, loop/graph orchestration, deterministic permission boundaries, durable state memory [1].
- Claude Code harness: plan mode (read-only tools stripped), ephemeral subagents returning markdown summaries, TODO ledger tool, PreToolUse/PostToolUse hooks, auto-compact (purge old tool outputs first), lazy-loaded MCP schemas, background tasks (`/bg`, `/sessions`, `/switch`), git-based checkpoints [1].
- Codex CLI: app-server architecture (JSON-RPC, async), approval policies `suggest` / `auto-edit` / `full-auto`, `/undo` state rollback, AGENTS.md, Reviewer Agent [1].
- Gemini CLI: 1M-token window + late compaction, shadow-git checkpointing before file-modifying tools, `!` bang commands, GEMINI.md, tool allow/block lists [1].
- Industry-standard harness baseline: markdown memory (CLAUDE.md/AGENTS.md), deterministic hooks, explicit TODO tool, MCP as the universal tool-integration standard [1].
- M365 Copilot architecture: Copilot Studio orchestrator (task decomposition, async planning, dynamic model choice) → grounding layer (Microsoft Graph, Work IQ semantic index, MCP) → app-specific agents (Excel: Python in Excel; Word: paragraph patching preserving styles/tracked changes; PPT: master-slide-conformant generation) [2].
- Leaked Claude for Excel prompt: mandatory planning phase for complex financial tasks, plan shown + explicit consent via `ask_user_question` before first step; strict read/write tool separation; re-validate sheet collection from the object model (never from memory); final audit scanning for `#VALUE!`, `#REF!`, `#NAME?`, circular refs; no "all/every" claims unless every cell was checked; concrete action reports ("applied 2-decimal format to C2:C7") [2].
- Genspark/GenOffice-style office agents: async computation (agent works in background), critic-executor self-reflection verification loops, human-in-the-loop gateway blocking destructive ops (clear sheet, delete rows, DB overwrite), native document parsing restoring paragraph blocks/table geometry/formula dependencies locally [2].
- User criticisms of office agents: cell-range misaddressing, overwriting hidden rows, hardcoding over formulas, 30-90s latency, token-hungry self-check loops [2].
- Undo in office agents: M365 Copilot auto-snapshots to SharePoint/OneDrive version history + one-click "Undo Actions" in chat; Claude for Excel computes in a shadow sheet and applies as one batch transaction so Ctrl+Z reverts everything [2].
- Memory best practice: layered memory (L0 system prompt / L1 working context / L2 semantic on-demand), add-only extraction with temporal decay, background "sleep" consolidation, human-editable memory UI; Claude Code auto-memory writes ~25KB notes mixed into each new session; sessions: `--resume`, `--fork-session`/`/branch`, `/export`; per-project isolation by directory [3].
- Adversarial check on our product ranked the worst gaps: (1) single-chat isolation + zero persistence (no cross-document context, no epistemic continuity), (2) weak vision/layout pipeline, (3) no local code sandbox/REPL for arbitrary transforms, (4) no local RAG (agent lives in a vacuum; /compact is a band-aid), (5) no dual-model routing — 35B struggles with long tool chains; speculative small-model (1-3B) planning suggested before the 35B executes [4].
- Confidence note: M365 Copilot orchestrator/grounding/app-agents and Claude-for-Excel prompt details are consistent with primary sources; "GenOffice by Genspark" specifics and "shadow sheet batch transaction" mechanics are single-source — treat as directional [2].

## Canonical component list of a 2026 agent harness

1. **Agent loop/orchestrator** — core LLM loop routing tools, decomposing tasks (Copilot Studio style) [1][2]
2. **Planning mode** — read-only restricted mode + plan approval gate before execution [1][2]
3. **TODO/task ledger** — explicit state-tracked task list tool; prevents state drift in long loops [1]
4. **Subagents** — isolated-context workers returning distilled summaries; parallel specialists [1]
5. **Permission modes** — suggest/auto-edit/full-auto escalation; interactive approval for risky tools [1]
6. **Hooks** — PreToolUse/PostToolUse deterministic interceptors (safety checks, log scrubbing) [1]
7. **Background/async execution** — long tasks run detached with progress UI and session switching [1][2]
8. **Checkpoints/undo/rewind** — snapshots before writes; one-click revert of agent actions [1][2]
9. **Context engineering** — auto-compaction, lazy/JIT tool-schema loading, config-file memory (CLAUDE.md/AGENTS.md/GEMINI.md) [1][3]
10. **Skills system** — SKILL.md folders discovered as progressive-disclosure capabilities [1]
11. **MCP client** — universal external tool integration standard [1][2]
12. **Layered memory** — auto-memory notes + semantic/episodic store + per-project isolation, human-editable [3]
13. **Session management** — resume, fork/branch, export; multi-conversation UI [3]
14. **Verification loops** — critic-executor self-check before commit (code test-run, formula audit) [2]
15. **Human-in-the-loop confirmation** — ask_user_question tool; hard block on destructive actions [2]
16. **Code interpreter sandbox** — isolated Python/WASM REPL for arbitrary transforms [2][4]
17. **Local RAG/retrieval** — background indexing of the user's folder/PDFs/notes [4]
18. **Dual-model routing** — fast small planner + deep executor to hide local inference latency [4]

## Gap table (our offline office-agents fork)

| # | Feature (gap) | Who has it | Why it matters for an Office agent | Effort |
|---|---|---|---|---|
| 1 | Persistent chat history across restarts | Claude Code (JSONL), ChatGPT, Open WebUI [3] | Chat state dies with the document session; users lose work and trust | S |
| 2 | TODO/task ledger tool | Claude Code, Codex [1] | Local 35B drifts over long tool chains; visible progress for multi-step edits | S |
| 3 | Plan mode + plan approval gate | Claude Code plan mode; Claude for Excel planning phase [1][2] | Prevents a weaker local model from making destructive edits unreviewed | M |
| 4 | Structured confirmation tool (ask_user_question) + permission modes | Claude Code; Codex suggest/auto-edit/full-auto; Genspark HITL gateway [1][2] | Safety for "clear sheet / delete rows / overwrite file"; currently no escalation UX | S-M |
| 5 | Post-edit verification loop (re-read ranges, scan #REF!/#VALUE!/#NAME?, circular refs) | Claude for Excel final audit; Genspark critic-executor [2] | Cell misaddressing is the #1 complaint about office agents [2] | M |
| 6 | Cross-session / cross-document auto-memory | Claude Code auto-memory, ChatGPT memory, Letta, Mem0 [3][4] | No re-explaining preferences/conventions; continuity across docs | M |
| 7 | Undo/checkpoints beyond Excel (Word/PPT) | M365 Copilot snapshots + "Undo Actions"; Gemini shadow git [1][2] | We only have undo_edits journal for Excel; Word/PPT edits are one-way | M |
| 8 | Multi-conversation UI + resume/fork | ChatGPT, Open WebUI, Claude Code --resume/--fork [3] | Single chat per document caps parallel workstreams and experimentation | M |
| 9 | Background/async execution with progress | Claude Code /bg; Genspark async framework [1][2] | 35B local inference is slow; UI must not block for 30-90s agent runs | M-L |
| 10 | Hooks (pre/post tool interceptors) | Claude Code, Codex, Gemini [1] | Deterministic guardrails and output scrubbing without trusting the LLM | M |
| 11 | Local code interpreter sandbox (Python/WASM) | M365 Copilot (Python in Excel), coding agents, GenOffice [2][4] | Pre-baked tools can't cover arbitrary transforms/data cleaning | L |
| 12 | Local RAG over documents folder | Cursor, enterprise agents [4] | Context beyond the open document; offline-compatible | L |
| 13 | Dual-model routing (small planner + 35B) | speculative-routing pattern in 2026 agents [4] | Latency hiding and fewer tool-call loops from the big model | L |
| 14 | MCP client support | Industry standard across all CLIs [1][2] | Extend tools without shipping code; offline MCP servers exist | M-L |
| 15 | Chat export (Markdown/JSON) | Claude Code /export, Open WebUI [3] | Auditability, sharing, archiving of agent work | S |
| 16 | Per-document convention file (CLAUDE.md-equivalent) | Claude Code, Codex, Gemini [1] | Document-specific style/rules injected every turn | S |

## Top-10 recommendations (offline, local 35B, single user)

1. **Persist chat history per document** (S) — IndexedDB/localStorage keyed by doc; instant trust win, no cloud needed.
2. **Add a TODO ledger tool** (S) — cheapest reliability upgrade for long tool chains on a local model.
3. **Plan-approval mode + ask_user_question confirmation tool** (M) — mirror Claude for Excel defaults: plan in chat, explicit consent before first write, hard confirm for destructive ops.
4. **Post-edit verification pass** (M) — re-read written ranges, scan for #REF!/#VALUE!/#NAME?/circular refs, report concrete actions ("formatted C2:C7 to 2 decimals"), forbid unverified "all/every" claims.
5. **Cross-session auto-memory** (M) — a human-editable memory file per user + per document, mixed into each session; layered (working/notes), add-only.
6. **Extend undo journal to Word/PPT** (M) — snapshot-based checkpoints before OOXML edits + one-click "Undo agent actions" button in chat.
7. **Multi-conversation sidebar with resume/fork** (M) — multiple chats per document, reopen after restart, fork to try variants.
8. **Async execution with live progress** (M-L) — run agent turns in background, stream tool-call progress, keep taskpane responsive during long local inference.
9. **Permission modes** (S-M) — read-only/suggest vs auto-apply toggle per session, mirroring Codex suggest/auto-edit/full-auto.
10. **Chat/session export to Markdown** (S) — one-click export of conversation + tool actions for audit.

Deferred (L, revisit later): local Python/WASM code sandbox, local RAG indexing, dual-model routing, full MCP client.

## Conversations (for follow-up; ids die on MCP restart, urls do not)

| Facet | id | Turns | conversation_url |
|---|---|---|---|
| 1. Coding-agent harnesses | c1 | 3 | https://www.google.com/search?udm=50&q=How+do+Claude+Code%2C+OpenAI+Codex+CLI%2C+and+Gemini+CLI+organize+their+agent+functionality+in+2025-2026%3F+I%27m+interested+in+the+%22agent+harness%22%3A+subagents%2C+planning+mode%2C+TODO%2Ftask+lists%2C+hooks%2C+permission+modes+%28auto-accept%2C+plan+mode%2C+yolo%29%2C+background+tasks%2Fshells%2C+checkpoints%2Frewind%2C+MCP+support%2C+context+compaction.+What+is+considered+core+harness+functionality+in+modern+CLI+coding+agents%3F&mstk=AUtExfDzQ2a5wWN01tUhVBMSKP7ziZSfUpyLnoRfCwepQvWNuUp-SA_WReO6CyqukObPAG8RsKczTSFnMjlqIWJFQeLhOeZ1NtMlM0S_nM8HSNc3z0MeT-ZnBLBTyu7k0fmAEvIX3SQ7Phu8Vpv49hkXcU4pUPJjqpSW0bQ4&csuir=1&atvm=2&mtid=W46JauqjJdPywPAPh6CjyAg |
| 1. share link (turn 3) | c1 | — | https://share.google/aimode/e5bm0mhCE6UOKnMUt |
| 2. Office/document agents | c2 | 3 | https://www.google.com/search?udm=50&q=Office+and+document+agents+2025-2026%3A+How+is+Microsoft+365+Copilot+architected+%28orchestrator%2C+grounding%2C+app-specific+agents%2Fskills+in+Excel%2FWord%2FPowerPoint%29%3F+What+did+leaked+Claude+for+Excel+%2F+Claude+for+Sheets+prompts+reveal+about+orchestration%2C+skills%2C+interaction+defaults%3F+What+agent+capabilities+do+AnyModal%2C+Genspread%2FGenspark+or+similar+office+AI+agents+ship%3A+multi-step+planning%2C+verification+loops%2C+user+confirmation+for+destructive+actions%2C+document+understanding%3F&atvm=2&mstk=AUtExfDe4KftnVE9vW51MD9ng47esAhBrggr6rNYEWJGW8bKQ7dkQOet9BCXD8JAK0E5GOIhUkuxuYA46h1VoYdPt3MiIdYj7f_RHK2o-tUWPQtrdf8P6_8aWOf_z9wjN84VqkzZRBHUcjqqD9lkQEPOD9M4WFeI6eSlxL2xnLFp626CtC5FRIVfM9DnvnB0saOYYhotH61KCmxYzSsMMv7pEImhkw1Bq73EtnAtQniYDu-W1VkdIouzg&csuir=1&mtid=Go-JarqoMeDdwPAPurjZmQ0 |
| 2. share link (turn 3) | c2 | — | https://share.google/aimode/w74TfGJRb4peZFYL4 |
| 3. Memory & sessions | c3 | 1 | https://www.google.com/search?udm=50&q=Agent+memory+and+session+management+2025-2026%3A+How+do+leading+LLM+agents+%28Claude+Code%2C+ChatGPT%2C+Cursor%2C+Mem0%2C+Letta%2FMemGPT%2C+Open+WebUI%29+handle+cross-session+memory+%28auto-memory+files%2C+memory+tools%29%2C+persistent+chat+history%2C+multi-conversation+management%2C+session+resume%2Fexport%2C+and+per-project+memory%3F+What+patterns+are+considered+best+practice%3F&mstk=AUtExfDWSN9nKWB-iSN2bNZZZsjKNE7Qcn8ocJzMkLxVoPjk5mq6Sfl8BmhYSoX_x3xuvNJIYzCLE1hni3-iDjdXAgLEfAnsYkNFq7CN52lqgN8dejlN2hlwKqCDkrnAh7fZ-TqjGCCLBd8os4kwVvFNhFJmvPVikvipNr1NmBJmUoqHjkycBpM07mdYCPOUY3C4Mqg5C39jMCrrCaRJByygMNQxQFGX7ZNETDQYZqMXHTjcpb0Nwh10_Bs4AaMR-RM3HyME5JFI12whk&mtid=1I-JauvoBZ3bwPAP3LOc2QM |
| 3. share link | c3 | — | https://share.google/aimode/ZAyTzoteZBTU9GEeH |
| 4. Adversarial check | c4 | 1 | https://www.google.com/search?udm=50&q=Adversarial+review.+Product%3A+an+OFFICE+Office+add-in+agent+%28Excel%2FWord%2FPowerPoint+taskpane+chat%2C+local+llama.cpp+LLM+%7E35B%2C+single+user%2C+no+cloud%29.+Features+it+HAS%3A+25%2B+domain+tools+%28Office.js+sandbox%2C+cell+ranges%2C+OOXML+read%2Fedit%2C+slide+XML%2C+screenshots%3B+COM+bridges+to+Excel%2FWord%2FPPT%3B+Power+BI+DAX%2FTMSL%2FDMV+tools%3B+undo_edits+journal+for+Excel%3B+VFS+file+ops%3B+requirement-set+guards%29%3B+SKILL.md+skills+system+%2B+AI+skill-creator%3B+context+auto-compact+%2B+%2Fcompact%3B+streaming+chat+with+tool-call%2Fthinking+blocks%2C+prompt+history%2C+autocomplete%2C+file+uploads%2C+markdown%3B+settings+UI+%28provider%2C+temperature%2C+vision%2C+CORS+proxy%2C+web+tools+off+by+default%2C+COM+toggle%29%3B+single+chat+per+document%2C+no+persisted+history.+Challenge%3A+which+commonly+expected+agent+features+are+missing+or+weak+vs+2026+agent+products%3F+Give+the+strongest+criticisms.&mstk=AUtExfBA2ApzTdNXvjxVtMAtEYEtCEUaoznsGwFR9mDbniSsfcxQ35VUn_qpKqSrYaH0Md9gh2GOLBSexdYv9T9-bi_2pfaRXwIT--WFQrwcEb64bSc1V3cCp69CEXsNoHJH68Vo2sNND12YmYWeZ3BgmmP_SjfOJq0wCOOFiIJSlZ2wbT4XD9ph8V5W2UWfTzRyLbdnzpJwAzMZqHj-A8AfjJLJcRcj6EIopgul97WpknlAvFHWo1YWyEupj3etLdBX9iCTf6ydhpTXcA&mtid=_o-JasTkMeeGwPAPn4fOqUQU |

Note: two follow-up answers (c1 turn 2, c2 turn 2) completed server-side but were lost to a 30s client timeout; their content was re-retrieved in the immediately following turn of the same conversation. One search_ai call failed on an orphaned browser profile lock (recovered per skill protocol).

---

# Raw answers

## [c1-t1] How do Claude Code, OpenAI Codex CLI, and Gemini CLI organize their agent functionality (agent harness)?

In **2025–2026**, the AI engineering landscape shifted from building better raw models to perfecting the **"Agent Harness"**—the scaffolding that wraps an LLM loop to safely manage state, tools, context, and permissions. `[1][2][3]`

**Claude Code** (Anthropic), **OpenAI Codex CLI** (powered by the open-source Codex app-server), and **Gemini CLI** (Google's ADK-based runtime) implement these features via distinct architectural styles. `[1][2][3]`

Structural Comparison Matrix

| Harness Feature | Claude Code | OpenAI Codex CLI | Gemini CLI |
|---|---|---|---|
| Primary Design Philosophy | Developer-centric, highly interactive & programmable loop | Kernel-level safety, platform-open, CI/CD-first | Massive-context native, parallel specialist-focused |
| Planning Mode Execution | Enforced read-only sandbox via harness tools | Managed by upstream _Reviewer Agent_ / explicit subcommands | Prompts for strategy, but heavily impacted by execution changes |
| Permission Defaults | User-prompted interactive tool approvals | Strict named permission profiles & local policies | Configurable tool list allowlist/blocklist flags |
| Context Compaction | Automated `summary + tail` truncation on thrashing | Proactive token budget metrics with mid-turn unified hooks | Native 1M+ token window with late stage EventCompaction |
| State Undo / Rewind | Shallow Git commits tracking session states | System `/undo` state rollback tracking | JSON tool log combined with automated Shadow Git snapshots |

Detailed Analysis of Agent Functionality

1. Subagents & Planning Mode
- **Claude Code**: Employs a strict **Plan Mode** toggled natively via `Shift+Tab`. The harness itself strips all destructive, state-changing tools (like file edits or arbitrary bash writes). It spins out isolated, ephemeral subagents to gather codebase intelligence or query language servers, returning clean markdown summaries back to the parent session.
- **Codex CLI**: Offloads planning to an orchestration layer called **Graph Engineering**. Version 0.147 introduced a dedicated _Reviewer Agent_ running locally inside the harness to pre-approve code paths before execution. Delegation to external pipelines or multi-agent pools is triggered explicitly via `/delegate` commands.
- **Gemini CLI**: Relies on a **Parallel Specialist** approach. When a complex goal is issued, the CLI enters "Sub-task" mode, visually spawning parallel UI sub-icons. These subagents run focused loops in separate execution stacks, feeding distilled conclusions back to the main thread.

2. Permission Modes & Security Boundaries
- **Claude Code**: Balances user-oversight with velocity. It defaults to interactive confirmations for disk writes and network calls but allows automated rules to be permanently declared inside a project's `CLAUDE.md`.
- **Codex CLI**: Built heavily around programmatic predictability for continuous integration (via `codex exec`). It supports distinct approval policy flags:
  - `suggest`: Agent generates diffs but applies absolutely nothing without human intervention.
  - `auto-edit`: The agent can rewrite repository files automatically but blocks on any shell/terminal commands.
  - `full-auto` (YOLO): Full permission granted to read/write files and execute shell operations unprompted.
- **Gemini CLI**: Handled via its `tools.sandbox` settings file, where users explicitly define fine-grained `allowed` and `exclude` tool arrays alongside an `autoAccept` boolean toggle.

3. Background Tasks & Interactive Shells
- **Claude Code**: Features a fully decoupled background system via the `/bg` command. A developer can kick off a major refactor, push it into the background, view all ongoing active loops using `/sessions`, and seamlessly jump back in using `/switch <session-id>`. Non-blocking tools (like `npm test` or `docker build`) automatically hand execution control back to the prompt immediately.
- **Codex CLI**: Operates via a dedicated headless service architecture known as the **Codex App-Server**. It translates long-running client terminal inputs into JSON-RPC streams over network hooks, running operations asynchronously without blocking the user interface.
- **Gemini CLI**: Implements Direct Bang (`!`) terminal commands. It runs asynchronous operations through its underlying Message Bus system, passing tool state metrics to and from terminal threads without locking up primary interactions.

4. Checkpoints, State Recovery & Rewinds
- **Claude Code**: Relies heavily on Git tracking. It works alongside local trees to checkpoint modifications, meaning steps can be unwound using typical git mechanics or by clearing current session states.
- **Codex CLI**: Features an explicit `/undo` command that leverages its internal execution timeline to cleanly reverse the latest applied multi-file modification blocks.
- **Gemini CLI**: Implements an automated **Shadow Repository Checkpointing** engine. Before any file-modifying tool runs, it captures a dual-state backup: a local git snapshot inside a hidden `.git` directory and the raw conversation history/tool calls serialized inside a local JSON temporary directory, enabling zero-loss code restoration.

5. Model Context Protocol (MCP) & Context Compaction
- **Claude Code**: Anthropic's native environment for **MCP**. To preserve prompt windows, MCP definitions are lazy-loaded—the harness only injects tool names initially, fetching functional schemas on-demand. When context limits threaten stability, its engine triggers auto-compaction: it purges old tool execution outputs first, leaving core guidelines and file summaries intact.
- **Codex CLI**: Manages structural data via a typed `token_budget_context`. It exposes unified mid-turn compaction hooks so that custom plugins can compress historical chat blocks seamlessly before committing downstream tokens to expensive frontier endpoints.
- **Gemini CLI**: Takes advantage of Google's **1M+ token window** models. It loads global configurations from `~/.gemini/GEMINI.md` and applies Just-In-Time (JIT) context injection only when navigating into child folders. Its ADK architecture leverages a `CompactionRequestProcessor` to compress raw event history only after exceeding large predefined thresholds.

Core Harness Functionality in Modern CLI Agents — four pillars:
1. **Context Engineering (The Input Engine)**: ingest global config files (`CLAUDE.md`, `GEMINI.md`), lazy-load MCP schemas, execute JIT context fetching.
2. **Loop & Graph Engineering (The Execution Backbone)**: state machines governing subagent spin-up, structured findings passing, background multi-threading.
3. **Deterministic Permission Boundaries (The Shield)**: sandboxing separating read-only modes from side-effect-heavy tasks with named user safety defaults.
4. **Durable State Memory (The Ledger)**: independent checkpoints, atomic undo/redo, graceful recovery paths.

### Sources:
- [1] Codex as a platform: build on the open agent harness — https://developers.openai.com/blog/codex-as-a-platform
- [2] Unlocking the Codex harness: how we built the App Server | OpenAI — https://openai.com/index/unlocking-the-codex-harness/
- [3] Context compression - Agent Development Kit (ADK) — https://adk.dev/context/compaction/

Share link: https://share.google/aimode/O7zspcLfZ3eKfaacI

## [c1-t3] Follow-up: TODO lists, hooks, skills, CLAUDE.md memory; Codex/Gemini equivalents; industry standards

Claude Code Functionality
- **TODO List Tool**: A tool that forces Claude to write, update, and check off tasks in an independent, **state-tracked ledger** instead of relying on fragile conversation memory.
- **Hooks (`PreToolUse` / `PostToolUse`)**: Client-side code interceptors. `PreToolUse` validates safety and mutates arguments before execution; `PostToolUse` strips secrets and truncates large logs before the model sees them.
- **`SKILL.md` Skills**: A repository-level markdown file where developers define complex tool chains and commands, which the harness injects as **discovered agent capabilities**.
- **`CLAUDE.md` Memory**: A static project-level file containing strict coding guidelines that is **persistently prepended** to the prompt window on every single turn.

Codex and Gemini Equivalents
- **`AGENTS.md` (Codex CLI)**: The direct equivalent to `CLAUDE.md`, with added support for **multi-agent role mapping** and directory-specific expert delegation.
- **`~/.gemini/GEMINI.md` (Gemini CLI)**: Stores global and project-specific preferences, paired with an automated graph mapping layer that leverages Gemini's **1M+ token context**.
- **Middleware Pipelines (Codex/Gemini)**: Codex uses `on_tool_request` hooks, while Gemini utilizes `BeforeExecute`/`OnSuccess` event streams to mirror Anthropic's pre/post tool interceptors.

De-Facto Industry Standards — the baseline for any production-grade CLI agent harness:
1. **Markdown-Driven Memory (`CLAUDE.md` / `AGENTS.md`)**: Treating agent configuration as code by checking instructions directly into git.
2. **Deterministic Interception Hooks**: Enforcing security bounds and scrubbing logs using hardcoded client-side rules, never trusting the LLM to police itself.
3. **Decoupled Task Ledgers**: Forcing the agent to track progress via an explicit TODO tool to prevent state drift over long development loops.
4. **Model Context Protocol (MCP)**: The universal standard for tool integration, replacing proprietary plugin systems across all major CLI platforms.

Share link: https://share.google/aimode/e5bm0mhCE6UOKnMUt

(Note: c1 turn 2 — the fuller version of this question — completed on the server but was lost to a client timeout; the above is the re-asked, condensed answer.)

## [c2-t1] Office and document agents: M365 Copilot architecture, Claude for Excel leaked prompts, Genspark/AnyModal capabilities

(Answer returned in Russian; preserved verbatim.)

В период **2025–2026 годов** офисные ИИ-агенты совершили качественный скачок от простых чат-помощников к автономным мультиагентным системам. Интеграция передовых моделей (таких как Anthropic Claude) непосредственно в рабочие среды изменила подход к обработке документов и электронных таблиц. `[1][2][3]`

Архитектура Microsoft 365 Copilot (2025–2026) — четыре ключевых компонента: **оркестратор, слой заземления (Grounding), ядро Work IQ и апп-специфичные агенты**.

1. Новый оркестратор (Copilot Studio)
- Переработанный в середине 2026 года оркестратор Copilot Studio перешел на **асинхронное планирование задач** и динамический выбор LLM.
- Система способна переключаться между внутренними моделями и внешними коммерческими API (например, Anthropic Claude в рамках инициативы **Copilot Cowork**) в зависимости от сложности задачи.
- Оркестратор разбивает сложный запрос («Подготовь отчет к совету директоров») на подзадачи: сбор данных, расчеты, генерация текста, верстка слайдов.

2. Заземление (Grounding) и Work IQ
- **Work IQ:** единый семантический индекс организации поверх Microsoft Graph: Teams, SharePoint/OneDrive, календари, Outlook.
- **MCP (Model Context Protocol):** подключение внешних баз данных и CRM напрямую к контекстному окну агента.

3. Апп-специфичные агенты и навыки (Skills)
- **Excel Agent:** чтение/запись ячеек, формул, сводные таблицы и графики; вместо VBA макросов генерирует изолированные Python-скрипты (Python in Excel) для глубокого анализа данных.
- **Word Agent:** длиннотекстовые структуры, точечные правки (Paragraph Patching) — переписывает только измененные абзацы, сохраняя стили, разметку и Tracked Changes.
- **PowerPoint Agent:** генерация презентаций с соблюдением корпоративных бренд-буков и мастер-слайдов вместо случайных макетов.

Анализ утекших промтов Claude для Excel (слиты в конце 2025 – начале 2026):
- **Условие инициации планирования:** при комплексных финансовых/аналитических задачах (DCF, 3-statement model, LBO, реструктуризация) Claude обязан запустить **фазу планирования**.
- **Проектирование зависимостей:** разбиение задачи на последовательные фазы, строгое разделение инструментов чтения (`read`) и записи (`write`). План выводится в чат, запрашивается явное согласие пользователя через инструмент `ask_user_question` перед первым шагом.
- **Валидация коллекции листов:** запрещено оперировать структурой книги по памяти — при создании/модификации нескольких листов обязан в цикле запрашивать актуальный список из объектной модели Excel.
- **Защита от каскадных ошибок:** «финальный аудит» перед ответом — поиск `#VALUE!`, `#REF!`, `#NAME?`, циклических ссылок, некорректных диапазонов.
- **Проактивность без спама:** действовать без уточняющих вопросов, если контекст очевиден.
- **Гранулярность отчетов:** запрет обобщающих слов «всё/все/каждый» без личной проверки каждой ячейки; отчет должен содержать физическое описание действия («Применил формат с двумя десятичными знаками к диапазону C2:C7»).

Офисные агенты нового поколения (Genspark / GenOffice, август 2026, open-source Word/Sheets/Slides/PDF со встроенным суперагентом):
- **Многошаговое планирование:** асинхронный фреймворк — агент уходит в фоновый режим, параллельно опрашивает ресурсы, присылает готовый результат.
- **Верификационные петли:** изолированный цикл «Критик-Исполнитель» — проверка кода/формулы на тестовом подмножестве данных, исправление синтаксиса, сопоставление итога с промтом.
- **Подтверждение деструктивных действий:** шлюз human-in-the-loop — полная блокировка потока при очистке листа, удалении строк, перезаписи исходных данных, внешних действиях («Call For Me»).
- **Понимание документов:** мультимодальный разбор (Rust-компиляторы + PDFium WASM в GenOffice): восстановление блоков абзацев, геометрии таблиц, шрифтов и зависимостей формул; локальная конвертация PDF в редактируемые форматы.

### Sources:
- [1] From draft to done: agentic Copilot in Excel, Word, and PowerPoint — https://techcommunity.microsoft.com/blog/microsoft365copilotblog/from-draft-to-done-agentic-copilot-in-excel-word-and-powerpoint/4500196
- [2] Microsoft Copilot and Cowork Explained - innFactory AI Consulting — https://innfactory.ai/en/blog/microsoft-copilot-cowork-explained/
- [3] Microsoft Copilot 2026: The Complete Guide… - Till Freitag — https://till-freitag.com/en/blog/microsoft-copilot-guide-2026-en

Share link: https://share.google/aimode/ZRTH4MzmKW86gQmNp

## [c2-t3] Follow-up: user criticisms of office agents; undo mechanics

(Answer returned in Russian; preserved verbatim.)

Главные жалобы пользователей:
- **Ошибки в адресации ячеек:** ИИ часто смещает диапазоны (например, `A2` вместо `A3`), теряет данные в больших таблицах и перезаписывает скрытые строки.
- **Хрупкость и сбои логики:** агенты могут случайно заменять динамические формулы жестким текстом (hardcoded values) или нарушать базовые правила учета.
- **Низкая скорость:** комплексные задачи занимают от **30 до 90 секунд**.
- **Высокая стоимость:** огромный контекст таблиц и циклы самопроверки моментально сжигают токен-лимиты.

Как работает Undo (откат изменений):
- **Microsoft 365 Copilot:** перед каждым действием ИИ автоматически создает облачную **контрольную точку (snapshot)** в истории версий SharePoint/OneDrive. Пользователь может вернуть документ к исходному состоянию одной кнопкой «Undo Actions» в чате.
- **Claude для Excel / Sheets:** все вычисления выполняются изолированно во временной виртуальной копии листа (Shadow Sheet). Данные вносятся в реальную таблицу одной **пакетной транзакцией**, поэтому стандартный откат (Ctrl+Z) отменяет всю работу ИИ за один клик.

Share link: https://share.google/aimode/w74TfGJRb4peZFYL4

(Note: c2 turn 2 — the fuller version of this question — completed on the server but was lost to a client timeout; the above is the re-asked, condensed answer.)

## [c3-t1] Agent memory and session management: Claude Code, ChatGPT, Cursor, Mem0, Letta, Open WebUI

(Answer returned in Russian; preserved verbatim.)

Индустрия ушла от «запихивания» всей истории в контекст (prompt stuffing) к гибридным многоуровневым архитектурам, оптимизирующим токены и борющимся с деградацией внимания (context rot).

1. Архитектура памяти ведущих решений
- **Claude Code** (локально-файловый подход): `CLAUDE.md` в корне проекта + `~/.claude/` для глобальных настроек и автопамяти. **Auto memory** автоматически анализирует сессию и делает лаконичные текстовые заметки о предпочтениях пользователя и специфике проекта; файлы (до 25 КБ) автоматически подмешиваются в контекст каждой новой сессии. Преимущества: прозрачность, версионирование через Git, нулевая инфраструктура.
- **Letta / MemGPT** (метафора ОС): контекстное окно = RAM (Core Memory), внешние хранилища = диск. Инструменты подкачки: `memory_replace`, `archival_memory_insert/search`. Никакие скрытые пайплайны не меняют память за спиной модели.
- **Mem0** (пассивный конвейер): экстракция extract-then-reconcile; эволюция к однопроходному ADD-only извлечению фактов, связывание через сущности (Entity Linking), ранжирование с учетом времени (Temporal Reasoning).
- **ChatGPT**: неявное извлечение сущностей и инструкций в фоне (скрытые инструменты `save_memory`/`update_memory`); память глобальна для аккаунта, слабая изоляция проектов.
- **Cursor**: локальный RAG — векторные индексы по кодовой базе, Git-истории, документации; cross-session через `.cursorrules` и переиспользование эмбеддингов.
- **Open WebUI**: разделение на User memories (долгосрочные персональные) и Context memories (контекст беседы); модель автономно вызывает инструменты памяти; кастомные Pipe-скрипты для сессионной памяти на SQLite/ChromaDB.

2. Сравнение сессий и памяти

| Критерий | Claude Code | Letta (MemGPT) | Mem0 | Open WebUI |
|---|---|---|---|---|
| Тип управления | Файловый (Markdown)/Git | Агентно-управляемый (ОС) | Автоматический конвейер | Пассивный/инструменты модели |
| Хранилище истории | Plaintext JSONL локально | База данных (Recall memory) | Векторное + графы + KV | СУБД (PostgreSQL/SQLite) |
| Per-Project изоляция | Строгая (по директории) | Настраиваемая | Гибкая (`session_id`/`agent_id`) | По сессиям и пользователям |
| Резюмирование/экспорт | `/export` в текст | Через API | Выгрузка коллекций через SDK | Экспорт чатов (JSON/Markdown) |
| Fork/ветвление | Да (`--fork-session`, `/branch`) | Нет | Нет | Новый чат на базе старого |

3. Ключевые возможности
- **Session Resume:** `claude --resume <id/name>` или интерактивный Picker; при приближении к лимиту выполняется компакция — сжатие старого диалога в суммаризацию.
- **Session Forking:** `--fork-session` / `/branch` — точная копия истории с новым ID для тестирования альтернатив.
- **Per-Project память:** привязка к рабочей директории (Claude Code, Cursor) или изолированные коллекции с фильтрацией по `project_id`/`agent_id` (Mem0).

4. Лучшие практики
1. **Многоуровневая память:** L0 (индексный: системный промпт, правила маршрутизации), L1 (рабочая/эпизодическая: последние N сообщений и ключевые выводы), L2 (семантическая: подгружаемые по требованию файлы/эмбеддинги через RAG).
2. **ADD-only экстракция с временным весом:** данные сохраняются хронологически; ранжирование по графу сущностей с затуханием (decay-aware ranking).
3. **Разделение чтения и записи:** чтение быстрое и дешевое (гибридный поиск: семантика + ключевые слова + сущности); запись и консолидация («сессии сна» / dreaming sessions) — фоновые асинхронные процессы.
4. **Human-in-the-loop и корректируемость:** прозрачный интерфейс, где пользователь может вручную удалить ложный факт.

### Sources:
- [1] How Claude remembers your project - Claude Code Docs — https://code.claude.com/docs/en/memory
- [2] Agent Memory Systems: The Complete Guide (2026) — https://www.aibuilderclub.com/blog/agent-memory-systems-guide
- [3] Best Open Source Agent Memory Frameworks 2026 - EverMind — https://evermind.ai/blogs/best-open-source-agent-memory-frameworks-2026

Share link: https://share.google/aimode/ZAyTzoteZBTU9GEeH

## [c4-t1] Adversarial review: which commonly expected agent features are missing or weak in our offline Office add-in agent?

This is a rigorous architectural critique of your offline Office add-in agent based on the state of AI agents in 2026.

Your product has strong core mechanics (especially the undo journal, local tool sandbox, and context compaction). However, against 2026 standards, it suffers from severe limitations in **cross-document memory, multi-modal processing, external context retrieval, and modern UI execution paradigms**.

Ranked from highest to lowest severity:

1. The Critical Flaw: Single Chat Isolation & Zero Persistence
- **No Cross-Document Context**: users expect agents to work across projects; the agent cannot reference or copy context between a Word proposal and an Excel budget.
- **No Epistemic Continuity**: every document reopen, the agent "forgets" the user's working style, acronyms, previous feedback. Users hate re-explaining intent.
- **Missing**: a local vector database or unified cross-document session manager linking multiple active Office taskpanes.

2. Weak Multi-Modal Execution & Vision Pipeline
- **Blind to Native Layouts**: relying on screenshots inside a ~35B local model for layout analysis is inefficient and slow; 2026 agents use specialized vision-language tokens or native layout APIs.
- **No Video/Audio Stream Processing**: vision is a static snapshot rather than an active observer of the canvas.
- **Missing**: native layout coordinate mapping + optimized local vision pipeline.

3. "Dumb" Tool Call Evaluation & Lack of Code Interpreter
- **No Local Code Sandbox**: pre-baked Office.js/COM/DAX tools paralyze the agent on custom math transforms, data cleaning, or text parsing.
- **Lack of Self-Correction (REPL)**: 2026 agents run local ephemeral Python sandboxes (WASM/Pyodide) to write/test/debug scripts before touching the document canvas.
- **Missing**: isolated local WASM execution runtime.

4. Fragmented Knowledge Retrieval (No Local RAG)
- **Isolated from context**: no local semantic indexer; web tools off; the agent lives in a vacuum (PDFs, notes, archives unreachable).
- **Context Compaction is a Band-Aid**: manual /compact vs automated hierarchical memory management (sliding semantic windows).
- **Missing**: automated background local RAG pipeline over the active directory.

5. Rigid Tool Execution vs. Dynamic Agentic Planning
- **No Multi-Agent Orchestration**: a single ~35B loop frequently struggles with complex tool chain-of-thought sequencing over long steps — tool-call loops or hallucinations.
- **No Speculative Execution**: modern agents run small fast models (1B–3B) to draft/validate tool sequences before the heavy model processes the response.
- **Missing**: dual-model architecture (Fast Planner + Deep Thinker).

Comparative table (from the answer):

| Feature Dimension | Our 35B Local Agent | Standard 2026 Enterprise Agent |
|---|---|---|
| Memory | Isolated to active doc; vanishes on close | Unified local vector graph; permanent cross-doc memory |
| Data Manipulation | Restricted to predefined Office.js/COM tools | Local WASM Python/JS runtime for arbitrary execution |
| Retrieval | Manual file uploads only | Automated local folder RAG & background indexing |
| Latency Optimization | Context auto-compact & manual /compact | Speculative decoding; routing via 2B model to 35B model |

(No source URLs — synthesized model reasoning; cross-check against facets 1-3 above where possible.)
