/**
 * Pure configuration helpers for the Kimi integration.
 * No secrets are read here — callers pass the environment in (server only).
 */

export const REASONING_EFFORTS = ["low", "high", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: "Low",
  high: "High",
  max: "Max",
};

export const REASONING_EFFORT_HINTS: Record<ReasoningEffort, string> = {
  low: "Быстрее и дешевле, короткие рассуждения",
  high: "Сбалансированный режим по умолчанию",
  max: "Максимально глубокие рассуждения, дольше",
};

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export const MODEL_DISPLAY_NAME = "Kimi K3.1 Pro";

export const PROVIDER_PRESETS = {
  moonshot: {
    label: "Moonshot AI (официальный API)",
    baseUrl: "https://api.moonshot.ai/v1",
    modelId: "kimi-k3.1-pro",
  },
  kineticrouter: {
    label: "kineticRouter",
    baseUrl: "https://api.kineticrouter.com/v1",
    modelId: "moonshot/kimi-k3.1-pro",
  },
} as const;

export type ProviderKind = keyof typeof PROVIDER_PRESETS | "custom";

export interface KimiEnv {
  KIMI_API_KEY?: string | undefined;
  KIMI_API_BASE_URL?: string | undefined;
  KIMI_MODEL_ID?: string | undefined;
  KIMI_MAX_TOKENS?: string | undefined;
}

export interface KimiConfig {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  provider: ProviderKind;
  providerLabel: string;
  host: string;
  maxTokens: number;
}

export type KimiConfigResult =
  | { ok: true; config: KimiConfig }
  | { ok: false; missing: string[]; invalid: string[] };

export const DEFAULT_MAX_TOKENS = 32768;

export function detectProvider(baseUrl: string): ProviderKind {
  let host = "";
  try {
    host = new URL(baseUrl).host.toLowerCase();
  } catch {
    return "custom";
  }
  if (host === "api.moonshot.ai" || host === "api.moonshot.cn") return "moonshot";
  if (host.endsWith("kineticrouter.com")) return "kineticrouter";
  return "custom";
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

/**
 * Resolves the Kimi configuration from environment values.
 * - KIMI_API_KEY is required.
 * - KIMI_API_BASE_URL defaults to the official Moonshot endpoint.
 * - KIMI_MODEL_ID defaults to the model id of the detected provider preset.
 */
export function resolveKimiConfig(env: KimiEnv): KimiConfigResult {
  const apiKey = clean(env.KIMI_API_KEY);
  const rawBase = clean(env.KIMI_API_BASE_URL) || PROVIDER_PRESETS.moonshot.baseUrl;
  const baseUrl = rawBase.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");

  const missing: string[] = [];
  const invalid: string[] = [];
  if (!apiKey) missing.push("KIMI_API_KEY");

  let host = "";
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") invalid.push("KIMI_API_BASE_URL");
    host = url.host;
  } catch {
    invalid.push("KIMI_API_BASE_URL");
  }

  const provider = detectProvider(baseUrl);
  const presetModel = provider === "custom" ? "" : PROVIDER_PRESETS[provider].modelId;
  const modelId = clean(env.KIMI_MODEL_ID) || presetModel;
  if (!modelId) missing.push("KIMI_MODEL_ID");

  const parsedMax = Number.parseInt(clean(env.KIMI_MAX_TOKENS), 10);
  const maxTokens = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MAX_TOKENS;

  if (missing.length || invalid.length) return { ok: false, missing, invalid };

  return {
    ok: true,
    config: {
      apiKey,
      baseUrl,
      modelId,
      provider,
      providerLabel: provider === "custom" ? host : PROVIDER_PRESETS[provider].label,
      host,
      maxTokens,
    },
  };
}

export function chatCompletionsUrl(config: Pick<KimiConfig, "baseUrl">): string {
  return `${config.baseUrl}/chat/completions`;
}

export function modelsUrl(config: Pick<KimiConfig, "baseUrl">): string {
  return `${config.baseUrl}/models`;
}
