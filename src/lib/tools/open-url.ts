import { checkUrl, type Resolver } from "./url-safety";

export interface OpenUrlResult {
  final_url: string;
  http_status?: number;
  title: string;
  text: string;
  truncated: boolean;
  error?: string;
  blocked?: boolean;
}

export const OPEN_TIMEOUT_MS = 12_000;
export const MAX_DOWNLOAD_BYTES = 1_500_000;
export const MAX_TEXT_CHARS = 12_000;
const MAX_REDIRECTS = 5;
const ALLOWED_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1]?.toLowerCase() === "x"
          ? Number.parseInt(e.slice(2), 16)
          : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Extracts the title and readable text; scripts, styles and markup never reach the model. */
export function extractText(html: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  let body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const main = /<(main|article)[^>]*>([\s\S]*?)<\/\1>/i.exec(body)?.[2];
  if (main && main.length > 500) body = main;
  const text = decodeEntities(
    body
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(
        /<(script|style|noscript|svg|template|iframe|form|nav|footer|header)[\s\S]*?<\/\1>/gi,
        " ",
      )
      .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { title: title.slice(0, 300), text };
}

async function readLimited(res: Response, limit: number): Promise<{ text: string; cut: boolean }> {
  if (!res.body) return { text: "", cut: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      chunks.push(value.subarray(0, value.byteLength - (size - limit)));
      cut = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(all), cut };
}

const BLOCK_REASON: Record<string, string> = {
  invalid_url: "Некорректный адрес",
  scheme_not_allowed: "Разрешены только адреса http и https",
  credentials_in_url: "Адреса с логином и паролем запрещены",
  private_host: "Адрес локальной или служебной сети запрещён",
  private_address: "Адрес ведёт в непубличную сеть",
  port_not_allowed: "Нестандартный порт запрещён",
  dns_failed: "Не удалось определить адрес сайта",
};

export async function openUrl(
  raw: string,
  opts: { resolve: Resolver; signal: AbortSignal; fetchFn?: typeof fetch },
): Promise<OpenUrlResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(OPEN_TIMEOUT_MS)]);
  let current = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const check = await checkUrl(current, opts.resolve, signal);
      if (!check.ok)
        return {
          final_url: current,
          title: "",
          text: "",
          truncated: false,
          blocked: true,
          error: BLOCK_REASON[check.reason] ?? "Адрес запрещён",
        };
      const res = await fetchFn(check.url.toString(), {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "user-agent": "KimiLab/1.0 (+read-only fetch)",
        },
        signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!loc)
          return {
            final_url: current,
            http_status: res.status,
            title: "",
            text: "",
            truncated: false,
            error: "Перенаправление без адреса",
          };
        current = new URL(loc, check.url).toString();
        continue;
      }
      const type =
        (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return {
          final_url: current,
          http_status: res.status,
          title: "",
          text: "",
          truncated: false,
          error: `Сайт ответил ${res.status}`,
        };
      }
      if (!ALLOWED_TYPES.includes(type)) {
        await res.body?.cancel().catch(() => undefined);
        return {
          final_url: current,
          http_status: res.status,
          title: "",
          text: "",
          truncated: false,
          blocked: true,
          error: "Это не веб-страница (файлы не открываются)",
        };
      }
      const { text: body, cut } = await readLimited(res, MAX_DOWNLOAD_BYTES);
      const extracted =
        type === "text/plain" ? { title: "", text: body.trim() } : extractText(body);
      const truncated = cut || extracted.text.length > MAX_TEXT_CHARS;
      return {
        final_url: current,
        http_status: res.status,
        title: extracted.title,
        text: extracted.text.slice(0, MAX_TEXT_CHARS),
        truncated,
      };
    }
    return {
      final_url: current,
      title: "",
      text: "",
      truncated: false,
      error: "Слишком много перенаправлений",
    };
  } catch (e) {
    if (opts.signal.aborted) throw e;
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      final_url: current,
      title: "",
      text: "",
      truncated: false,
      error: timeout ? "Страница не ответила вовремя" : "Не удалось открыть страницу",
    };
  }
}
