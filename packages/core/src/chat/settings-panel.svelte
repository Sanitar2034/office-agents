<script lang="ts">
  import {
    API_TYPES,
    buildAuthorizationUrl,
    exchangeOAuthCode,
    generatePKCE,
    listFetchProviders,
    listImageSearchProviders,
    listSearchProviders,
    loadOAuthCredentials,
    loadSavedConfig,
    loadWebConfig,
    OAUTH_PROVIDERS,
    removeOAuthCredentials,
    saveConfig,
    saveOAuthCredentials,
    saveWebConfig,
    THINKING_LEVELS,
    type OAuthFlowState,
    type ThinkingLevel,
  } from "@office-agents/sdk";
  import {
    Check,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    Eye,
    EyeOff,
    FlaskConical,
    FolderUp,
    LogOut,
    Plus,
    Sparkles,
    Trash2,
  } from "lucide-svelte";
  import { getChatContext } from "./chat-runtime-context";

  const chat = getChatContext();
  const runtimeState = chat.state;
  const adapter = chat.adapter;
  const ns = chat.context.namespace;

  let folderInputRef = $state<HTMLInputElement | null>(null);
  let fileInputRef = $state<HTMLInputElement | null>(null);
  let installing = $state(false);
  let generatingSkill = $state(false);

  async function generateSkill(): Promise<void> {
    generatingSkill = true;
    try {
      // Read the skill-creator meta-skill for instructions
      const res = await fetch(`${location.origin}/skills/skill-creator/SKILL.md`);
      let metaSkill = '';
      if (res.ok) {
        metaSkill = await res.text();
      }
      // Switch to chat tab and pre-fill the creation prompt
      // The AI will follow the skill-creator instructions
      const prompt = metaSkill
        ? `I want to create a new skill. Follow the skill-creator instructions below to help me design, generate, and test a SKILL.md. Ask me what the skill should do.`
        : `Help me create a new skill (SKILL.md file). Ask me: 1) What task should this skill automate? 2) What steps are involved? 3) What are example trigger phrases? Then generate a properly formatted SKILL.md with frontmatter (name, description with triggers), numbered steps, verification, and examples. Output it inside <skill-file>...</skill-file> tags so I can install it.`;
      // Close settings and send the prompt
      await chat.sendMessage(prompt);
    } finally {
      generatingSkill = false;
    }
  }

  async function testSkill(name: string): Promise<void> {
    const prompt = `Test the skill "${name}". Follow these steps:
1. Load the skill from /home/skills/${name}/SKILL.md
2. Create 3 test scenarios (happy path, edge case, negative case)
3. Evaluate trigger reliability for each
4. Simulate execution of the happy path
5. Report a Skill Test Report with pass/fail and recommendations`;
    await chat.sendMessage(prompt);
  }

  const saved = loadSavedConfig(ns);
  let provider = $state(saved?.provider || "");
  let apiKey = $state(saved?.apiKey || "");
  let model = $state(saved?.model || "");
  let showKey = $state(false);
  let useProxy = $state(saved?.useProxy !== false);
  let proxyUrl = $state(saved?.proxyUrl || "");
  let thinking = $state<ThinkingLevel>(saved?.thinking || "none");
  let apiType = $state(saved?.apiType || "openai-completions");
  let customBaseUrl = $state(saved?.customBaseUrl || "");
  let authMethod = $state<"apikey" | "oauth">(saved?.authMethod || "apikey");
  let contextLimit = $state<number>(saved?.contextLimit ?? 0);
  let autoCompact = $state(saved?.autoCompact !== false);
  let temperature = $state<string>(
    typeof saved?.temperature === "number" ? String(saved.temperature) : "",
  );
  let supportsImages = $state(saved?.supportsImages !== false);

  // model list loading for custom endpoints (incl. Open WebUI preset)
  let availableModels = $state<string[]>([]);
  let modelsBusy = $state(false);
  let modelsError = $state("");

  async function loadEndpointModels(): Promise<void> {
    const base = customBaseUrl.trim().replace(/\/+$/, "");
    if (!base) {
      modelsError = "Enter the Base URL first";
      return;
    }
    modelsBusy = true;
    modelsError = "";
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(`${base}/models`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        data?: { id?: string; name?: string }[];
        models?: { id?: string; name?: string }[];
      };
      const ids = (data.data ?? data.models ?? [])
        .map((m) => m.id || m.name || "")
        .filter(Boolean);
      if (ids.length === 0) throw new Error("no models in response");
      availableModels = ids;
    } catch (err) {
      modelsError = err instanceof Error ? err.message : "request failed";
      availableModels = [];
    } finally {
      modelsBusy = false;
    }
  }

  // LLM connection: direct https endpoint vs the offline PowerShell server's
  // same-origin /llm-proxy (backend address managed via /oa-config/llm-target).
  const initialConnectionMode: "direct" | "proxy" = (saved?.customBaseUrl || "").includes(
    "/llm-proxy",
  )
    ? "proxy"
    : "direct";
  let connectionMode = $state<"direct" | "proxy">(initialConnectionMode);
  let proxyBackend = $state("");
  let proxyBusy = $state(false);
  let proxyStatus = $state<"idle" | "checking" | "ok" | "saved" | "error">("idle");
  let proxyMessage = $state("");
  let showDirectHelp = $state(false);

  async function loadProxyBackend(): Promise<void> {
    proxyStatus = "checking";
    proxyMessage = "";
    try {
      const res = await fetch(`${location.origin}/oa-config/llm-target`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { llmProxyTarget?: string };
      proxyBackend = data.llmProxyTarget || "";
      proxyStatus = "ok";
    } catch (err) {
      proxyStatus = "error";
      proxyMessage = err instanceof Error ? err.message : "request failed";
    }
  }

  async function saveProxyBackend(): Promise<void> {
    const value = proxyBackend.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s]+$/i.test(value)) {
      proxyStatus = "error";
      proxyMessage = "Address must start with http:// or https://";
      return;
    }
    proxyBusy = true;
    try {
      const res = await fetch(`${location.origin}/oa-config/llm-target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llmProxyTarget: value }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      updateAndSync({ customBaseUrl: `${location.origin}/llm-proxy/v1` });
      proxyStatus = "saved";
      proxyMessage = "";
    } catch (err) {
      proxyStatus = "error";
      proxyMessage = err instanceof Error ? err.message : "request failed";
    } finally {
      proxyBusy = false;
    }
  }

  function setConnectionMode(mode: "direct" | "proxy"): void {
    connectionMode = mode;
    if (mode === "proxy") void loadProxyBackend();
  }

  if (initialConnectionMode === "proxy") void loadProxyBackend();

  const savedWeb = loadWebConfig(ns);
  let webToolsEnabled = $state(savedWeb.enabled !== false);

  // Desktop power tools (COM bridge) - Excel only, opt-in, off by default
  const initialIsExcel: boolean = adapter?.appName === "OpenExcel";
  let comEnabled = $state(false);
  let comBusy = $state(false);
  let comStatus = $state<{ excelRunning?: boolean; workbook?: string | null } | null>(null);
  let comReachable = $state(true);

  async function loadComStatus(): Promise<void> {
    try {
      const res = await fetch(`${location.origin}/oa-config/com-bridge`);
      const data = (await res.json()) as { enabled?: boolean };
      comEnabled = data.enabled === true;
      comReachable = true;
      if (comEnabled) {
        const st = await fetch(`${location.origin}/oa-com/status`, { method: "POST" });
        comStatus = (await st.json()) as typeof comStatus;
      } else {
        comStatus = null;
      }
    } catch {
      comReachable = false;
      comStatus = null;
    }
  }

  async function toggleCom(): Promise<void> {
    comBusy = true;
    try {
      const res = await fetch(`${location.origin}/oa-config/com-bridge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !comEnabled }),
      });
      if (res.ok) {
        comEnabled = !comEnabled;
        await loadComStatus();
      }
    } finally {
      comBusy = false;
    }
  }

  if (initialIsExcel) void loadComStatus();

  // Dev add-in registration (WEF\Developer): register / roll back to the
  // pre-install state via the offline server (same-origin endpoint)
  let devRegEnabled = $state<boolean | null>(null);
  let devRegCount = $state("");
  let devRegBusy = $state(false);
  let devRegReachable = $state(true);
  let devRegMessage = $state("");

  async function loadDevRegistration(): Promise<void> {
    try {
      const res = await fetch(`${location.origin}/oa-config/dev-registration`);
      const data = (await res.json()) as {
        enabled?: boolean;
        registered?: number;
        total?: number;
      };
      devRegEnabled = data.enabled === true;
      devRegCount =
        data.registered !== undefined && data.total !== undefined
          ? `${data.registered}/${data.total}`
          : "";
      devRegReachable = true;
    } catch {
      devRegReachable = false;
      devRegEnabled = null;
    }
  }

  async function setDevRegistration(enable: boolean): Promise<void> {
    devRegBusy = true;
    devRegMessage = "";
    try {
      const res = await fetch(`${location.origin}/oa-config/dev-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enable }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        enabled?: boolean;
        registered?: number;
        total?: number;
      };
      if (res.ok && data.ok) {
        devRegEnabled = data.enabled === true;
        devRegCount =
          data.registered !== undefined && data.total !== undefined
            ? `${data.registered}/${data.total}`
            : "";
        devRegMessage = enable
          ? "Registered — the add-ins will load with Office again."
          : "Removed — dev registration rolled back. Restart Office to apply.";
      } else {
        devRegMessage = "Server rejected the request.";
      }
    } catch {
      devRegMessage = "Server not reachable (start.ps1).";
    } finally {
      devRegBusy = false;
    }
  }

  void loadDevRegistration();
  let webSearchProvider = $state(savedWeb.searchProvider);
  let imageSearchProvider = $state(savedWeb.imageSearchProvider);
  let webFetchProvider = $state(savedWeb.fetchProvider);
  let braveApiKey = $state(savedWeb.apiKeys.brave || "");
  let serperApiKey = $state(savedWeb.apiKeys.serper || "");
  let exaApiKey = $state(savedWeb.apiKeys.exa || "");
  let showAdvancedWebKeys = $state(false);

  let oauthFlow = $state<OAuthFlowState>(
    saved?.authMethod === "oauth"
      ? loadOAuthCredentials(ns, saved.provider)
        ? { step: "connected" }
        : { step: "idle" }
      : { step: "idle" },
  );
  let oauthCodeInput = $state("");

  const followMode = $derived($runtimeState.providerConfig?.followMode ?? true);
  const expandToolCalls = $derived(
    $runtimeState.providerConfig?.expandToolCalls ?? false,
  );
  const isCustom = $derived(provider === "custom" || provider === "openwebui");
  const models = $derived(
    provider && !isCustom ? chat.getModelsForProvider(provider) : [],
  );
  const hasOAuth = $derived(provider in OAUTH_PROVIDERS);
  const searchProviders = listSearchProviders();
  const imageSearchProviders = listImageSearchProviders();
  const fetchProviders = listFetchProviders();
  const needsBraveKey = $derived(webSearchProvider === "brave");
  const needsSerperKey = $derived(
    webSearchProvider === "serper" ||
      (adapter.hasImageSearch && imageSearchProvider === "serper"),
  );
  const needsExaKey = $derived(
    webSearchProvider === "exa" || webFetchProvider === "exa",
  );
  const isConfigured = $derived($runtimeState.providerConfig !== null);
  const showApiKeyInput = $derived(!(hasOAuth && authMethod === "oauth"));

  const inputStyle =
    "border-radius: var(--chat-radius); font-family: var(--chat-font-mono)";

  function updateAndSync(
    updates: Partial<{
      provider: string;
      apiKey: string;
      model: string;
      useProxy: boolean;
      proxyUrl: string;
      thinking: ThinkingLevel;
      apiType: string;
      customBaseUrl: string;
      authMethod: "apikey" | "oauth";
      contextLimit: number;
      autoCompact: boolean;
      temperature: number | string | undefined;
      supportsImages: boolean;
    }>,
  ) {
    const nextProvider = updates.provider ?? provider;
    const nextApiKey = updates.apiKey ?? apiKey;
    const nextModel = updates.model ?? model;
    const nextUseProxy = updates.useProxy ?? useProxy;
    const nextProxyUrl = updates.proxyUrl ?? proxyUrl;
    const nextThinking = updates.thinking ?? thinking;
    const nextApiType = updates.apiType ?? apiType;
    const nextCustomBaseUrl = updates.customBaseUrl ?? customBaseUrl;
    const nextAuthMethod = updates.authMethod ?? authMethod;
    const nextContextLimit = Number.isFinite(updates.contextLimit ?? contextLimit)
      ? Math.max(0, Math.floor(updates.contextLimit ?? contextLimit))
      : 0;
    const nextAutoCompact = updates.autoCompact ?? autoCompact;
    const nextSupportsImages = updates.supportsImages ?? supportsImages;
    const parsedTemperature = Number.parseFloat(
      String(updates.temperature ?? temperature).trim(),
    );
    const nextTemperature =
      Number.isFinite(parsedTemperature) &&
      parsedTemperature >= 0 &&
      parsedTemperature <= 2
        ? parsedTemperature
        : undefined;

    provider = nextProvider;
    apiKey = nextApiKey;
    model = nextModel;
    useProxy = nextUseProxy;
    proxyUrl = nextProxyUrl;
    thinking = nextThinking;
    apiType = nextApiType;
    customBaseUrl = nextCustomBaseUrl;
    authMethod = nextAuthMethod;
    contextLimit = nextContextLimit;
    autoCompact = nextAutoCompact;
    supportsImages = nextSupportsImages;
    if (updates.temperature !== undefined) {
      // keep the raw string while typing (empty or partially numeric);
      // the saved config stays undefined until the value fully parses
      const s = String(updates.temperature).trim();
      if (s === "" || Number.isFinite(Number.parseFloat(s))) {
        temperature = String(updates.temperature);
      }
    }

    const isValid =
      nextProvider === "custom" || nextProvider === "openwebui"
        ? Boolean(
            nextProvider &&
              nextApiType &&
              nextCustomBaseUrl &&
              nextModel &&
              nextApiKey,
          )
        : Boolean(nextProvider && nextApiKey && nextModel);

    if (!isValid) return;

    const config = {
      provider: nextProvider,
      apiKey: nextApiKey,
      model: nextModel,
      useProxy: nextUseProxy,
      proxyUrl: nextProxyUrl,
      thinking: nextThinking,
      followMode,
      expandToolCalls,
      contextLimit: nextContextLimit,
      autoCompact: nextAutoCompact,
      supportsImages: nextSupportsImages,
      ...(nextTemperature !== undefined ? { temperature: nextTemperature } : {}),
      apiType: nextApiType,
      customBaseUrl: nextCustomBaseUrl,
      authMethod: nextAuthMethod,
    };

    saveConfig(ns, config);
    chat.setProviderConfig(config);
  }

  function updateWebSettings(
    updates: Partial<{
      enabled: boolean;
      searchProvider: string;
      imageSearchProvider: string;
      fetchProvider: string;
      braveApiKey: string;
      serperApiKey: string;
      exaApiKey: string;
    }>,
  ) {
    webToolsEnabled = updates.enabled ?? webToolsEnabled;
    webSearchProvider = updates.searchProvider ?? webSearchProvider;
    imageSearchProvider =
      updates.imageSearchProvider ?? imageSearchProvider;
    webFetchProvider = updates.fetchProvider ?? webFetchProvider;
    braveApiKey = updates.braveApiKey ?? braveApiKey;
    serperApiKey = updates.serperApiKey ?? serperApiKey;
    exaApiKey = updates.exaApiKey ?? exaApiKey;

    saveWebConfig(ns, {
      enabled: webToolsEnabled,
      searchProvider: webSearchProvider,
      imageSearchProvider,
      fetchProvider: webFetchProvider,
      apiKeys: {
        brave: braveApiKey,
        serper: serperApiKey,
        exa: exaApiKey,
      },
    });
  }

  function handleProviderChange(newProvider: string) {
    if (newProvider === "openwebui") {
      // Open WebUI speaks exactly one protocol: OpenAI chat completions at <url>/api
      updateAndSync({
        provider: "openwebui",
        model: "",
        authMethod: "apikey",
        apiType: "openai-completions",
        customBaseUrl: "https://localhost:8443/api",
      });
      return;
    }
    if (newProvider === "custom") {
      updateAndSync({ provider: newProvider, model: "", authMethod: "apikey" });
    } else {
      const providerModels = newProvider
        ? chat.getModelsForProvider(newProvider)
        : [];
      const keepOAuth =
        newProvider in OAUTH_PROVIDERS ? authMethod : "apikey";
      updateAndSync({
        provider: newProvider,
        model: providerModels[0]?.id || "",
        authMethod: keepOAuth,
      });
    }

    if (!(newProvider in OAUTH_PROVIDERS)) {
      oauthFlow = { step: "idle" };
    }
  }

  function handleAuthMethodChange(newMethod: "apikey" | "oauth") {
    if (newMethod === "oauth") {
      const credentials = loadOAuthCredentials(ns, provider);
      if (credentials) {
        oauthFlow = { step: "connected" };
        updateAndSync({ authMethod: "oauth", apiKey: credentials.access });
      } else {
        authMethod = "oauth";
        oauthFlow = { step: "idle" };
      }
      return;
    }

    oauthFlow = { step: "idle" };
    updateAndSync({ authMethod: "apikey", apiKey: "" });
  }

  async function startOAuthLogin() {
    try {
      const { verifier, challenge } = await generatePKCE();
      const { url, oauthState } = buildAuthorizationUrl(
        provider,
        challenge,
        verifier,
      );
      window.open(url, "_blank");
      oauthFlow = { step: "awaiting-code", verifier, oauthState };
    } catch (error) {
      oauthFlow = {
        step: "error",
        message: error instanceof Error ? error.message : "Failed to start OAuth",
      };
    }
  }

  async function submitOAuthCode() {
    if (oauthFlow.step !== "awaiting-code" || !oauthCodeInput.trim()) return;

    const pendingFlow = oauthFlow;
    oauthFlow = { step: "exchanging" };

    try {
      const credentials = await exchangeOAuthCode({
        provider,
        rawInput: oauthCodeInput.trim(),
        verifier: pendingFlow.verifier,
        expectedState: pendingFlow.oauthState,
        useProxy,
        proxyUrl,
      });
      saveOAuthCredentials(ns, provider, credentials);
      oauthFlow = { step: "connected" };
      oauthCodeInput = "";
      updateAndSync({ apiKey: credentials.access, authMethod: "oauth" });
    } catch (error) {
      oauthFlow = {
        step: "error",
        message: error instanceof Error ? error.message : "OAuth failed",
      };
    }
  }

  function logoutOAuth() {
    removeOAuthCredentials(ns, provider);
    oauthFlow = { step: "idle" };
    updateAndSync({ authMethod: "apikey", apiKey: "" });
  }

  async function handleFolderSelect(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    installing = true;
    try {
      await chat.installSkill(Array.from(files));
    } finally {
      installing = false;
      if (folderInputRef) folderInputRef.value = "";
    }
  }

  async function handleFileSelect(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    installing = true;
    try {
      await chat.installSkill(Array.from(files));
    } finally {
      installing = false;
      if (fileInputRef) fileInputRef.value = "";
    }
  }
</script>

{#snippet toggleSwitch(active: boolean, onclick: () => void, ariaLabel: string)}
  <button
    type="button"
    {onclick}
    aria-label={ariaLabel}
    class={`w-10 h-5 rounded-full transition-colors relative ${active ? "bg-(--chat-accent)" : "bg-(--chat-border)"}`}
  >
    <span
      class={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${active ? "left-5" : "left-0.5"}`}
    ></span>
  </button>
{/snippet}

{#snippet apiKeyField(label: string, value: string, onInput: (v: string) => void, placeholder: string, altBg?: boolean)}
  <label class="block">
    <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
      {label}
    </span>
    <input
      type="password"
      {value}
      oninput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
      {placeholder}
      class={`w-full text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active) ${altBg ? "bg-(--chat-bg)" : "bg-(--chat-input-bg)"}`}
      style={inputStyle}
    />
  </label>
{/snippet}

<div class="flex-1 overflow-y-auto p-4 space-y-6" style="font-family: var(--chat-font-mono)">
  <div>
    <div class="text-[11px] font-semibold uppercase tracking-wider text-(--chat-text-primary) mb-4">
      api configuration
    </div>

    <div class="space-y-4 border border-(--chat-border) bg-(--chat-bg-secondary) p-4" style="border-radius: var(--chat-radius)">
      <label class="block">
        <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
          Provider
        </span>
        <select
          value={provider}
          onchange={(event) =>
            handleProviderChange((event.currentTarget as HTMLSelectElement).value)}
          class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
          style={inputStyle}
        >
          <option value="">Select provider...</option>
          {#each chat.availableProviders as availableProvider (availableProvider)}
            <option value={availableProvider}>{availableProvider}</option>
          {/each}
          <option disabled>──────────</option>
          <option value="openwebui">Open WebUI (local)</option>
          <option value="custom">Custom Endpoint</option>
        </select>
      </label>

      {#if isCustom}
        {#if provider === "openwebui"}
        <div>
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            API Type
          </span>
          <p class="text-sm text-(--chat-text-primary) py-1">
            OpenAI Completions
          </p>
          <p class="text-[10px] text-(--chat-text-muted) mt-1">
            Fixed — Open WebUI exposes only this protocol
          </p>
        </div>
        {:else}
        <label class="block">
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            API Type
          </span>
          <select
            value={apiType}
            onchange={(event) =>
              updateAndSync({
                apiType: (event.currentTarget as HTMLSelectElement).value,
              })}
            class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
            style={inputStyle}
          >
            {#each API_TYPES as type (type.id)}
              <option value={type.id}>{type.name}</option>
            {/each}
          </select>
          <p class="text-[10px] text-(--chat-text-muted) mt-1">
            {API_TYPES.find((type) => type.id === apiType)?.hint}
          </p>
        </label>
        {/if}

        <div>
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            LLM Connection
          </span>
          <div class="flex gap-1">
            <button
              type="button"
              onclick={() => setConnectionMode("direct")}
              class={`flex-1 py-1.5 text-xs border transition-colors ${connectionMode === "direct" ? "bg-(--chat-accent) border-(--chat-accent) text-white" : "bg-(--chat-input-bg) border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active)"}`}
              style="border-radius: var(--chat-radius)"
            >
              Direct HTTPS
            </button>
            <button
              type="button"
              onclick={() => setConnectionMode("proxy")}
              class={`flex-1 py-1.5 text-xs border transition-colors ${connectionMode === "proxy" ? "bg-(--chat-accent) border-(--chat-accent) text-white" : "bg-(--chat-input-bg) border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active)"}`}
              style="border-radius: var(--chat-radius)"
            >
              Local Proxy
            </button>
          </div>

          {#if connectionMode === "direct"}
            <p class="text-[10px] text-(--chat-text-muted) mt-1">
              Enter the full https:// base URL below. The LLM server must use a
              certificate trusted on this machine and must allow CORS from Office
              taskpanes. HTTP-only servers (Ollama, LM Studio) — use Local Proxy.
            </p>
            <button
              type="button"
              onclick={() => (showDirectHelp = !showDirectHelp)}
              class="mt-1 text-[10px] text-(--chat-text-secondary) underline hover:text-(--chat-text-primary)"
            >
              {showDirectHelp ? "Hide" : "Show"} direct-connection setup notes
            </button>
            {#if showDirectHelp}
              <div class="mt-1 p-2 border border-(--chat-border) text-[10px] text-(--chat-text-muted) space-y-1" style="border-radius: var(--chat-radius)">
                <p><b>vLLM</b>: HTTPS via <code>--ssl-certfile</code>/<code>--ssl-key-file</code>; allow taskpanes with
                  <code>--allowed-origins '["https://localhost:18131","https://localhost:18132","https://localhost:18133"]'</code></p>
                <p><b>llama.cpp (llama-server)</b>: CORS is permissive by default; for HTTPS put it behind a TLS reverse proxy</p>
                <p><b>Ollama</b>: HTTP only by default — use Local Proxy, or a TLS reverse proxy with <code>OLLAMA_ORIGINS=https://localhost:18131,https://localhost:18132,https://localhost:18133</code></p>
                <p><b>LM Studio</b>: HTTP only — use Local Proxy</p>
                <p>Self-signed certificates must be trusted in the current user's Windows certificate store, otherwise the taskpane will reject them — or use Local Proxy.</p>
              </div>
            {/if}
          {:else}
            <p class="text-[10px] text-(--chat-text-muted) mt-1">
              The offline PowerShell server forwards <code>/llm-proxy/*</code> to your
              LLM backend — works with plain HTTP backends and needs no CORS. The Base
              URL is managed automatically.
            </p>
            <label class="block mt-2">
              <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
                LLM backend address
              </span>
              <div class="flex gap-1">
                <input
                  type="text"
                  bind:value={proxyBackend}
                  placeholder="http://192.168.1.50:11434"
                  class="flex-1 min-w-0 bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active)"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onclick={saveProxyBackend}
                  disabled={proxyBusy}
                  class="px-3 py-2 text-xs border border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active) disabled:opacity-50"
                  style="border-radius: var(--chat-radius)"
                >
                  {proxyBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </label>
            {#if proxyStatus === "checking"}
              <p class="text-[10px] text-(--chat-text-muted) mt-1">Checking offline server…</p>
            {:else if proxyStatus === "error"}
              <p class="text-[10px] text-(--chat-text-muted) mt-1">
                Offline server unreachable ({proxyMessage}) — run start.ps1 on this machine.
              </p>
            {:else if proxyStatus === "saved"}
              <p class="text-[10px] text-(--chat-text-muted) mt-1">
                Saved — backend set, Base URL = {location.origin}/llm-proxy/v1
              </p>
            {:else if proxyStatus === "ok" && proxyBackend}
              <p class="text-[10px] text-(--chat-text-muted) mt-1">
                Current backend: {proxyBackend}
              </p>
            {:else if proxyStatus === "ok"}
              <p class="text-[10px] text-(--chat-text-muted) mt-1">
                No backend configured yet — enter the address and Save.
              </p>
            {/if}
          {/if}
        </div>

        {#if connectionMode === "direct"}
        <label class="block">
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            Base URL
          </span>
          <input
            type="text"
            bind:value={customBaseUrl}
            oninput={() => updateAndSync({ customBaseUrl })}
            placeholder="https://api.openai.com/v1"
            class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active)"
            style={inputStyle}
          />
          <p class="text-[10px] text-(--chat-text-muted) mt-1">
            The API endpoint URL for your provider
          </p>
        </label>
        {:else}
        <div>
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            Base URL
          </span>
          <p class="text-[10px] text-(--chat-text-muted)">
            {location.origin}/llm-proxy/v1 (managed by Local Proxy mode)
          </p>
        </div>
        {/if}

        <label class="block">
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            Model ID
          </span>
          <div class="flex gap-1">
            <input
              type="text"
              list="endpoint-models"
              bind:value={model}
              oninput={() => updateAndSync({ model })}
              placeholder="model id (or Load models)"
              class="flex-1 min-w-0 bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active)"
              style={inputStyle}
            />
            <button
              type="button"
              onclick={loadEndpointModels}
              disabled={modelsBusy}
              class="px-3 py-2 text-xs border border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active) disabled:opacity-50 whitespace-nowrap"
              style="border-radius: var(--chat-radius)"
            >
              {modelsBusy ? "…" : "Load models"}
            </button>
          </div>
          <datalist id="endpoint-models">
            {#each availableModels as m (m)}
              <option value={m}></option>
            {/each}
          </datalist>
          {#if modelsError}
            <p class="text-[10px] text-(--chat-text-muted) mt-1">
              Cannot load models: {modelsError}. Check Base URL / API key.
            </p>
          {:else if availableModels.length > 0}
            <p class="text-[10px] text-(--chat-text-muted) mt-1">
              {availableModels.length} models loaded — pick from the dropdown in the field
            </p>
          {/if}
        </label>
      {/if}

      {#if !isCustom && provider}
        <label class="block">
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            Model
          </span>
          <select
            value={model}
            onchange={(event) =>
              updateAndSync({ model: (event.currentTarget as HTMLSelectElement).value })}
            class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active) disabled:opacity-50 disabled:cursor-not-allowed"
            style={inputStyle}
          >
            <option value="">Select model...</option>
            {#each models as availableModel (availableModel.id)}
              <option value={availableModel.id}>{availableModel.name}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if hasOAuth}
        <div>
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            Authentication
          </span>
          <div class="flex gap-1">
            <button
              type="button"
              onclick={() => handleAuthMethodChange("apikey")}
              class={`flex-1 py-1.5 text-xs border transition-colors ${authMethod === "apikey" ? "bg-(--chat-accent) border-(--chat-accent) text-white" : "bg-(--chat-input-bg) border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active)"}`}
              style="border-radius: var(--chat-radius)"
            >
              API Key
            </button>
            <button
              type="button"
              onclick={() => handleAuthMethodChange("oauth")}
              class={`flex-1 py-1.5 text-xs border transition-colors ${authMethod === "oauth" ? "bg-(--chat-accent) border-(--chat-accent) text-white" : "bg-(--chat-input-bg) border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active)"}`}
              style="border-radius: var(--chat-radius)"
            >
              {OAUTH_PROVIDERS[provider]?.label ?? "OAuth"}
            </button>
          </div>
        </div>
      {/if}

      {#if hasOAuth && authMethod === "oauth"}
        <div class="space-y-2">
          {#if oauthFlow.step === "idle"}
            <button
              type="button"
              onclick={startOAuthLogin}
              class="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs bg-(--chat-input-bg) border border-(--chat-border) text-(--chat-text-primary) hover:border-(--chat-accent) hover:text-(--chat-accent) transition-colors"
              style="border-radius: var(--chat-radius)"
            >
              <ExternalLink size={12} />
              {OAUTH_PROVIDERS[provider]?.buttonText ?? "Login"}
            </button>
          {:else if oauthFlow.step === "awaiting-code"}
            <div class="space-y-2">
              <p class="text-[10px] text-(--chat-text-muted)">
                {provider === "openai-codex"
                  ? "Complete login in the opened tab. The page will redirect to localhost and fail — copy the full URL from your browser's address bar and paste it below:"
                  : "Authorize in the opened tab, then paste the code shown on the redirect page:"}
              </p>
              <div class="flex gap-1">
                <input
                  type="text"
                  bind:value={oauthCodeInput}
                  placeholder={provider === "openai-codex" ? "Paste the full redirect URL here" : "Paste code#state here"}
                  class="flex-1 bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active)"
                  style={inputStyle}
                  onkeydown={(event) => event.key === "Enter" && submitOAuthCode()}
                />
                <button
                  type="button"
                  onclick={submitOAuthCode}
                  disabled={!oauthCodeInput.trim()}
                  class="px-3 py-2 text-xs bg-(--chat-accent) text-white border border-(--chat-accent) hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style="border-radius: var(--chat-radius)"
                >
                  Submit
                </button>
              </div>
              <p class="text-[10px] text-(--chat-text-muted)">
                Requires CORS proxy to be enabled for token exchange.
              </p>
            </div>
          {:else if oauthFlow.step === "exchanging"}
            <div
              class="px-3 py-2.5 text-xs text-(--chat-text-muted) bg-(--chat-input-bg) border border-(--chat-border)"
              style="border-radius: var(--chat-radius)"
            >
              Exchanging authorization code…
            </div>
          {:else if oauthFlow.step === "connected"}
            <div
              class="flex items-center justify-between px-3 py-2.5 bg-(--chat-input-bg) border border-(--chat-border)"
              style="border-radius: var(--chat-radius)"
            >
              <div class="flex items-center gap-2 text-xs">
                <Check size={12} class="text-(--chat-success)" />
                <span class="text-(--chat-text-secondary)">
                  Connected via OAuth
                </span>
              </div>
              <button
                type="button"
                onclick={logoutOAuth}
                class="flex items-center gap-1 text-[10px] text-(--chat-text-muted) hover:text-(--chat-error) transition-colors"
              >
                <LogOut size={10} />
                Logout
              </button>
            </div>
          {:else if oauthFlow.step === "error"}
            <div class="space-y-2">
              <div
                class="px-3 py-2 text-xs text-(--chat-error) bg-(--chat-input-bg) border border-(--chat-error)/30"
                style="border-radius: var(--chat-radius)"
              >
                {oauthFlow.message}
              </div>
              <button
                type="button"
                onclick={() => (oauthFlow = { step: "idle" })}
                class="text-[10px] text-(--chat-text-muted) hover:text-(--chat-text-secondary) transition-colors"
              >
                Try again
              </button>
            </div>
          {/if}
        </div>
      {/if}

      {#if showApiKeyInput}
        <label class="block">
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            API Key
          </span>
          <div class="relative">
            <input
              type={showKey ? "text" : "password"}
              bind:value={apiKey}
              oninput={() => updateAndSync({ apiKey })}
              placeholder="Enter your API key"
              class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 pr-10 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active)"
              style={inputStyle}
            />
            <button
              type="button"
              onclick={() => (showKey = !showKey)}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-(--chat-text-muted) hover:text-(--chat-text-secondary)"
            >
              {#if showKey}
                <EyeOff size={14} />
              {:else}
                <Eye size={14} />
              {/if}
            </button>
          </div>
        </label>
      {/if}

      <div class="flex items-center justify-between">
        <div>
          <span class="text-xs text-(--chat-text-secondary)">
            CORS Proxy
          </span>
          <p class="text-[10px] text-(--chat-text-muted) mt-0.5">
            Required for Anthropic and some providers
          </p>
        </div>
        {@render toggleSwitch(
          useProxy,
          () => updateAndSync({ useProxy: !useProxy }),
          useProxy ? "Disable CORS proxy" : "Enable CORS proxy",
        )}
      </div>

      {#if useProxy}
        <label class="block">
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            Proxy URL
          </span>
          <input
            type="text"
            bind:value={proxyUrl}
            oninput={() => updateAndSync({ proxyUrl })}
            placeholder="https://your-proxy.com/proxy"
            class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active)"
            style={inputStyle}
          />
          <p class="text-[10px] text-(--chat-text-muted) mt-1">
            Your proxy should accept ?url=encoded_url format
          </p>
        </label>
      {/if}

      <div>
        <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
          Temperature
        </span>
        <input
          type="number"
          min="0"
          max="2"
          step="0.1"
          bind:value={temperature}
          oninput={() => updateAndSync({ temperature })}
          placeholder="provider default"
          class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active)"
          style={inputStyle}
        />
        <p class="text-[10px] text-(--chat-text-muted) mt-1">
          Empty — provider default. 0.1–0.3 recommended for tool calling
        </p>
      </div>

      <div>
        <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
          Thinking Level
        </span>
        <div class="flex gap-1">
          {#each THINKING_LEVELS as level (level.value)}
            <button
              type="button"
              onclick={() => updateAndSync({ thinking: level.value })}
              class={`flex-1 py-1.5 text-xs border transition-colors ${thinking === level.value ? "bg-(--chat-accent) border-(--chat-accent) text-white" : "bg-(--chat-input-bg) border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active)"}`}
              style="border-radius: var(--chat-radius)"
            >
              {level.label}
            </button>
          {/each}
        </div>
        <p class="text-[10px] text-(--chat-text-muted) mt-1">
          Extended thinking for supported models
        </p>
      </div>

      <div class="flex items-center justify-between">
        <div>
          <span class="text-xs text-(--chat-text-secondary)">
            Model supports images (vision)
          </span>
          <p class="text-[10px] text-(--chat-text-muted) mt-0.5">
            Off — screenshot tools and image analysis are hidden
          </p>
        </div>
        {@render toggleSwitch(
          supportsImages,
          () => updateAndSync({ supportsImages: !supportsImages }),
          supportsImages ? "Disable image support" : "Enable image support",
        )}
      </div>

      <div>
        <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
          Context Limit (tokens)
        </span>
        <input
          type="number"
          min="0"
          step="1000"
          bind:value={contextLimit}
          oninput={() => updateAndSync({ contextLimit })}
          placeholder="0 = model default"
          class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) placeholder:text-(--chat-text-muted) focus:outline-none focus:border-(--chat-border-active)"
          style={inputStyle}
        />
        <p class="text-[10px] text-(--chat-text-muted) mt-1">
          0 — model default. Set the real window for local models; /compact in chat
          compresses history manually.
        </p>
      </div>

      <div class="flex items-center justify-between">
        <div>
          <span class="text-xs text-(--chat-text-secondary)">
            Auto-compact Context
          </span>
          <p class="text-[10px] text-(--chat-text-muted) mt-0.5">
            Summarize older messages when nearing the limit
          </p>
        </div>
        {@render toggleSwitch(
          autoCompact,
          () => updateAndSync({ autoCompact: !autoCompact }),
          autoCompact ? "Disable auto-compact" : "Enable auto-compact",
        )}
      </div>

      <div class="flex items-center justify-between">
        <div>
          <span class="text-xs text-(--chat-text-secondary)">
            Expand Tool Calls
          </span>
          <p class="text-[10px] text-(--chat-text-muted) mt-0.5">
            Show tool call details expanded by default
          </p>
        </div>
        {@render toggleSwitch(
          expandToolCalls,
          () => chat.toggleExpandToolCalls(),
          expandToolCalls ? "Collapse tool calls by default" : "Expand tool calls by default",
        )}
      </div>

      {#if adapter?.appName === "OpenExcel"}
      <div class="border-t-2 border-(--chat-border) pt-4 space-y-3">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-(--chat-text-primary)">
          desktop power tools (COM bridge)
        </div>

        <div class="flex items-center justify-between">
          <div>
            <span class="text-xs text-(--chat-text-secondary)">
              Enable Desktop Power Tools
            </span>
            <p class="text-[10px] text-(--chat-text-muted) mt-0.5">
              Run macros (Application.Run) and create/edit/refresh Power Query
              in the open workbook via COM. Needs Excel running.
            </p>
          </div>
          {@render toggleSwitch(
            comEnabled,
            () => void toggleCom(),
            comEnabled ? "Disable desktop power tools" : "Enable desktop power tools",
          )}
        </div>

        {#if !comReachable}
          <p class="text-[10px] text-(--chat-text-muted)">
            Offline server unreachable — run start.ps1 on this machine.
          </p>
        {:else if comEnabled}
          <p class="text-[10px] text-(--chat-text-muted)">
            {#if comStatus?.excelRunning}
              Excel: running{comStatus?.workbook ? `, workbook: ${comStatus.workbook}` : ""}
            {:else}
              Excel is not running — open a workbook to use desktop tools.
            {/if}
          </p>
        {/if}
      </div>
      {/if}

      <div class="border-t-2 border-(--chat-border) pt-4 space-y-3">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-(--chat-text-primary)">
          dev add-in registration
        </div>

        {#if !devRegReachable}
          <p class="text-[10px] text-(--chat-text-muted)">
            Offline server unreachable — run start.ps1 on this machine.
          </p>
        {:else}
          <div class="flex items-center justify-between">
            <div>
              <span class="text-xs text-(--chat-text-secondary)">
                {devRegEnabled === null
                  ? "checking…"
                  : devRegEnabled
                    ? `Registered${devRegCount ? ` (${devRegCount})` : ""}`
                    : "Not registered"}
              </span>
              <p class="text-[10px] text-(--chat-text-muted) mt-0.5">
                WEF\Developer registry entries that make the add-ins load with
                Office. Remove rolls back to the pre-install state (other dev
                add-ins are untouched); restart Office afterwards.
              </p>
            </div>
            <div class="flex gap-1.5">
              <button
                type="button"
                class="px-2.5 py-1 text-[11px] font-medium bg-(--chat-input-bg) border border-(--chat-border) text-(--chat-text-primary) hover:border-(--chat-border-active) disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                style="border-radius: var(--chat-radius)"
                disabled={devRegBusy || devRegEnabled !== false}
                onclick={() => void setDevRegistration(true)}
              >
                Register
              </button>
              <button
                type="button"
                class="px-2.5 py-1 text-[11px] font-medium bg-(--chat-input-bg) border border-(--chat-border) text-(--chat-error) hover:border-(--chat-border-active) disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                style="border-radius: var(--chat-radius)"
                disabled={devRegBusy || devRegEnabled !== true}
                onclick={() => void setDevRegistration(false)}
              >
                Remove
              </button>
            </div>
          </div>
          {#if devRegMessage}
            <p class="text-[10px] text-(--chat-text-muted)">{devRegMessage}</p>
          {/if}
        {/if}
      </div>

      <div class="border-t-2 border-(--chat-border) pt-4 space-y-3">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-(--chat-text-primary)">
          web tools
        </div>

        <div class="flex items-center justify-between">
          <div>
            <span class="text-xs text-(--chat-text-secondary)">
              Enable Web Tools
            </span>
            <p class="text-[10px] text-(--chat-text-muted) mt-0.5">
              Off — web-search / web-fetch / image-search return "disabled"
            </p>
          </div>
          {@render toggleSwitch(
            webToolsEnabled,
            () => updateWebSettings({ enabled: !webToolsEnabled }),
            webToolsEnabled ? "Disable web tools" : "Enable web tools",
          )}
        </div>

        {#if webToolsEnabled}
        <label class="block">
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            Default Search Provider
          </span>
          <select
            value={webSearchProvider}
            onchange={(event) =>
              updateWebSettings({
                searchProvider: (event.currentTarget as HTMLSelectElement).value,
              })}
            class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
            style={inputStyle}
          >
            {#each searchProviders as searchProvider (searchProvider.id)}
              <option value={searchProvider.id}>{searchProvider.label}</option>
            {/each}
          </select>
          <p class="text-[10px] text-(--chat-text-muted) mt-1">
            Used by web-search.
          </p>
        </label>

        {#if adapter.hasImageSearch}
          <label class="block">
            <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
              Default Image Search Provider
            </span>
            <select
              value={imageSearchProvider}
              onchange={(event) =>
                updateWebSettings({
                  imageSearchProvider:
                    (event.currentTarget as HTMLSelectElement).value,
                })}
              class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
              style={inputStyle}
            >
              {#each imageSearchProviders as imageProvider (imageProvider.id)}
                <option value={imageProvider.id}>{imageProvider.label}</option>
              {/each}
            </select>
            <p class="text-[10px] text-(--chat-text-muted) mt-1">
              Used by image-search.
            </p>
          </label>
        {/if}

        <label class="block">
          <span class="block text-xs text-(--chat-text-secondary) mb-1.5">
            Default Fetch Provider
          </span>
          <select
            value={webFetchProvider}
            onchange={(event) =>
              updateWebSettings({
                fetchProvider: (event.currentTarget as HTMLSelectElement).value,
              })}
            class="w-full bg-(--chat-input-bg) text-(--chat-text-primary) text-sm px-3 py-2 border border-(--chat-border) focus:outline-none focus:border-(--chat-border-active)"
            style={inputStyle}
          >
            {#each fetchProviders as fetchProvider (fetchProvider)}
              <option value={fetchProvider}>{fetchProvider}</option>
            {/each}
          </select>
          <p class="text-[10px] text-(--chat-text-muted) mt-1">
            Used by web-fetch.
          </p>
        </label>

        {#if needsBraveKey}
          {@render apiKeyField("Brave API Key", braveApiKey, (v) => { braveApiKey = v; updateWebSettings({ braveApiKey }); }, "Required for Brave search")}
        {/if}

        {#if needsSerperKey}
          {@render apiKeyField("Serper API Key", serperApiKey, (v) => { serperApiKey = v; updateWebSettings({ serperApiKey }); }, "Required for Serper search")}
        {/if}

        {#if needsExaKey}
          {@render apiKeyField("Exa API Key", exaApiKey, (v) => { exaApiKey = v; updateWebSettings({ exaApiKey }); }, "Required for Exa search/fetch")}
        {/if}

        <div class="pt-1">
          <button
            type="button"
            onclick={() => (showAdvancedWebKeys = !showAdvancedWebKeys)}
            class="inline-flex items-center gap-1.5 text-xs text-(--chat-text-secondary) hover:text-(--chat-text-primary)"
          >
            {#if showAdvancedWebKeys}
              <ChevronUp size={12} />
            {:else}
              <ChevronDown size={12} />
            {/if}
            <span>
              {showAdvancedWebKeys ? "Hide" : "Show"} advanced saved API keys
            </span>
          </button>
        </div>

        {#if showAdvancedWebKeys}
          <div class="space-y-3 border border-(--chat-border) p-3 bg-(--chat-input-bg)">
            {#if !needsBraveKey}
              {@render apiKeyField("Brave API Key", braveApiKey, (v) => { braveApiKey = v; updateWebSettings({ braveApiKey }); }, "Optional", true)}
            {/if}

            {#if !needsSerperKey}
              {@render apiKeyField("Serper API Key", serperApiKey, (v) => { serperApiKey = v; updateWebSettings({ serperApiKey }); }, "Optional", true)}
            {/if}

            {#if !needsExaKey}
              {@render apiKeyField("Exa API Key", exaApiKey, (v) => { exaApiKey = v; updateWebSettings({ exaApiKey }); }, "Optional", true)}
            {/if}
          </div>
        {/if}
        {/if}
      </div>
    </div>
  </div>

  <div class="border border-(--chat-border) bg-(--chat-bg-secondary) p-4" style="border-radius: var(--chat-radius)">
    <div class="flex items-center gap-2 text-xs">
      {#if isConfigured}
        <Check size={12} class="text-(--chat-success)" />
        <span class="text-(--chat-text-secondary)">
          Using
          {#if $runtimeState.providerConfig?.provider === "custom"}
            custom ({$runtimeState.providerConfig?.apiType})
          {:else}
            {$runtimeState.providerConfig?.provider}
          {/if}
          {$runtimeState.providerConfig?.authMethod === "oauth" ? " via OAuth" : ""}
        </span>
      {:else}
        <span class="text-(--chat-text-muted)">
          Fill in all fields above to get started
        </span>
      {/if}
    </div>
  </div>

  <div class="border border-(--chat-border) bg-(--chat-bg-secondary) p-4" style="border-radius: var(--chat-radius)">
    <div class="text-[11px] font-semibold uppercase tracking-wider text-(--chat-text-primary) mb-4">
      agent skills
    </div>

    <div class="space-y-3">
      {#if $runtimeState.skills.length > 0}
        <div class="space-y-1">
          {#each $runtimeState.skills as skill (skill.name)}
            <div
              class="flex items-start justify-between gap-2 px-3 py-2 bg-(--chat-input-bg) border border-(--chat-border)"
              style="border-radius: var(--chat-radius)"
            >
              <div class="min-w-0 flex-1">
                <div class="text-xs text-(--chat-text-primary) font-medium truncate">
                  {skill.name}
                </div>
                <div class="text-[10px] text-(--chat-text-muted) mt-0.5 line-clamp-2">
                  {skill.description}
                </div>
              </div>
              <button
                type="button"
                onclick={() => void testSkill(skill.name)}
                class="shrink-0 p-1 text-(--chat-text-muted) hover:text-(--chat-accent) transition-colors"
                title="Test this skill"
              >
                <FlaskConical size={12} />
              </button>
              <button
                type="button"
                onclick={() => chat.uninstallSkill(skill.name)}
                class="shrink-0 p-1 text-(--chat-text-muted) hover:text-(--chat-error) transition-colors"
                title="Remove skill"
              >
                <Trash2 size={12} />
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-xs text-(--chat-text-muted)">No skills installed</p>
      {/if}

      <div class="flex gap-2">
        <button
          type="button"
          onclick={() => void generateSkill()}
          disabled={generatingSkill || !$runtimeState.providerConfig}
          class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-(--chat-accent)/10 border border-(--chat-accent) text-(--chat-accent) hover:bg-(--chat-accent)/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style="border-radius: var(--chat-radius)"
          title="AI generates a new skill from your description"
        >
          <Sparkles size={12} />
          {generatingSkill ? "Generating…" : "Generate Skill"}
        </button>
        <button
          type="button"
          onclick={() => folderInputRef?.click()}
          disabled={installing}
          class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-(--chat-input-bg) border border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active) hover:text-(--chat-text-primary) disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style="border-radius: var(--chat-radius)"
        >
          <FolderUp size={12} />
          {installing ? "Installing…" : "Add Folder"}
        </button>
        <button
          type="button"
          onclick={() => fileInputRef?.click()}
          disabled={installing}
          class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-(--chat-input-bg) border border-(--chat-border) text-(--chat-text-secondary) hover:border-(--chat-border-active) hover:text-(--chat-text-primary) disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style="border-radius: var(--chat-radius)"
        >
          <Plus size={12} />
          {installing ? "Installing…" : "Add File"}
        </button>
      </div>

      <p class="text-[10px] text-(--chat-text-muted)">
        Add a skill folder or a single SKILL.md file. Skills must have valid
        frontmatter with name and description.
      </p>
    </div>

    <input
      bind:this={folderInputRef}
      type="file"
      class="hidden"
      webkitdirectory={true}
      multiple
      onchange={handleFolderSelect}
    />
    <input
      bind:this={fileInputRef}
      type="file"
      accept=".md"
      class="hidden"
      onchange={handleFileSelect}
    />
  </div>

  <div class="border border-(--chat-border) bg-(--chat-bg-secondary) p-4" style="border-radius: var(--chat-radius)">
    <div class="text-[11px] font-semibold uppercase tracking-wider text-(--chat-text-primary) mb-2">
      about
    </div>
    <p class="text-xs text-(--chat-text-secondary) leading-relaxed">
      {adapter.appName || "This app"} uses your own API key to connect to LLM
      providers. Your key is stored locally in the browser.
    </p>
    {#if isCustom}
      <p class="text-xs text-(--chat-text-muted) leading-relaxed mt-2">
        Custom Endpoint: Point to any OpenAI-compatible API (Ollama, vLLM,
        LMStudio) or other supported API types.
      </p>
    {/if}
    {#if useProxy}
      <p class="text-xs text-(--chat-text-muted) leading-relaxed mt-2">
        CORS Proxy: Requests route through your proxy to bypass browser CORS
        restrictions. Required for Claude OAuth and some providers.
      </p>
    {/if}
    <p class="text-[10px] text-(--chat-text-muted) mt-3">
      {adapter.appVersion ? `v${adapter.appVersion}` : ""}
    </p>
  </div>
</div>
