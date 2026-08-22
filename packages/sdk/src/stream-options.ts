import type { ProviderConfig } from "./provider-config";

/**
 * Per-request stream options for the OpenAI-compatible backend.
 * cache_prompt: llama.cpp reuses the KV prefix across requests; sending it
 * explicitly is free and keeps behavior stable across server versions
 * (harmless for Open WebUI / other OpenAI-compatible backends).
 */
export function buildStreamOptions(
  base: Record<string, unknown>,
  apiKey: string,
  temperature: number | undefined,
): Record<string, unknown> {
  const opts: Record<string, unknown> = { ...base, apiKey, cache_prompt: true };
  if (typeof temperature === "number") {
    opts.temperature = temperature;
  }
  return opts;
}
