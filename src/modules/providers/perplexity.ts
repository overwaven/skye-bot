import Perplexity from "@perplexity-ai/perplexity_ai";
import type { ProviderCredentials } from "./types.js";

const PROBE_MODEL = "perplexity/sonar";
const PERPLEXITY_API_HOST = "api.perplexity.ai";
const INTEGRATION_HEADER = "X-Pplx-Integration";
const INTEGRATION_SLUG = "skye-bot";

export function perplexitySdkBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return url.toString().replace(/\/$/, "");
}

export function perplexityAttributionHeaders(baseUrl: string): Record<string, string> {
  return new URL(baseUrl).hostname.toLowerCase() === PERPLEXITY_API_HOST
    ? { [INTEGRATION_HEADER]: INTEGRATION_SLUG }
    : {};
}

export function createPerplexityClient(
  credentials: Pick<ProviderCredentials, "apiKey" | "baseUrl">,
  options: { maxRetries?: number } = {}
): Perplexity {
  return new Perplexity({
    apiKey: credentials.apiKey,
    baseURL: perplexitySdkBaseUrl(credentials.baseUrl),
    maxRetries: options.maxRetries,
    defaultHeaders: perplexityAttributionHeaders(credentials.baseUrl),
  });
}

export async function probePerplexityProvider(
  provider: ProviderCredentials
): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = createPerplexityClient(provider, { maxRetries: 0 });
    const response = await client.responses.create({
      model: PROBE_MODEL,
      input: "Reply OK.",
      max_output_tokens: 8,
    });
    if (response.status === "completed") return { ok: true };
    return {
      ok: false,
      error: response.error?.message || `Perplexity Agent API returned ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to reach Perplexity Agent API.",
    };
  }
}

export async function fetchPerplexityModels(
  provider: Pick<ProviderCredentials, "apiKey" | "baseUrl">
): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${perplexitySdkBaseUrl(provider.baseUrl)}/v1/models`, {
    headers: {
      ...perplexityAttributionHeaders(provider.baseUrl),
      Authorization: `Bearer ${provider.apiKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `The Agent API models endpoint returned ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`
    );
  }
  const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
  return body.data ?? [];
}
