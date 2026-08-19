# Office Agents — офлайн-редакция на PowerShell

Форк [hewliyang/office-agents](https://github.com/hewliyang/office-agents), переделанный для
**локального запуска на компьютере без интернета**: без Node.js, без Python, без прав
администратора — нужен только встроенный Windows PowerShell.

Аддины Word/Excel/PowerPoint и их манифесты не изменялись. Заменена только инфраструктура
запуска: вместо Node-сервера статики (Vite) — чистый PowerShell HTTPS-сервер.

## Структура

```
powershell/
  offline/                     ЕДИНСТВЕННАЯ папка для офлайн-машины — копируйте её целиком
    QUICKSTART.md                краткая инструкция на русском (самодостаточная)
    install.ps1                  разовая настройка на целевой машине (без админа)
    start.ps1                    запуск сервера (+ опционально приложений Office)
    server.ps1 / server-lib.ps1  HTTPS-сервер статики + LLM-прокси
    uninstall.ps1                полное удаление следов установки
    server-config.json.example   шаблон конфига LLM-прокси
    site/                        собранные аддины: excel (3000), powerpoint (3001), word (3002)
    office-js/                   локальная копия Office.js (замена CDN)
    manifests/                   манифесты аддинов (localhost:3000-3002, как в оригинале)
  build-package.ps1            пересборка offline/ (запускать только на машине с интернетом и Node.js)
  tests/                       dev-инструменты (mock LLM-сервер)
```

Что заменило каждую интернет/Node-зависимость:

| Оригинал                         | Здесь                                              |
|----------------------------------|----------------------------------------------------|
| Vite dev-server (Node.js, HTTPS) | `server.ps1`: TcpListener + SslStream, PowerShell 5.1 |
| CDN Office.js                    | локальная копия `office-js/`, URL переписан в HTML  |
| `office-addin-dev-certs`         | самоподписанный сертификат в CurrentUser (без админа) |
| sideload через Node-утилиты      | Trusted Add-in Catalog в HKCU (без админа)         |
| облаевые LLM API                 | любой OpenAI-совместимый сервер + встроенный прокси |

Сервер слушает только 127.0.0.1 и не требует регистрации URL (не использует http.sys),
поэтому прав администратора не нужно.

## Развёртывание на офлайн-машине

Всё нужное — в одной папке `powershell/offline/`:

1. Скопируйте её с флешки целиком.
2. В PowerShell перейдите в эту папку и выполните:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

   Скрипт: создаст самоподписанный сертификат `localhost` (хранилище текущего
   пользователя), сделает его доверенным (при необходимости Windows покажет диалог
   подтверждения — нажмите «Да»), зарегистрирует папку `manifests` как доверенный
   каталог аддинов (HKCU). Ничего системного не меняется, удаление — `uninstall.ps1`.

3. Запуск сервера:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start.ps1            # только сервер
   powershell -ExecutionPolicy Bypass -File .\start.ps1 -Launch excel
   ```

4. В Word/Excel/PowerPoint: **Вставка → Получить надстройки → Общая папка (SHARED
   FOLDER)** → выберите OpenExcel / OpenPPT / OpenWord → **Добавить**. Панель чата
   откроется сбоку. Добавление выполняется один раз для каждого приложения.

## Подключение LLM

Аддинам нужен OpenAI-совместимый API. На машине без интернета это значит сервер в
локальной сети (другой компьютер с Ollama / LM Studio / llama.cpp / vLLM) или
полностью локальный сервер.

Проблема: таскпан работает по HTTPS, а локальные LLM-серверы обычно по HTTP — браузер
блокирует такой запрос (mixed content), плюс бывает CORS. В настройках аддина
(Settings → Custom Endpoint → LLM Connection) два режима:

- **Direct HTTPS** — адрес `https://`-сервера вписывается прямо в Base URL;
  требуется доверенный сертификат и CORS (в настройках есть раскрывающиеся заметки
  по включению CORS для vLLM / llama.cpp / Ollama).
- **Local Proxy** — аддин использует `https://localhost:300X/llm-proxy/v1`, а
  офлайн-сервер перенаправляет на бэкенд. Адрес бэкенда можно задать прямо из
  настроек аддина (поле «LLM backend address» → Save): сервер применяет его
  на лету и сохраняет в `server-config.json` (API `POST /oa-config/llm-target`,
  принимает только same-origin запросы). Вне аддина — параметром
  `.\start.ps1 -LlmProxyTarget http://...` или правкой `server-config.json`.

Затем в настройках аддина (Settings → кастомный OpenAI-совместимый эндпоинт) укажите:

   - Excel: `https://localhost:3000/llm-proxy/v1`
   - PowerPoint: `https://localhost:3001/llm-proxy/v1`
   - Word: `https://localhost:3002/llm-proxy/v1`

   Модель — та, что развёрнута на сервере (например `qwen2.5:7b-instruct`); API-ключ
   обычно не нужен (прокси передаёт Authorization, если укажете).

Прокси проксирует `/llm-proxy/*` на целевой сервер как есть, включая потоковые
SSE-ответы (`stream: true`) — токены появляются в чате по мере генерации.

Замечания по серверам: у Ollama разрешите источники (переменная `OLLAMA_ORIGINS=*`)
или используйте прокси (через прокси CORS не важен — запрос same-origin).
LM Studio и llama.cpp-server работают через прокси без доп. настроек.

## Контекст и сжатие (доработка форка)

В настройки аддинов добавлены:

- **Context Limit (tokens)** — лимит контекста; `0` = брать из каталога модели.
  Для локальных моделей указывайте реальное значение — для кастомных эндпоинтов
  каталог не известен и подставляется 128k.
- **Auto-compact Context** — при достижении ~80% лимита старые сообщения автоматически
  заменяются сводкой, сгенерированной той же моделью; последние сообщения остаются
  без изменений, разрыв пар «вызов инструмента → результат» не допускается.
- Команда **`/compact`** в поле ввода чата сжимает контекст вручную.

Промпт сжатия перенесён по открытому паттерну Claude Code (conversation
summarization): этап анализа в `<analysis>`, затем структурированная `<summary>`
из 9 секций — Primary Request and Intent, Key Technical Concepts, Document State,
Errors and fixes, Problem Solving, All user messages (значимые инструкции —
дословно), Pending Tasks, Current Work, Optional Next Step (с дословной цитатой,
где остановились). Источники паттерна: [репозиторий системных промптов Claude
Code](https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/agent-prompt-conversation-summarization.md),
[официальная документация Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction).

Реализация: `packages/sdk/src/runtime.ts` (`compactContext`, `estimateContextTokens`,
авто-триггер в `sendMessage`), поля в `provider-config.ts`, команда в
`packages/core/src/chat/chat-input.svelte`, UI в `settings-panel.svelte`.

## Проверка установки

- `https://localhost:3000/taskpane.html` — должен открыться без предупреждений о
  сертификате (в браузере Edge/Chrome на той же машине).
- В консоли сервера видны все запросы (`[время] GET /... [200]`).
- Ожидаемая офлайн-шумность: запрос к `telemetryservice.firstpartyapps.oaspapps.com`
  не резолвится — это телеметрия самого Office.js, ни на что не влияет.

## Требования

- Windows 10/11 с Windows PowerShell 5.1 (`powershell.exe`, входит в систему).
- Office 2021+/Microsoft 365 (аддины используют WebView2; старый Trident не поддерживается
  — оригинальный код аддинов сам проверяет и сообщает об этом).
- Права администратора НЕ требуются: сертификат и каталог регистрируются в HKCU.

## Пересборка (на машине с интернетом)

Папка `offline/site/` уже содержит собранные аддины. Чтобы пересобрать после изменений в
репозитории (нужны Node.js и pnpm):

```powershell
powershell -ExecutionPolicy Bypass -File .\build-package.ps1
```

Скрипт: `pnpm install` + `pnpm build`, обновляет скрипты в `offline/`, копирует
`packages/*/dist` в `offline/site/`, вендорит Office.js из npm-пакета
`@microsoft/office-js`, переписывает CDN-ссылку в HTML на `/office-js/office.js`,
копирует манифесты.

## Отсутствующее в офлайн-редакции

Функциональность самих аддинов сохранена полностью, но не работает по объективным
причинам: веб-поиск/веб-фичи (нет интернета), OAuth-провайдеры и облаевые LLM
(нужна сеть). Используйте кастомный эндпоинт через прокси.

## Тесты

- `tests/mock-llm.js` — мок OpenAI-совместимого сервера (нужен Node.js, только для
  разработки): `node tests\mock-llm.js`, затем запустите
  `offline\server.ps1 -LlmProxyTarget http://127.0.0.1:8899` и проверьте
  `https://localhost:3000/llm-proxy/v1/models`.
