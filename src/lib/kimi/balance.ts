/**
 * Pure helpers for Kimi account balance, token estimates and context-window levels.
 * Endpoints are from the Kimi API docs (saved in docs/kimi/). No secrets here.
 */
import type { KimiConfig, ProviderKind } from "./config";

/** The official Kimi context window for K3.1 Pro, from the quickstart docs. */
export const DOCUMENTED_CONTEXT_WINDOW = 1_000_000;

/** Balance and token-estimate endpoints exist only on the official Moonshot API. */
export function supportsAccountApi(provider: ProviderKind): boolean {
  return provider === "moonshot";
}

export function balanceUrl(config: Pick<KimiConfig, "baseUrl">): string {
  return `${config.baseUrl}/users/me/balance`;
}

export function estimateUrl(config: Pick<KimiConfig, "baseUrl">): string {
  return `${config.baseUrl}/tokenizers/estimate-token-count`;
}

export interface KimiBalance {
  /** USD, includes vouchers. ≤ 0 means requests are refused. */
  available: number;
  voucher: number;
  /** USD, may be negative (debt). */
  cash: number;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Parses `GET /v1/users/me/balance`. Returns null for any unexpected shape. */
export function parseBalance(json: unknown): KimiBalance | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const available = finite(d["available_balance"]);
  const voucher = finite(d["voucher_balance"]);
  const cash = finite(d["cash_balance"]);
  if (available === null || voucher === null || cash === null) return null;
  return { available, voucher, cash };
}

export type BalanceLevel = "ok" | "low" | "empty";
export const LOW_BALANCE_USD = 1;

export function balanceLevel(available: number): BalanceLevel {
  if (available <= 0) return "empty";
  if (available < LOW_BALANCE_USD) return "low";
  return "ok";
}

/** Parses `POST /v1/tokenizers/estimate-token-count` → `data.total_tokens`. */
export function parseEstimate(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object") return null;
  return finite((data as Record<string, unknown>)["total_tokens"]);
}

/** Kimi returns 429 with type `exceeded_current_quota_error` when the balance is used up. */
export function isQuotaErrorBody(body: string): boolean {
  return /exceeded_current_quota_error/i.test(body);
}

export type ContextLevel = "ok" | "warn" | "critical";

export function contextUsage(used: number, window: number) {
  const pct = Math.min(100, (used / window) * 100);
  const remaining = Math.max(0, window - used);
  const level: ContextLevel = pct >= 95 ? "critical" : pct >= 80 ? "warn" : "ok";
  return { pct, remaining, level };
}
