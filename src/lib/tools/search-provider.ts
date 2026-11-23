/**
 * Search provider adapter. The chat only sees SearchResponse; the provider is chosen by
 * the server secrets SEARCH_PROVIDER (tavily | brave, default tavily) and SEARCH_API_KEY.
 */
export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  published?: string;
}

export interface SearchResponse {
  provider: string;
  query: string;
  results: SearchHit[];
  duration_ms: number;
  error?: string;
}

export interface SearchProvider {
  name: string;
  search(query: string, signal: AbortSignal): Promise<SearchResponse>;
}

export type SearchConfigResult =
  | { ok: true; provider: SearchProvider }
  | { ok: false; reason: "not_configured" | "unknown_provider" };

export const SEARCH_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 5;
const MAX_SNIPPET = 500;

function clip(s: unknown, n: number): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "";
}

export class SearchHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function statusMessage(status: number): string {
  if (status === 401 || status === 403) return "Ключ поиска не принят провайдером";
  if (status === 429) return "Лимит поискового провайдера исчерпан, повторите позже";
  if (status >= 500) return "Поисковый провайдер недоступен";
  return `Поисковый провайдер ответил ошибкой ${status}`;
}

async function timed(
  name: string,
  query: string,
  signal: AbortSignal,
  run: (signal: AbortSignal) => Promise<SearchHit[]>,
): Promise<SearchResponse> {
  const started = Date.now();
  try {
    const results = await run(AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]));
    return { provider: name, query, results, duration_ms: Date.now() - started };
  } catch (e) {
    if (signal.aborted) throw e;
    const error =
      e instanceof SearchHttpError
        ? statusMessage(e.status)
        : e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
          ? "Поиск не ответил вовремя"
          : "Не удалось выполнить поиск";
    return { provider: name, query, results: [], duration_ms: Date.now() - started, error };
  }
}

export function tavilyProvider(apiKey: string, fetchFn: typeof fetch = fetch): SearchProvider {
  return {
    name: "tavily",
    search: (query, signal) =>
      timed("tavily", query, signal, async (s) => {
        const res = await fetchFn("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ query, max_results: MAX_RESULTS, search_depth: "basic" }),
          signal: s,
        });
        if (!res.ok) throw new SearchHttpError(res.status, "tavily");
        const json = (await res.json()) as { results?: Record<string, unknown>[] };
        return (json.results ?? []).flatMap((r) => {
          const url = typeof r["url"] === "string" ? r["url"] : "";
          if (!/^https?:\/\//i.test(url)) return [];
          const hit: SearchHit = {
            title: clip(r["title"], 300) || url,
            url,
            snippet: clip(r["content"], MAX_SNIPPET),
          };
          if (typeof r["published_date"] === "string") hit.published = r["published_date"];
          return [hit];
        });
      }),
  };
}

export function braveProvider(apiKey: string, fetchFn: typeof fetch = fetch): SearchProvider {
  return {
    name: "brave",
    search: (query, signal) =>
      timed("brave", query, signal, async (s) => {
        const res = await fetchFn(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`,
          { headers: { accept: "application/json", "x-subscription-token": apiKey }, signal: s },
        );
        if (!res.ok) throw new SearchHttpError(res.status, "brave");
        const json = (await res.json()) as { web?: { results?: Record<string, unknown>[] } };
        return (json.web?.results ?? []).flatMap((r) => {
          const url = typeof r["url"] === "string" ? r["url"] : "";
          if (!/^https?:\/\//i.test(url)) return [];
          const hit: SearchHit = {
            title: clip(r["title"], 300) || url,
            url,
            snippet: clip(String(r["description"] ?? "").replace(/<[^>]+>/g, ""), MAX_SNIPPET),
          };
          if (typeof r["age"] === "string") hit.published = r["age"];
          return [hit];
        });
      }),
  };
}

export function resolveSearchProvider(env: {
  SEARCH_PROVIDER?: string | undefined;
  SEARCH_API_KEY?: string | undefined;
}): SearchConfigResult {
  const key = (env.SEARCH_API_KEY ?? "").trim();
  if (!key) return { ok: false, reason: "not_configured" };
  const name = (env.SEARCH_PROVIDER ?? "tavily").trim().toLowerCase() || "tavily";
  if (name === "tavily") return { ok: true, provider: tavilyProvider(key) };
  if (name === "brave") return { ok: true, provider: braveProvider(key) };
  return { ok: false, reason: "unknown_provider" };
}
