import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MODEL_DISPLAY_NAME, modelsUrl, resolveKimiConfig } from "@/lib/kimi/config";
import {
  connectionError,
  describeProviderError,
  extractProviderMessage,
  sanitizeProviderText,
  type ChatError,
} from "@/lib/kimi/errors";

export interface KimiStatus {
  configured: boolean;
  keyConfigured: boolean;
  missing: string[];
  invalid: string[];
  providerLabel: string | null;
  host: string | null;
  modelId: string | null;
  modelDisplayName: string;
}

export interface KimiConnectionCheck {
  ok: boolean;
  latencyMs: number | null;
  modelListed: boolean | null;
  modelsCount: number | null;
  error: ChatError | null;
}

function readEnv() {
  return {
    KIMI_API_KEY: process.env["KIMI_API_KEY"],
    KIMI_API_BASE_URL: process.env["KIMI_API_BASE_URL"],
    KIMI_MODEL_ID: process.env["KIMI_MODEL_ID"],
    KIMI_MAX_TOKENS: process.env["KIMI_MAX_TOKENS"],
  };
}

/** Configuration summary for the settings panel. Never returns the key itself. */
export const getKimiStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<KimiStatus> => {
    const env = readEnv();
    const resolved = resolveKimiConfig(env);
    if (!resolved.ok) {
      return {
        configured: false,
        keyConfigured: !!env.KIMI_API_KEY?.trim(),
        missing: resolved.missing,
        invalid: resolved.invalid,
        providerLabel: null,
        host: null,
        modelId: env.KIMI_MODEL_ID?.trim() || null,
        modelDisplayName: MODEL_DISPLAY_NAME,
      };
    }
    const { config } = resolved;
    return {
      configured: true,
      keyConfigured: true,
      missing: [],
      invalid: [],
      providerLabel: config.providerLabel,
      host: config.host,
      modelId: config.modelId,
      modelDisplayName: MODEL_DISPLAY_NAME,
    };
  });

/** Verifies key + endpoint by listing models (no tokens are spent). Owner only. */
export const checkKimiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KimiConnectionCheck> => {
    const { data: access } = await context.supabase.rpc("claim_workspace_access");
    if (!(access as { has_access?: boolean } | null)?.has_access) {
      return {
        ok: false,
        latencyMs: null,
        modelListed: null,
        modelsCount: null,
        error: {
          source: "app",
          status: 403,
          code: "no_workspace_access",
          title: "Нет доступа",
          message: "Проверка доступна только владельцу пространства.",
        },
      };
    }

    const resolved = resolveKimiConfig(readEnv());
    if (!resolved.ok) {
      return {
        ok: false,
        latencyMs: null,
        modelListed: null,
        modelsCount: null,
        error: {
          source: "app",
          status: 503,
          code: "not_configured",
          title: "Kimi API не настроен",
          message: `Добавьте серверные секреты: ${[...resolved.missing, ...resolved.invalid].join(", ")}.`,
        },
      };
    }
    const { config } = resolved;
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(modelsUrl(config), {
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      });
    } catch (e) {
      return {
        ok: false,
        latencyMs: null,
        modelListed: null,
        modelsCount: null,
        error: connectionError(sanitizeProviderText(e instanceof Error ? e.message : String(e), [config.apiKey])),
      };
    }
    const latencyMs = Date.now() - started;
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        modelListed: null,
        modelsCount: null,
        error: describeProviderError(
          res.status,
          sanitizeProviderText(extractProviderMessage(text), [config.apiKey]),
        ),
      };
    }
    let ids: string[] = [];
    try {
      const json = JSON.parse(text) as { data?: Array<{ id?: unknown }> };
      ids = (json.data ?? []).map((m) => (typeof m.id === "string" ? m.id : "")).filter(Boolean);
    } catch {
      // Some providers return a non-standard list; treat as reachable but unknown.
    }
    return {
      ok: true,
      latencyMs,
      modelListed: ids.length ? ids.includes(config.modelId) : null,
      modelsCount: ids.length || null,
      error: null,
    };
  });
