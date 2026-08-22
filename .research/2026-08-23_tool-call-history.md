# Digest

Research date: 2026-08-22/23. Mode: search loop (single conversation c5, sequential). Budget: 5 server-processed turns (2 delivered inline/disk, 2 lost to client 30s timeouts and superseded by retry, 1 recovered from disk via save_to_file). Q4 (prefix cache) filled from the sibling local report `2026-08-23_prompt-caching-agents.md` (same `.research` dir) at zero search cost.

- API contract is strict: every `tool` message must reference a preceding assistant `tool_calls` id; every `tool_calls` message must be followed by tool messages for each id. Dropping either half of a pair = 400 (`tool_calls must be followed by tool messages`, Anthropic: `tool_use ids were found without tool_result blocks immediately after`). Orphan tool results without their parent call are rejected by strict OpenAI-compatible providers [1].
- Rewriting call ARGUMENTS while keeping the result misaligns request/response semantics — model confusion, loops, hallucination; only structural JSON corruption triggers a 400, but semantic damage is real [1].
- Claude Code microcompaction: keeps `tool_use` (name + arguments) strictly intact, snips the string inside old `tool_result` blocks, replacing with `[Result cached/saved to disk]`-style placeholder; keeps ~5 most recent results "hot"; full `/compact` wipes the whole array (calls AND arguments) and re-seeds with an LLM summary [2].
- Anthropic server-side context editing: clears early re-fetchable tool_results from the server cache while the pair structure stays valid [2].
- OpenAI Agents SDK: `auto` mode drops oldest COMPLETE turns (evicts call+result sets together to avoid 400s); `sessionInputCallback` is the sanctioned hook for placeholder substitution — modify only the tool message `.content`, leave `tool_calls` untouched [2].
- Cline/opencode: at ~85-90% window, sliding-window eviction that purges BOTH the initiating `tool_calls` message and its responses as a unit; plus LLM auto-compact summary [2].
- LangGraph: no implicit truncation; custom reducers replace `ToolMessage.content` with `"(Content truncated)"` while strictly preserving `tool_call_id` and the parent `AIMessage` [2].
- Web-search tools: industry rule — arguments (the query) are ALWAYS kept verbatim because the model needs to know what it asked; the RESULT is cleaned/compressed BEFORE it first enters history. OpenAI web search / Perplexity / Tavily return pre-stripped snippets; full pages live in an external cache [3].
- Three result-shrinking patterns: (1) external cache + metadata header in history + `view_page`/`search_in_cached_results` tools; (2) snip to top-3-5 results with title/url/500-char snippet; (3) summarization-before-insertion via a cheap subagent (1-2k tokens with citations instead of 50KB raw) [3].
- KV prefix cache matches left-to-right on byte-identical tokens; ANY mutation of an old message (arguments OR results) invalidates everything after that point; client-side silent mid-array truncation makes every request look new [4].
- Recommended compromise: sanitize tool outputs ONCE at insertion (before first entry into history), keep history append-only afterwards; do trimming only as an explicit compaction event (one planned re-prefill), never continuous per-turn pruning; Claude Code `/recap` appends summaries at the tail instead of mutating history [4].
- llama.cpp specifics: `--cache-prompt` default on; `--ctx-shift` drops oldest history server-side while `--keep`/`n_keep` preserves the system prefix; `--parallel 1` for a single-user slot [4].
- Verdict on user hypothesis (drop arguments, keep result): REFUTED — it is the exact inverse of every surveyed practice; it breaks the API contract (orphan result) on strict servers and saves ~0 tokens (arguments are tens of bytes vs 5-50KB results) [1][2][3].

Refs: [1] Query 1 answer below; [2] Query 2 (retry, saved to disk) below; [3] Query 3 below; [4] `F:\agent office\office-agents\.research\2026-08-23_prompt-caching-agents.md` (its conversations c1/c2, incl. official llama.cpp server README).

# Verdict + recommended policy for our stack

**Hypothesis "don't store call parameters since the result is self-descriptive": INVALID.**
1. It violates the OpenAI/Anthropic message grammar — a `role:"tool"` message with no matching preceding `tool_calls` id is a hard 400 on strict OpenAI-compatible servers; Anthropic rejects mismatched/missing `tool_use_id` outright [1]. (Our local llama.cpp may be lenient, but leniency is undocumented and fragile; the codex/litellm issues show providers do validate [1].)
2. It trims the WRONG side: arguments ≈ tens of tokens; result ≈ 1-12k tokens. Keeping results and dropping queries saves <1% of context while destroying the model's reasoning trace — a search result is NOT self-descriptive enough for the agent to know what it asked, whether to refine, or how to cite; misalignment causes confusion and tool loops [1][3].
3. Every surveyed framework does the opposite: arguments intact, result trimmed/summarized/evicted [2][3].

**Recommended policy (Office taskpane agent, OpenAI-compatible local LLM, append-only + prefix cache):**
- Store every assistant `tool_call` (name + JSON arguments) verbatim, forever, until whole-pair eviction.
- Compress search-tool results AT THE BOUNDARY, before first insertion into history: insert the extracted answer + citations (1-2KB) instead of raw 5-50KB SERP/markdown; keep the full raw result in an out-of-context cache (Map/file keyed by call id) and mention its location in the inserted text; optionally expose a `read_full_result(id)` tool for rare deep dives [3].
- This preserves append-only: nothing already in history is ever rewritten, so the KV prefix keeps hitting every turn [4].
- Overflow fallback (explicit compaction at ~85% context): batch-replace OLD tool_result contents with `"[old result removed — cached as <id>]"` keeping calls intact — accept ONE full re-prefill — or summarize history and restart; if evicting, always remove call+result PAIRS as complete units [2][4].
- Never prune/rewrite a few old messages every turn: each mutation invalidates the cache from that token onward, making every request a full prefill [4].
- llama.cpp: rely on `--cache-prompt` (default), enable `--ctx-shift`, set `--keep`/`n_keep` = system-prefix token length so server-side context shift never eats the system prompt [4].

# Conversations

- Main thread (all Q1-Q3 turns): conversation_id `c5`
  - share_url: https://share.google/aimode/tqtWe0ZjvTdZwu6Zz (turn 1)
  - turn-2 share (agent practices): https://share.google/aimode/CdOG1CoBEnbQMfNZf
  - turn-5 share (web-search practices): https://share.google/aimode/VJ7UphR6KWdytw6If
  - conversation_url (reopen): https://www.google.com/search?udm=50&q=In+the+OpenAI+Chat+Completions+and+Anthropic+Messages+APIs%2C+is+a+tool+result+message+required+to+reference+a+preceding+assistant+tool_call%3F+What+exactly+breaks+or+errors+if+you+drop+or+rewrite+a+tool_call+or+its+arguments+in+stored+conversation+history+%28400+errors+like+%22tool+message+must+follow+tool_calls%22%2C+Anthropic+tool_result+must+be+in+the+block+referenced+by+tool_use_id%29%3F&atvm=2&mstk=AUtExfBBqCFz6Eg8LYhLw8pCd0t3TaXhRdBF_mFSzoJDDZyhReAT4Qh2XEYTLjcjLGMIW8E2fNKJYTGHTpNiWvWO-l5SupmnBHoh7lUglIuKZdNZ2M3QY46MrbECu39z8IN_NkuvzBIjV3VWR7Kh9sEuezi4za6XNx4WiFk&csuir=1&mtid=i8qJav3JM8S9wPAP8YbJmQg
- Q4 material: conversations of the sibling report (see `2026-08-23_prompt-caching-agents.md` for c1/c2/c3/c4 ids and URLs).

---

## Query 1 (c5 turn 1): API contract — must a tool result reference a preceding tool_call?

Query: "In the OpenAI Chat Completions and Anthropic Messages APIs, is a tool result message required to reference a preceding assistant tool_call? What exactly breaks or errors if you drop or rewrite a tool_call or its arguments in stored conversation history (400 errors like 'tool message must follow tool_calls', Anthropic tool_result must be in the block referenced by tool_use_id)?"

conversation_id: c5; delivered inline.

**Yes, a tool result message is strictly required to reference a preceding assistant `tool_call` (OpenAI) or `tool_use` block (Anthropic)**.

Both APIs enforce a rigid, stateful grammar when parsing conversation histories. If you break this structural contract by dropping, modifying, or separating tool calls from their results in your stored database history, the upstream servers will immediately reject the payload with a **`400 Bad Request`** error. `[1][2][3]`

### 1. OpenAI Chat Completions API

OpenAI relies on a strict alternating pattern where tool definitions, requests, and results are bound together by an ID.

```
[Assistant: tool_calls (id: call_123)]  -->  [Tool: tool_call_id: call_123]
```

What exactly breaks if history is altered:

- **Dropping the `tool_result` message (Unresolved Tool Call)**: If an assistant message contains a `tool_calls` array, the very next messages _must_ be `role: "tool"` messages for **every single `id`** generated in that array. If you delete the tool response from history and send a new user message next, the API throws: `400 Bad Request: An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'.`
- **Dropping the Assistant `tool_calls` (Orphaned Tool Result)**: If you keep the `role: "tool"` message but delete the preceding assistant message that spawned it, the API will fail because a tool message cannot exist without an active, unresolved ID in the pipeline.
- **Rewriting Arguments in Stored History**: If you alter the `arguments` string inside the assistant's `tool_calls` (e.g., trying to "clean up" malformed JSON or stripping fields), the model loses context on what it originally requested. If the arguments no longer align with the generated `tool_result`, the model may get confused, loop, or hallucinate, though it won't always trigger a 400 error unless the structural JSON format itself becomes syntactically invalid.
- **Interruption of Sequence**: You cannot inject a `role: "user"` or standard text `role: "assistant"` message between the `tool_calls` message and its corresponding `tool` responses. Doing so breaks the array sequence and throws a 400 error.

### 2. Anthropic Messages API

Anthropic's structure is even more restrictive. Anthropic treats tool interactions as **content blocks** nested inside standard alternating messages (`user` and `assistant`).

```
[Message: role "assistant", content: [tool_use block (id: toolu_xyz)]]
                                  ↓
[Message: role "user", content: [tool_result block (tool_use_id: toolu_xyz)]]
```

What exactly breaks if history is altered:

- **Dropping the `tool_result` block**: If an assistant message contains a `tool_use` block, the **immediate next message** in the array must be a `role: "user"` message containing a matching `tool_result` block. If you omit it: `400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.X: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_XXXXX. Each `tool_use` block must have a corresponding `tool_result` block in the next message."}}`
- **Changing `tool_use_id`**: If the `tool_result` block's `tool_use_id` doesn't strictly match the ID in the preceding `tool_use` content block, validation fails with an `unexpected tool_use_id` or `missing matching tool_result` error.
- **Altering Extended Thinking Blocks**: With Extended Thinking, if an assistant message generates a `thinking` block followed by a `tool_use` block, you **must keep the `thinking` block intact** in history. Deleting or changing it while keeping the tool calls causes a 400.

### Direct Structural Comparison

| Rule | OpenAI Chat Completions | Anthropic Messages |
|---|---|---|
| Linkage mechanism | `tool_call_id` matches parent `tool_calls.id` | `tool_use_id` matches parent `tool_use` block ID |
| Message sequence | Assistant `tool_calls` followed directly by `tool` role messages | Strict user/assistant alternation; `tool_use` answered in immediate next `user` turn |
| Multi-tool calls | All ids in `tool_calls` array must get `tool` responses before conversation resumes | Next user message must contain all corresponding `tool_result` blocks |

### Summary Recommendation for Storing History

1. **Never mutate half a pair**: if you must drop a tool result, **also delete the preceding assistant message that initiated the tool call**.
2. **Rewind to the last user message**: the safest recovery for an aborted tool execution is to strip history back to the user's last standard query and let the model generate a fresh tool call.

## Sources:
[1] https://github.com/BerriAI/litellm/issues/19061
[2] https://github.com/anthropics/claude-code/issues/473
[3] https://github.com/openai/codex/issues/7275

share_url: https://share.google/aimode/tqtWe0ZjvTdZwu6Zz

---

## Query 2 (c5, turns 2-4; final answer saved to disk): what real agents do with old tool results

Query (final phrasing): "How do Claude Code, Cline, opencode, LangGraph and OpenAI Agents SDK shrink OLD tool results in history: truncation, eviction, placeholder like '(old result removed)'? Is the assistant tool_call with its arguments always kept intact? Anthropic context editing and microcompaction details?"

Note: turns 2-3 were processed server-side but delivery timed out client-side (30s MCP limit) and their content was lost; turn 4 (retry with save_to_file) succeeded and was recovered from `C:\Users\kira\AppData\Local\google-ai-mode-mcp\Data\results\tool-history-agent-practices.md`. conversation_id: c5; share_url: https://share.google/aimode/CdOG1CoBEnbQMfNZf

Each of these modern coding agent ecosystems handles context saturation differently, but they are all bound by the same structural rules: **you cannot safely alter or delete a tool call or its result without risking a `400 Bad Request` API validation error.**

To prevent these errors while managing context, they leverage deterministic string slicing, placeholder substitution, or explicit array eviction.

### 1. Claude Code & Anthropic Context Editing

Claude Code features a highly specialized, multi-tiered context management pipeline designed to optimize Anthropic's **Prompt Caching** architecture.

- **Microcompaction**: This is a **completely client-side, deterministic** routine. When the context window begins to fill up, Claude Code identifies old, verbose tool outputs (like massive bash outputs, dependency logs, or `cat` commands reading large files).
    - **Is the `tool_use` call kept?** **Yes.** The assistant's `tool_use` block, including its name and arguments, is kept **strictly intact** so the model remembers what it requested.
    - **How it handles the result**: The string content inside the matching `tool_result` content block is forcefully snipped or stripped out. It replaces the massive log with a concise placeholder like `[Result cached/saved to disk at path]` or a lightweight indicator string. Only a "hot tail" of the most recent ~5 tool results is left uncollapsed.
- **Server-Side Context Editing (Tool Clearing API)**: Anthropic natively supports developer-facing context-engineering patterns. Using targeted platform parameters, developers can clear early, re-fetchable tool results from the server-side cache. This reduces active memory usage without requiring the client to re-upload massive text payloads.
- **Auto-Compaction (`/compact`)**: If microcompaction isn't enough, Claude Code triggers a full compaction loop. It spins up a background LLM process to distill the entire chat history into a highly dense "project state summary" (capturing architectural decisions, constraints, and current TODOs). It then **wipes the entire message array completely** (evicting all historical tool calls and arguments) and re-seeds the new clean window with that summary.

### 2. OpenAI Agents SDK

The OpenAI Agents SDK provides fine-grained control over short-term session memory and history merging.

- **History Truncation (`auto` mode)**: By default, when a session exceeds a model's limit, the SDK automatically drops the oldest messages in the conversation history.
    - **Are the arguments kept?** **No, if they fall out of bounds.** If an old message falls outside the retained context window, the SDK evicts it completely. To avoid `400` errors, it handles eviction sequentially, clearing out complete sets of old turns.
- **`sessionInputCallback` (Deterministic Filtering)**: The SDK allows developers to provide an input lifecycle hook to merge new items with stored history manually before hitting the API. Developers use this hook to implement **placeholder substitution**. For example, you can write a loop that intercepts the array, targets `role: "tool"` messages that are older than 10 turns, and replaces their `.content` strings with `"(old result truncated for space)"`.
    - **Is the `tool_call` kept intact?** When doing this via the callback hook, **yes.** You leave the assistant's `tool_calls` object untouched in the historical array, but manually modify only the `.content` payload of the subsequent matching `tool` role message.

### 3. Cline & OpenCode

OpenCode and Cline operate as open-source agent environments that must maintain compatibility across multiple underlying models (Claude, GPT-4o, DeepSeek, local models via Ollama).

- **Eviction Layer (Fallback Sliding Window)**: If an agent reaches the maximum token window threshold (usually around 85-90% utilization), it employs a **sliding window eviction**. It calculates an exact truncation slice (often dropping the oldest 50% to 75% of messages).
    - **Are the arguments kept?** **No.** To prevent the API from throwing an unrecoverable `400` validation error due to an orphaned tool result, Cline's compiler finds the boundary index and safely purges _both_ the initiating `tool_calls` message and its corresponding responses together. The structural pairing is completely deleted from the active context payload.
- **LLM Auto-Compact Summary**: Similar to Claude Code, Cline frequently intercepts the workflow when context is full, summarizes the codebase context into a task status log, and restarts the conversation stream with a clean message log.

### 4. LangGraph

LangGraph treats conversation history as a localized state graph tracked by persistent database checkpointers. It does no implicit truncation; it **forces the developer to define compression behavior explicitly**.

- **State Reducers for Custom Substitution**: You manage history by applying a `reducer` function to your message key, writing a custom filter instead of the default append-all behavior.
- **Surgical Text Truncation**: A standard production pattern: a reducer that iterates over the state history array; if too long, it scans for `ToolMessage` nodes, mutates the `content` string into a short placeholder like `"(Content truncated)"`, but **strictly preserves the `tool_call_id`**.
    - **Is the `tool_call` kept intact?** **Yes.** You can leave the assistant's `AIMessage` (containing the `tool_calls` and arguments) totally untouched while safely hollowing out the bulky text payloads from the matching `ToolMessages`.

### Architectural Takeaway

1. **Micro-Compaction / Substitution (Surgical)**: Keep the assistant's request (`tool_call` arguments) verbatim so the model remembers its logic, but swap out the result with a brief placeholder. Crucial for maintaining short-term focus.
2. **Eviction / Reset (Summarization)**: Erase the tool pairs and arguments completely from history, substituting everything with a dense markdown summary. Crucial for avoiding long-term context pollution and reducing token costs.

## Sources:
[1] https://github.com/BerriAI/litellm/issues/19061
[2] https://github.com/anthropics/claude-code/issues/473
[3] https://github.com/openai/codex/issues/7275

share_url: https://share.google/aimode/CdOG1CoBEnbQMfNZf

---

## Query 3 (c5 turn 5; saved to disk): web-search tools — keep the query, strip the SERP

Query: "For LLM agents with web-search tools where arguments are a tiny query but results are 5-50KB: do agents keep the search query/tool arguments in history and instead summarize or strip the raw SERP before inserting the result into context? Practices: search result summarization before insertion, caching full results outside context (RAG/file), keeping only extracted answer + citations?"

Note: delivery timed out client-side; recovered from `C:\Users\kira\AppData\Local\google-ai-mode-mcp\Data\results\tool-history-websearch-practices.md`. conversation_id: c5; share_url: https://share.google/aimode/VJ7UphR6KWdytw6If. (Answer in Russian; key points below.)

Key points (translated digest):

- Passing raw HTML/JSON SERP into context is the main cause of instant context overflow and wasted spend. Since the call argument (the query) weighs a few bytes and the result can be 5-50KB, clear architectural patterns have formed.
- **The original tool arguments (`tool_call` / `tool_use`) are ALWAYS kept in history verbatim** — they are critical for the model's logic (it must understand _what exactly_ it searched for). The result itself is cleaned, compressed, or replaced **before** the `tool` message is ever sent back to the LLM.
- Pattern 1 — Full-text search outside context (RAG / file caching): agent saves raw pages (SERP + HTML) to external storage (process memory, local file, temp vector DB); history receives only a minimal metadata header like `[Search done. 15 pages found. Results saved to /tmp/search_cache.db]`; the model gets helper tools `view_page(url)` / `search_in_cached_results(local_query)` and reads specific chunks on demand. Most scalable approach for autonomous agents.
- Pattern 2 — Answer/snippet extraction only (default in Tavily, Perplexity API, Serper; LangChain/CrewAI): backend parses raw HTML/JSON, strips ads/scripts/nav/footers, keeps 200-400-char snippets + titles; history receives a compact list of 3-5 most relevant results (title, url, snippet ~500 chars each).
- Pattern 3 — Summarization before insertion (multi-agent systems, LangGraph subagents): a fast/cheap "long-context" subagent (e.g. mini-tier model) receives the original query + all 50KB of raw results and produces a hard-compressed structured summary (1-2k tokens) with direct answers and source links; only that summary enters the main agent's `tool_result` — the main model never sees raw search spam.
- Per-tool survey: OpenAI Web Search (ChatP AllPT) — internal RAG, model gets short snippets with citations, full pages in hidden cache, original query visible in `tool_calls`: **arguments kept**. Perplexity/Tavily — snippets + essence extraction at the API level, cleaned JSON from the start, search parameters stay in history. LangGraph custom agents — custom node parses/truncates before returning the `ToolMessage`; `tool_call_id` and arguments in the `AIMessage` unchanged.
- Main rule for custom development: **never return the raw search response directly into history**. Optimal algorithm: (1) keep the original `tool_call` with its small query; (2) intercept the result on the backend; (3) clean it of HTML, keep top-5 results, trim each snippet to 500 chars; (4) pass the cleaned mini-text as the `tool` message `content`.

share_url: https://share.google/aimode/VJ7UphR6KWdytw6If

---

## Q4 (from local sibling report): prefix-cache interaction of rewriting old tool results

Source: `F:\agent office\office-agents\.research\2026-08-23_prompt-caching-agents.md` (researched 2026-08-22, conversations c1/c2/c3/c4 of that session; official ggml-org/llama.cpp server README). No new search spent.

- KV prefix cache matches **left-to-right on byte-identical tokens**; a 1-token change at any point invalidates everything after it.
- Client-side silent truncation (dropping old messages from the middle/head of the array each request) makes every request look new to the server — full KV clear and prefill from scratch.
- Recommended compromise: **sanitize tool outputs once, before first insertion** (strip ANSI, truncate long logs) — not on each re-send; **explicit compaction** (Claude Code `/compact` pattern) = one planned re-prefill instead of continuous per-turn mutation; Claude Code `/recap` appends its output at the tail instead of rewriting history.
- llama.cpp: `--cache-prompt` default-enabled; `--ctx-shift` default on (server discards first half of history while preserving the system prefix); set `--keep N` / request `n_keep` = system prefix length; `--cache-reuse`/`n_cache_reuse` for non-contiguous reuse (default 0 = off); `--parallel 1` single-user so exactly one slot holds the KV; ensure `-c` fits the whole session.
- Anthropic side: cache_control breakpoints, sliding-window caching; byte-for-byte prefix discipline (opencode "harness immutability").
