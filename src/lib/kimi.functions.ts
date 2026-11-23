import { createServerFn } from "@tanstack/react-start";

import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  balanceUrl,
  estimateUrl,
  parseBalance,
  parseEstimate,
  supportsAccountApi,
  type KimiBalance,
} from "@/lib/kimi/balance";
import {
  MODEL_DISPLAY_NAME,
  modelsUrl,
  parseContextWindow,
  resolveKimiConfig,
} from "@/lib/kimi/config";
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
  /** Context window from KIMI_CONTEXT_WINDOW, or null when not configured. */
  contextWindow: number | null;
  /** Whether balance and token estimates are available for this provider. */
  accountApi: boolean;
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
        contextWindow: parseContextWindow(process.env["KIMI_CONTEXT_WINDOW"]),
        accountApi: false,
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
      contextWindow: parseContextWindow(process.env["KIMI_CONTEXT_WINDOW"]),
      accountApi: supportsAccountApi(config.provider),
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
        error: connectionError(
          sanitizeProviderText(e instanceof Error ? e.message : String(e), [config.apiKey]),
        ),
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

export interface KimiBalanceResult {
  /** false when the provider has no balance API (kineticRouter, custom endpoints). */
  supported: boolean;
  balance: KimiBalance | null;
  checkedAt: string;
  error: ChatError | null;
}

async function ownerOnly(supabase: {
  rpc: (fn: "claim_workspace_access") => PromiseLike<{ data: unknown }>;
}): Promise<boolean> {
  const { data } = await supabase.rpc("claim_workspace_access");
  return !!(data as { has_access?: boolean } | null)?.has_access;
}

const NO_ACCESS: ChatError = {
  source: "app",
  status: 403,
  code: "no_workspace_access",
  title: "Нет доступа",
  message: "Доступно только владельцу пространства.",
};

/** Account balance from Kimi (GET /users/me/balance). Owner only; the key stays here. */
export const getKimiBalance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KimiBalanceResult> => {
    const checkedAt = new Date().toISOString();
    if (!(await ownerOnly(context.supabase)))
      return { supported: false, balance: null, checkedAt, error: NO_ACCESS };
    const resolved = resolveKimiConfig(readEnv());
    if (!resolved.ok) return { supported: false, balance: null, checkedAt, error: null };
    const { config } = resolved;
    if (!supportsAccountApi(config.provider))
      return { supported: false, balance: null, checkedAt, error: null };
    try {
      const res = await fetch(balanceUrl(config), {
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        return {
          supported: true,
          balance: null,
          checkedAt,
          error: describeProviderError(
            res.status,
            sanitizeProviderText(extractProviderMessage(text), [config.apiKey]),
          ),
        };
      }
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        // handled below
      }
      const balance = parseBalance(json);
      return {
        supported: true,
        balance,
        checkedAt,
        error: balance
          ? null
          : {
              source: "provider",
              status: res.status,
              code: "bad_balance_response",
              title: "Непонятный ответ о балансе",
              message: "Kimi вернул баланс в неожиданном формате.",
            },
      };
    } catch (e) {
      return {
        supported: true,
        balance: null,
        checkedAt,
        error: connectionError(
          sanitizeProviderText(e instanceof Error ? e.message : String(e), [config.apiKey]),
        ),
      };
    }
  });

export interface TokenEstimateResult {
  supported: boolean;
  tokens: number | null;
  error: ChatError | null;
}

/** Estimates the draft's tokens with Kimi's tokenizer (no generation, nothing is billed). */
export const estimateDraftTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ text: z.string().min(1).max(400_000) }).parse(input))
  .handler(async ({ data, context }): Promise<TokenEstimateResult> => {
    if (!(await ownerOnly(context.supabase)))
      return { supported: false, tokens: null, error: NO_ACCESS };
    const resolved = resolveKimiConfig(readEnv());
    if (!resolved.ok || !supportsAccountApi(resolved.config.provider))
      return { supported: false, tokens: null, error: null };
    const { config } = resolved;
    try {
      const res = await fetch(estimateUrl(config), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: config.modelId,
          messages: [{ role: "user", content: data.text }],
        }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        return {
          supported: true,
          tokens: null,
          error: describeProviderError(
            res.status,
            sanitizeProviderText(extractProviderMessage(text), [config.apiKey]),
          ),
        };
      }
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        // handled below
      }
      return { supported: true, tokens: parseEstimate(json), error: null };
    } catch (e) {
      return {
        supported: true,
        tokens: null,
        error: connectionError(
          sanitizeProviderText(e instanceof Error ? e.message : String(e), [config.apiKey]),
        ),
      };
    }
  });
