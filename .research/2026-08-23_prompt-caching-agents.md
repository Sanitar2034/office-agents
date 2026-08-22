# Prompt caching & token minimization for coding agents (researched 2026-08-22)

# Digest

Stack context: offline Office add-in agent (taskpane) -> same-origin proxy -> local llama.cpp `llama-server` (OpenAI-compatible /chat/completions, 35B model, 160k ctx). Per turn: large static system prompt (Office.js instructions + per-doc conventions + agent memory) + ~40 tool schemas + history.

## (a) Ranked techniques for OUR stack

1. **Freeze the prefix, layer static-to-dynamic** [1][2]: byte-identical ordering `static system prompt -> tool schemas -> per-doc conventions/memory -> history -> new user/tool output`. Anything dynamic (timestamps, session/request IDs, dates, current doc state, "context refreshed at...") must be excluded from the cached prefix entirely or appended at the tail — a 1-token change at the head invalidates everything after it (KV cache is prefix-matched left-to-right) [2].
2. **Move per-document conventions + agent memory OUT of the system prompt** [1]: the system prompt should be identical across all turns AND ideally across sessions. Per-doc context belongs in the first user message (written once per session, then append-only). This is the single biggest fix for the described setup.
3. **Deterministic, minified tool schemas** [1]: sort the `tools` array stably (e.g. alphabetical by name) and minify JSON (no pretty-printing). Reordering or reformatting tools between requests silently breaks the cache after the system block.
4. **Lazy / on-demand tool loading** [3]: opencode ships lazy tool definitions + MCP schema optimization — measured ~6.9k baseline tokens vs Claude Code's ~32.8k [3:systima]. Pattern: keep a small core toolset in the prompt + a meta-tool ("list_excel_tools", "load domain tools") that surfaces the other ~35 schemas only when needed. Cuts both prefill cost and cached-prefix size. Caveat: changing the tool list mid-session re-writes a new prefix (one re-prefill per toolset change) — batch changes, don't churn.
5. **Append-only history discipline** [1][2][3]: never rewrite/reformat old messages (Claude Code keeps byte-for-byte prefixes and appends `/recap` output at the tail instead of mutating history [3]); sanitize tool outputs (strip ANSI, truncate long logs) BEFORE first insertion, not on each re-send; use relative paths not absolute [1].
6. **Explicit compaction instead of silent truncation** [1][2][3]: when history grows, summarize old turns deliberately (Claude Code `/compact` pattern [3]) — one planned re-prefill instead of a client that silently drops middle messages each turn (which makes every request look new to the server) [2].
7. **llama.cpp server settings** [2][5]: `--cache-prompt` is **default-enabled** (CLI and request-level `cache_prompt: true` default); `--ctx-shift` default on; set `--keep N` / request `n_keep` = length of the system prefix so context shift never discards the system prompt; consider `--cache-reuse` / `n_cache_reuse` (min chunk size for KV-shift reuse of non-contiguous cache, default 0 = off); single-user -> `--parallel 1` so there's always exactly one slot holding your KV; ensure `-c` fits the whole session (160k) or the cache gets evicted/truncated.
8. **Proxy transparency**: the same-origin proxy must forward the request body byte-identically — no reordering messages, no re-templating, no injected preamble. Chat-template application happens server-side; do NOT pre-render chat markup client-side [2].

## (b) Request-shape changes

- `messages[0]` = frozen system prompt (Office.js core only; no date/ID/doc-state).
- `tools` = alphabetical, minified, frozen for the session; lazy-load domain groups via meta-tool.
- Per-doc conventions + memory = first user message, append-only afterwards.
- New turns appended verbatim; tool outputs pre-sanitized once.
- Optionally pass `"cache_prompt": true` explicitly (harmless; default true) and set `n_keep` = system-prefix length [5].
- Keep one long-lived session per document; don't restart the prefix on every user turn.

## (c) Verifying hits from responses

- **llama.cpp /v1/chat/completions**: `usage.prompt_tokens_details.cached_tokens / usage.prompt_tokens`; also non-standard `timings.cache_n` (prompt tokens reused from cache) vs `timings.prompt_n` (recomputed) [4][5]. Hit rate = `cache_n / (cache_n + prompt_n)`.
- `GET /slots` (enabled by default) for per-slot cache/processing state; server log prints prompt-cache-hit per request [2][5].
- **OpenAI**: same formula with `usage.prompt_tokens_details.cached_tokens` [4]. **Anthropic**: `cache_read_input_tokens / (input_tokens + cache_read_input_tokens + cache_creation_input_tokens)` [4].

## Confidence notes

- [3]'s ZCode-specific claims ("90% cache hit", "90/10 split") are weakly sourced (Reddit/marketing) — treat as unverified; no public engineering material on ZCode found.
- [2]'s "shared cross-slot cache" phrasing is imprecise: real llama.cpp keeps per-slot KV and picks a slot via prompt similarity (`--slot-prompt-similarity`, default 0.10) [5].
- Most of [1] is synthesized best-practice (consistent with Anthropic's documented guidance [3:code.claude.com]) rather than a single canonical spec.

Source refs: [1] c1 answer below; [2] c2 answer below; [3] c3 answer below (code.claude.com/docs/en/prompt-caching, systima.ai/blog/claude-code-vs-opencode-token-overhead, github.com/cline/cline/discussions/9892, opencode issue #5416); [4] c4 answer below (developers.openai.com/cookbook prompt_caching101, braintrust.dev token-usage-2026, devtoollab.com); [5] official ggml-org/llama.cpp `tools/server/README.md` (fetched 2026-08-22, quoted in last section).

Conversations: c1 https://www.google.com/search?udm=50&q=2026+best+practices+for+maximizing+LLM+prompt+cache+hit+rates+in+coding+agent+loops%3A+stable+system+prompt%2C+deterministic+tool+ordering%2C+Anthropic+cache_control+breakpoints%2C+lazy+tool+schema+loading%2C+splitting+static+vs+dynamic+context%2C+avoiding+timestamps%2FIDs+in+prompts.+What+concrete+techniques+do+agentic+coding+tools+use+to+minimize+per-request+tokens+and+keep+KV%2Fprefix+cache+hits+high%3F&atvm=2&mstk=AUtExfBMxBvd_JjG2qLF3mRhYeQU_zf1J0pb6uXDSupSDGxgy2NTJ1-UhikoC8di9f56q6cuuavf5pUmwmgq18pDWLWq1seMxau7k1A6LqU8opuDc-Olel1sMax6ASvspYgqfG6Ma713YcUmaDEzk5y0JfUk3LRKAzviVUk&csuir=1&mtid=c7yJasKMEMDvwPAP4JfB0AE ; c2 https://www.google.com/search?udm=50&q=llama.cpp+llama-server+prompt+caching+explained%3A+how+does+the+KV+cache+and+prefix+matching+work+with+slots+%28--parallel%2C+cache_prompt+flag%2C+slot+prompt+difference%29%2C+why+does+an+OpenAI-compatible+client+break+the+prompt+cache+%28changing+first+tokens%2C+system+prompt+drift%2C+n_predict%2C+context+shift%29%2C+and+what+server+parameters+and+request+options+are+recommended+in+2025-2026+to+maximize+prefix+cache+reuse+for+chat+agents%3F&atvm=2&mstk=AUtExfC_oMLsCC6Axb1ewzUmq4E_DQE3I8T9gtME2xrATCa95d33_ef_bQuwl0A8AWy4BzwTEFh9nnx3jmZnEfnwLeEviHGsH4x1OZ6GLEtVfBVxiQ_h7cBkk5c9YMvKl1YA58vTJjH2W_suf4GZkdHrfxxCd9TNuiZ6CnU1ACudp0qawmitkpvjtG8yUVdD4t_vXE49eOfPwyv5ASZkt9OJDNQDXcnoYXdsuh0Gg_NkHZORgYGq_-CwiJln1Kfse5VQ&csuir=1&mtid=kLyJasiwCo61wPAPhNaM8A4 ; c3 share https://share.google/aimode/KBvKr06XtZvExIxnx ; c4 share https://share.google/aimode/HHmYF0ErT6yTQiRV1

---

## Query 1 (c1): 2026 best-practice techniques for prompt-cache hit maximization in coding agent loops

conversation_id: c1
conversation_url: https://www.google.com/search?udm=50&q=2026+best+practices+for+maximizing+LLM+prompt+cache+hit+rates+in+coding+agent+loops%3A+stable+system+prompt%2C+deterministic+tool+ordering%2C+Anthropic+cache_control+breakpoints%2C+lazy+tool+schema+loading%2C+splitting+static+vs+dynamic+context%2C+avoiding+timestamps%2FIDs+in+prompts.+What+concrete+techniques+do+agentic+coding+tools+use+to+minimize+per-request+tokens+and+keep+KV%2Fprefix+cache+hits+high%3F&atvm=2&mstk=AUtExfBMxBvd_JjG2qLF3mRhYeQU_zf1J0pb6uXDSupSDGxgy2NTJ1-UhikoC8di9f56q6cuuavf5pUmwmgq18pDWLWq1seMxau7k1A6LqU8opuDc-Olel1sMax6ASvspYgqfG6Ma713YcUmaDEzk5y0JfUk3LRKAzviVUk&csuir=1&mtid=c7yJasKMEMDvwPAP4JfB0AE

Чтобы минимизировать задержки (latency) и снизить затраты на токены в итеративных циклах кодинг-агентов (например, Cursor, Cline, Roo Code), необходимо поддерживать контекстное окно LLM в максимально стабильном состоянии. Любое изменение в начале или середине промпта инвалидирует кэш ключевых значений (KV/Prefix Cache) для всех последующих токенов.

Ниже приведены конкретные архитектурные техники и лучшие практики 2026 года для максимизации **Prompt Cache Hit Rate**.

### 1. Архитектура промпта: Разделение статического и динамического контекста

Главное правило кэширования: **статическое — вверх, динамическое — вниз**. Промпт конструируется как слоеный пирог от самых редко меняющихся данных к самым часто меняющимся.

- **Системный промпт (Слой 1):** Базовые инструкции агента, правила поведения и гайдлайны по написанию кода. Это самый стабильный блок, который кэшируется один раз на всю сессию.
- **Спецификации инструментов / Tool Definitions (Слой 2):** Описание доступных функций (чтение файлов, выполнение команд). Схемы инструментов остаются неизменными на протяжении работы агента.
- **Долгосрочная память / Архитектура проекта (Слой 3):** Структура директорий (`tree`), содержание файлов `.cursorrules` или `instructions.md`. Эти данные меняются редко (только при создании/удалении файлов).
- **Контекст задачи и история сообщений (Слой 4):** Текущие открытые файлы, история диалога пользователя и ответов LLM. Кэшируется инкрементально с помощью специальных контрольных точек.
- **Последнее сообщение пользователя / Вывод терминала (Слой 5):** Самый динамичный блок. Всегда помещается в самый конец промпта, чтобы его изменение не инвалидировало кэш предыдущих слоев.

### 2. Детерминированная сборка контекста и сортировка

Для попадания в кэш структура промпта при каждом запросе должна посимвольно совпадать с предыдущим. Агенты используют жесткую сериализацию:

- **Детерминированный порядок инструментов:** Массив `tools` в API-запросе сортируется строго по алфавиту имен функций (например, `[view_file, write_file]`). Если при одном запросе порядок изменится, кэш для схем инструментов и всего последующего контекста сбросится.
- **Сортировка контекстных файлов:** При передаче нескольких файлов в контекст (например, через `@` упоминания) они сортируются по относительному пути (`src/auth.ts`, затем `src/server.ts`), а не по времени их добавления пользователем.
- **Стабильное форматирование XML/Markdown:** Использование строгих шаблонизаторов, исключающих появление лишних пробелов, случайных переносов строк или динамических отступов.

### 3. Оптимизация схемы инструментов (Lazy Tool Loading)

Передача десятков сложных схем инструментов (JSON Schema) в каждом запросе «съедает» полезный объем кэша и увеличивает накладные расходы.

- **Ленивая загрузка (Lazy Loading):** Агент не передает тяжелые инструменты (например, специфичные для работы с БД или рефакторинга), пока пользователь не перейдет в соответствующий режим или проект не потребует этого.
- **Минификация JSON:** Описания параметров инструментов очищаются от лишних пробелов и переносов строк перед отправкой в API.

### 4. Управление точками кэширования (Anthropic `cache_control`)

При работе с моделями Anthropic Claude (где кэширование управляется вручную через breakpoints) агенты используют стратегию **скользящего кэширования (sliding window caching)**:

- **Фиксация базы:** Первый маркер `{"type": "ephemeral"}` всегда ставится в конце системного промпта и определений инструментов. Это гарантирует 100% попадание для базовой «личности» агента.
- **Инкрементальные блоки истории:** Второй и третий маркеры устанавливаются на прошлые сообщения в истории диалога. Обычно маркер ставится на сообщение, отстоящее на 2–4 шага назад от текущего.
- **Эффект:** По мере роста диалога старая история остается в кэше, а новые сообщения дописываются в конец. Как только накопленный хвост превышает определенный лимит токенов, маркер смещается вперед, фиксируя новый крупный блок истории.

### 5. Очистка от «шума» и динамического мусора

Любые динамические данные, не несущие критической пользы для генерации кода, должны безжалостно удаляться из контекста:

- **Абсолютные пути:** Вместо `/Users/username/projects/my-app/src/main.ts` агенты всегда используют относительные пути `src/main.ts`. Это позволяет сохранять кэш даже при смене рабочей директории или запуске агента в Docker-контейнере / на удаленном сервере.
- **Исключение таймстампов и ID:** В системные промпты **запрещено** включать текущее время (`Current Time: 2026-08-22...`) или уникальные ID сессий/запросов, если это не требуется по условию задачи. Изменение времени каждую минуту гарантированно уничтожит весь кэш.
- **Сжатие вывода терминала (Terminal Output Slashing):** Результаты выполнения команд (например, `npm install` или логи тестов) перед отправкой в LLM очищаются от ANSI-последовательностей (цветов), прогресс-баров (которые спамят строками) и обрезаются до последних 50–100 строк.

### Summary: Чек-лист для разработчика AI-агентов

| Техника | Что делать | Зачем |
|---|---|---|
| **Порядок слоев** | `System Prompt` -> `Tools` -> `Project Rules` -> `History` -> `User Input` | Изменение в конце не ломает кэш начала. |
| **Сортировка** | Сортировать `tools` по алфавиту, файлы — по путям. | Гарантирует посимвольное совпадение строк. |
| **Относительность** | Заменять `/home/user/app/...` на `./...` | Кэш работает независимо от окружения. |
| **Фильтрация** | Удалять метки времени, ID запросов, прогресс-бары CLI. | Устраняет микро-изменения, сбивающие кэш. |

(AI Mode synthesized answer; no explicit source list returned for this turn.)

---

## Query 2 (c2): llama.cpp llama-server prompt caching mechanics + settings

conversation_id: c2
conversation_url: https://www.google.com/search?udm=50&q=llama.cpp+llama-server+prompt+caching+explained%3A+how+does+the+KV+cache+and+prefix+matching+work+with+slots+%28--parallel%2C+cache_prompt+flag%2C+slot+prompt+difference%29%2C+why+does+an+OpenAI-compatible+client+break+the+prompt+cache+%28changing+first+tokens%2C+system+prompt+drift%2C+n_predict%2C+context+shift%29%2C+and+what+server+parameters+and+request+options+are+recommended+in+2025-2026+to+maximize+prefix+cache+reuse+for+chat+agents%3F&atvm=2&mstk=AUtExfC_oMLsCC6Axb1ewzUmq4E_DQE3I8T9gtME2xrATCa95d33_ef_bQuwl0A8AWy4BzwTEFh9nnx3jmZnEfnwLeEviHGsH4x1OZ6GLEtVfBVxiQ_h7cBkk5c9YMvKl1YA58vTJjH2W_suf4GZkdHrfxxCd9TNuiZ6CnU1ACudp0qawmitkpvjtG8yUVdD4t_vXE49eOfPwyv5ASZkt9OJDNQDXcnoYXdsuh0Gg_NkHZORgYGq_-CwiJln1Kfse5VQ&csuir=1&mtid=kLyJasiwCo61wPAPhNaM8A4

Note: this conversation later received 2 follow-up turns (turns 2-3, about --cache-reuse/--keep/JSON fields/--parallel) whose delivery timed out client-side; they exist in the Google conversation, open the URL to read them. Their content gap was filled authoritatively from the official README (see last section).

В `llama.cpp` (через `llama-server`) **промпт-кеширование (Prompt Caching)** основано на повторном использовании уже вычисленных ключей и значений (Key-Value Cache или **KV-кеш**) для идентичных начальных последовательностей токенов (префиксов).

### 1. Как устроены KV-кеш и Prefix Matching со слотами

Когда модель обрабатывает текст, для каждого токена вычисляются матрицы **Key (K)** и **Value (V)**. Процесс их вычисления (prefill) требует много ресурсов CPU/GPU. `llama-server` сохраняет эти матрицы в памяти. При поступлении нового запроса сервер сравнивает его токены с токенами, которые уже лежат в кеше, строго **слева направо**. Если первые N токенов нового запроса абсолютно идентичны токенам в кеше, сервер выполняет **Prefix Matching**: он пропускает этап prefill для этих N токенов и сразу считывает их KV-тензоры из памяти.

Работа со слотами (`--parallel`): Флаг `--parallel N` разделяет общий KV-кеш сервера на `N` независимых логических областей — **слотов**. Каждый слот обслуживает отдельного пользователя или параллельный диалог.

- **Локальный кеш слота:** Каждый слот хранит историю своей текущей сессии.
- **Системный/Общий кеш (Smart Prompt Caching):** `llama-server` умеет просматривать KV-кеш _всех_ слотов. Если пользователь в Слот №2 отправляет системный промпт, который уже обрабатывался в Слот №1, Слот №2 может скопировать или переиспользовать эти данные (если включена общая память), не перевычисляя их. [Digest note: per official README, the mechanism is slot selection by prompt similarity `--slot-prompt-similarity`, default 0.10 — see final section.]

Флаг `--cache-prompt`: указывает серверу **сохранять KV-кеш префикса** после того, как запрос был полностью обработан. Без этого флага (в старых версиях) сервер мог очищать кеш префикса сразу после генерации ответа.

Разница между Slot Prompt и системным префиксом: статическая часть промпта кешируется и переиспользуется между слотами; уникальный текст конкретного пользователя кешируется _только внутри этого слота_.

### 2. Почему OpenAI-совместимые клиенты ломают промпт-кеш

- **Изменение первых токенов (Динамический System Prompt):** Промпт-кеш работает только при **100% совпадении с самого начала**. Если клиент вставляет в начало системного промпта динамические данные (например, `Текущая дата: 2026-08-22`), префикс меняется — кеш ломается полностью, prefill запускается заново.
- **Дрейф системного промпта (System Prompt Drift):** Некоторые клиенты при добавлении новых реплик пересобирают весь массив `messages`, меняя форматирование ролей или пробелы. Любое несовпадение даже в один пробел инвалидирует кеш.
- **Context Shift (Сдвиг контекста):** Когда история чата превышает размер контекста слота, OpenAI-клиенты часто усекают историю на стороне клиента (вырезают старые сообщения из середины/начала массива). Для `llama-server` такой промпт выглядит как новый текст — вся KV-очистка и prefill с нуля.
- **Влияние `n_predict` (или `max_tokens`):** сам по себе не ломает префикс-кеш, но динамическое изменение от запроса к запросу может влиять на аллокацию памяти слота.

### 3. Рекомендуемые параметры сервера и опции запросов

```bash
llama-server \
  -m models/llama-3-8b-instruct.Q4_K_M.gguf \
  -c 8192 \
  --parallel 4 \
  --cache-prompt \
  --ctx-shift
```

- `-c <size>`: должен вмещать системный промпт x количество слотов + буфер на генерацию.
- `--parallel <N>`: выделяет N слотов; оптимально равное числу одновременных сессий.
- `--cache-prompt`: удерживает совпавшие префиксы в памяти.
- `--ctx-shift`: включает сдвиг контекста на стороне сервера — сервер удаляет первую половину _истории_ (после системного промпта), сохраняя системный промпт нетронутым, предотвращая полный пересчет prefill.

Рекомендации по отправке запросов:

1. **Строгая заморозка начала строки:** даты, ID, переменные окружения и результаты RAG — только в конец системного промпта или отдельным сообщением пользователя, не в начало.
2. **Форматирование без изменений:** либо контролировать сборку шаблона самому (сырой `prompt` с ручными токенами), либо не менять структуру сообщений между шагами.
3. При `/v1/chat/completions` — не менять структуру системного сообщения между шагами диалога.
4. **`slot_id`:** в запросах к `/completion` можно явно передавать `"slot_id": X`, привязывая пользователя к конкретному слоту. [Digest note: see README verification — current documented knob is `--slot-prompt-similarity`; check your llama.cpp version for `id_slot` request field support.]

(AI Mode synthesized answer; no explicit source list returned for this turn.)

---

## Query 3 (c3): What opencode / Claude Code / Cline / Cursor / ZCode actually do

conversation_id: c3
share_url: https://share.google/aimode/KBvKr06XtZvExIxnx
conversation_url: https://www.google.com/search?udm=50&q=What+do+opencode%2C+Claude+Code%2C+Cline%2C+Cursor+and+ZCode+actually+do+for+prompt+caching+and+token+efficiency%2C+with+concrete+public+evidence+%28GitHub+issues%2C+changelogs%2C+docs%29%3F+E.g.+opencode+lazy+tool+definitions+%2F+tool+schema+optimization%2C+Cline+OpenAI+prompt+caching+caching_atlas%2C+Claude+Code+system+prompt+caching+and+cache_control+breakpoints%2C+Cursor+prompt+cache+hit+rate.+Cite+specific+repos%2Fdocs%2Fissues+where+possible.&atvm=2&mstk=AUtExfC9FJu-JQkFUaQ1riMxa9JNRO9h59oKjDvIH7ep7wLFVeREqsWoTAeKWdJNA_U7P_kZxeIR1yKYf48tdTC4HePL-am6mRP50g0Aiohq8hPTZ8hKzeQePnQ71q6b62FpfCE_ecQMQEXD0VlTzyaP52n4HXJJe-B7f1vU_K-0s3DYQ7Ag-jMxFDLXqSXpZXdL0y2_9VKFsKbbNhGAEcfQoBqXwJHxP0r5D9lNytASOucAEKyKvTegmpOkZsuAUJwR6Kp98xQ&csuir=1&mtid=sLyJarT0CPnkwPAP2uOZgQk

### 1. Claude Code

Anthropic's **Claude Code** leverages a deterministic, prefix-aligned architecture explicitly designed to maximize the Anthropic Messages API's **`cache_control`** breakpoints. [1][2][3]

- **Prefix-Matching Sequence Alignment**: prefix must be byte-for-byte identical. Claude Code separates static from dynamic data: (1) Global System Prompt & Base Tool Definitions (`cache_control: {"type": "ephemeral"}`), (2) Project Context File (`CLAUDE.md`), (3) Session History / Conversation Messages. [1][2][3]
- **Compacting and Recap Truncation**: `/compact` prunes and summarizes old message logs. Commands like `/recap` bypass structural rewriting by appending their summary strictly as command output at the very end of the message stack — status checks without invalidating the cached history prefix. [1][2][3]
- **Evidence / Docs**: official docs cover how plugins affect this: MCP servers force a full cache re-read unless Claude Code defers loading tool definitions (warning + `--force` override). Performance maps to `cache_creation_input_tokens` and `cache_read_input_tokens`. [1][2][3]

### 2. OpenCode

**OpenCode** is a multi-provider, open-source coding agent with a highly compressed static harness. [1][2][3]

- **Lazy Tool Definitions & MCP Optimization**: public token audits (Systima / Kunal Ganglani) measure ~6,900 baseline tokens per request vs Claude Code's ~32,800. Achieved via **MCP schema optimization** and **lazy tool definitions**: full definitions fetched only when the model intends to invoke that domain. [1][2][3]
- **Harness Immutability**: byte-identical request prefix across tool loops; avoids injecting fluid parameters (dynamic workspace file trees, timestamps) mid-prefix; writes to cache exactly once per session, then low-cost reads. [1][2][3]
- **Evidence / GitHub**: opencode **Issue #5416** (_Anthropic and others caching improvement_) — per-agent overrides, custom TTL controls, structured cache profiles across multi-model backends. [1][2][3]

### 3. Cline

**Cline** (formerly Claude Dev): local architecture translated into structured API payloads with provider-level caching. [1][2][3]

- **Caching Atlas Architecture**: dynamic snapshot map of the codebase; project diagnostics, environment paths and global config ordered _prior to_ any volatile tool execution blocks. [1][2][3]
- **API Token Sanitization**: Cline natively relies on `sanitizeAnthropicMessages` to strip/inject `cache_control` into the outbound payload. When using Claude Code CLI as a provider backend, messages go via stdin and the CLI rebuilds the raw HTTP body, so Cline must mark `supportsPromptCache: false` for that provider to prevent payload fragmentation — **[GitHub Discussion #9892](https://github.com/cline/cline/discussions/9892)**. [1][2][3]

### 4. Cursor

- **Short-Term Context & Action Caching**: granular editor behaviors (input deletion, undo/redo, cursor jumping) served from a local KV scheduling ring without external API hits. [1][2][3]
- **Composer 2 Cache Hit Rates**: long-horizon agent tasks pipe massive file trees + editor buffers; high volume of `cache read` tokens lets long-session cost scale efficiently. [1][2][3]
- **Evidence / Forum Logs**: during the _Composer 2 Cache Outage (March-April 2026)_, users saw 10x credit burn; team responses revealed manual model selections use specialized caching layers while the "Auto Mode" router can drop to 0.0% cache hit rate on models lacking native prefix caching. [1][2][3]

### 5. ZCode

**ZCode** (by Z.ai) — positioning centered on aggressive token overhead reduction. [1][2][3] [Digest caveat: weakly sourced — Reddit/marketing only, no engineering docs found; treat as unverified.]

- **90% Cache Hit Target**: repository context structured into isolated semantic shards; prioritizes a 90% prompt cache hit rate. [1][2][3]
- **90/10 Input-to-Output Split**: system prompts, dependency trees, historical diagnostics as immutable prefix components; code modifications as append-only deltas instead of mutating line numbers/paths in the system message (which breaks radix-tree/linear prompt caches). [1][2][3]

### Comparison

| Tool | Primary technique | Typical fixed overhead | Public evidence |
|---|---|---|---|
| **Claude Code** | Prefix-ordered `cache_control` breakpoints, `/compact` restructuring | High (~32.8K tokens) | code.claude.com caching docs |
| **OpenCode** | Lazy tool defs, MCP schema optimization, static prefix mapping | Low (~6.9K tokens) | GitHub Issue #5416 |
| **Cline** | Codebase atlas mapping, `sanitizeAnthropicMessages` layout | Variable | GitHub Discussion #9892 |
| **Cursor** | Local KV cache for granular edits; Composer 2 cache reads | High | Cursor forum cache-outage threads |
| **ZCode** | Append-only deltas, semantic codebase sharding | Compressed | launch benchmarks (unverified) |

Sources:
[1] How Claude Code uses prompt caching — https://code.claude.com/docs/en/prompt-caching
[2] Claude Code Sends 4.7x More Tokens Than OpenCode — https://systima.ai/blog/claude-code-vs-opencode-token-overhead
[3] Automatic prompt caching for Claude Code — https://github.com/flightlesstux/prompt-caching

---

## Query 4 (c4): Measuring cache hit rate from usage fields (OpenAI / Anthropic / llama.cpp)

conversation_id: c4
share_url: https://share.google/aimode/HHmYF0ErT6yTQiRV1
conversation_url: https://www.google.com/search?udm=50&q=How+to+measure+LLM+prompt+cache+hit+rate+from+API+response+usage+fields+in+2026%3A+OpenAI+prompt_tokens_details.cached_tokens%2C+Anthropic+usage+cache_creation_input_tokens+and+cache_read_input_tokens%2C+and+llama.cpp+llama-server+OpenAI-compatible+response+fields+showing+cached+prompt+tokens+%28timings_prompt%2C+prompt+tokens+processed+vs+cached%2C+usage.prompt_tokens_details.cached_tokens+support%29.+Which+field+names+exactly%2C+per+API%3F&atvm=2&mstk=AUtExfDlY4nEEd2IE2hSf1eM00dL7DBUndgQoIYcdb8Ccfn3Af8088oGC9D67ZLXKhCmYdqZe5QQ1g_KSbL5rPGG8en_FWKlXSFVEsim1KWoPIKE_s-_lczCNxD6jXYDNRc7pQM-pJs8DJd34oIdPZz2HxpIoazPVUggZeGokE3MDJ9OFHzQSSBAWngcYfYhOLv0eaaQp-cgfaUp5jIp6GCT2vQHsdGRq4AwhFcuQ_FND_MDsA2iTAnlr2Gbn92S4q1VngbniCslD_20DA&csuir=1&mtid=1LyJatvxO6HzwPAPhNaM8A4

### 1. OpenAI (автоматическое кэширование)

OpenAI включает кэшированные токены в общий объем `prompt_tokens`.

- `usage.prompt_tokens` — общее число токенов промпта.
- `usage.prompt_tokens_details.cached_tokens` — сколько токенов взято из кэша.

Hit Rate = `cached_tokens / prompt_tokens`.

### 2. Anthropic Claude (управляемое кэширование)

Поля не пересекаются:

- `usage.input_tokens` — только «базовые» некэшированные входящие токены.
- `usage.cache_read_input_tokens` — токены, прочитанные из кэша (Hit).
- `usage.cache_creation_input_tokens` — токены, впервые обработанные и записанные в кэш (Miss с созданием).

Hit Rate = `cache_read_input_tokens / (input_tokens + cache_read_input_tokens + cache_creation_input_tokens)`.

### 3. llama.cpp / llama-server (OpenAI-compatible)

Вариант А — нативный объект `timings` (рекомендуемый для локального анализа):

- `timings.prompt_n` — количество фактически обработанных (вычисленных заново) токенов промпта.
- `timings.cache_n` — количество токенов промпта, повторно использованных из KV-кэша.

Hit Rate = `cache_n / (prompt_n + cache_n)`.

Вариант Б — OpenAI-совместимый `usage`:

- `usage.prompt_tokens` — полный размер промпта (`prompt_n + cache_n`).
- `usage.prompt_tokens_details.cached_tokens` — дублирует `timings.cache_n`.

(Примечание: некоторые сторонние провайдеры и старые обертки отдают кэш в нестандартном поле `usage.prompt_cache_hit_tokens`; официальный llama.cpp использует вложенный `prompt_tokens_details.cached_tokens`.)

Sources:
[1] https://www.braintrust.dev/articles/how-to-track-llm-token-usage-2026
[2] https://devtoollab.com/blog/prompt-caching-guide
[3] https://developers.openai.com/cookbook/examples/prompt_caching101

---

## Verification: official llama.cpp server README (fetched 2026-08-22 from https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md)

This section replaces the c2 follow-up turns that timed out client-side; it is the authoritative source for exact names/defaults.

1. **`cache_prompt`**: CLI `--cache-prompt, --no-cache-prompt` — "whether to enable prompt caching (default: enabled)" (env `LLAMA_ARG_CACHE_PROMPT`). `/completion` request option `cache_prompt` default `true` — "Re-use KV cache from a previous request if possible ... the common prefix does not have to be re-processed, only the suffix that differs". Caveat: "can cause nondeterministic results" on some backends. `/v1/chat/completions` doesn't list it explicitly, but caching behavior is visible via `timings.cache_n`.
2. **`--cache-reuse N` / request `n_cache_reuse`**: "min chunk size to attempt reusing from the cache via KV shifting, requires prompt caching to be enabled (default: 0)" — i.e. allows reusing non-contiguous cached chunks.
3. **`--keep N` / request `n_keep`**: "number of tokens to keep from the initial prompt (default: 0, -1 = all)" — tokens kept when context is exceeded and tokens must be discarded (protects the system prompt during context shift).
4. **`--slots` / `GET /slots`**: enabled by default (`--no-slots` to disable); per-slot metrics (speed, processed tokens, sampling params, `next_token` state). `?fail_on_no_slot=1` returns 503 when no slot is free.
5. **Cached-token response fields**: `/completion` returns `tokens_cached` ("Number of tokens from the prompt which could be re-used from previous completion") + `tokens_evaluated` + `timings`. `/v1/chat/completions` returns `timings` with `"cache_n": 236, // number of prompt tokens reused from cache` plus `prompt_n`, `predicted_n` (context usage = `prompt_n + cache_n + predicted_n`). And yes: `usage.prompt_tokens_details.cached_tokens` is returned (README example shows `"prompt_tokens_details": {"cached_tokens": 0}`).
6. **`--parallel` and slot selection**: `-np, --parallel N` — "number of server slots (default: -1, -1 = auto)". Slot routing uses `-sps, --slot-prompt-similarity SIMILARITY` — "how much the prompt of a request must match the prompt of a slot in order to use that slot" (default `0.10`, `0.0` = disabled). (The README does not describe a shared cross-slot cache; each slot holds its own KV.)

---

Research method note: google-ai-search "search loop" mode; 4 delivered search_ai calls (c1-c4, sequential); 3 further calls in c2 timed out at the 30s client cap (2 duplicates + 1 recovery attempt) but completed server-side — c2 shows 3 turns; open its conversation_url to read them. llama.cpp specifics verified directly against the official README (section above).
