# Office Agents — офлайн-редакция на PowerShell

Форк [hewliyang/office-agents](https://github.com/hewliyang/office-agents), переделанный для
**локального запуска на компьютере без интернета**: без Node.js, без Python, без прав
администратора — нужен только встроенный Windows PowerShell.

Аддины Word/Excel/PowerPoint и их манифесты не изменялись. Заменена только инфраструктура
запуска: вместо Node-сервера статики (Vite) — чистый PowerShell HTTPS-сервер.

## Как это устроено

```
powershell/
  install.ps1        разовая настройка на целевой машине (без админа)
  start.ps1          запуск сервера (+ опционально приложений Office)
  server.ps1         HTTPS-сервер статики + LLM-прокси
  server-lib.ps1     библиотека HTTP-функций
  uninstall.ps1      полное удаление следов установки
  build-package.ps1  пересборка пакета (запускать только на машине с интернетом и Node.js)
  site/              собранные аддины: excel (порт 3000), powerpoint (3001), word (3002)
  office-js/         локальная копия Office.js (замена CDN appsforoffice.microsoft.com)
  manifests/         манифесты аддинов (как в оригинале, указывают на localhost:3000-3002)
  server-config.json.example  шаблон конфига LLM-прокси
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

1. Скопируйте папку `powershell/` целиком (с `site/`, `office-js/`, `manifests/`) с флешки.
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
блокирует такой запрос (mixed content), плюс бывает CORS. Решение — встроенный в
`server.ps1` одноимённый (same-origin) прокси:

1. Скопируйте `server-config.json.example` в `server-config.json` и укажите адрес
   вашего LLM-сервера, например `http://192.168.1.50:11434` (Ollama).
2. Перезапустите `start.ps1`.
3. В настройках аддина (Settings → кастомный OpenAI-совместимый эндпоинт) укажите:

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

Папка `site/` уже содержит собранные аддины. Чтобы пересобрать после изменений в
репозитории (нужны Node.js и pnpm):

```powershell
powershell -ExecutionPolicy Bypass -File .\build-package.ps1
```

Скрипт: `pnpm install` + `pnpm build`, копирует `packages/*/dist` в `site/`, вендорит
Office.js из npm-пакета `@microsoft/office-js`, переписывает CDN-ссылку в HTML на
`/office-js/office.js`, копирует манифесты.

## Отсутствующее в офлайн-редакции

Функциональность самих аддинов сохранена полностью, но не работает по объективным
причинам: веб-поиск/веб-фичи (нет интернета), OAuth-провайдеры и облаевые LLM
(нужна сеть). Используйте кастомный эндпоинт через прокси.

## Тесты

- `tests/mock-llm.js` — мок OpenAI-совместимого сервера (нужен Node.js, только для
  разработки): `node tests\mock-llm.js`, затем запустите
  `server.ps1 -LlmProxyTarget http://127.0.0.1:8899` и проверьте
  `https://localhost:3000/llm-proxy/v1/models`.
