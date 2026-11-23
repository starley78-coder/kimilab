/**
 * SSRF guard for open_url. A URL is allowed only if it is http(s), has no credentials,
 * and every address its hostname resolves to is public. Checked on every redirect hop.
 */
export type Resolver = (hostname: string, signal: AbortSignal) => Promise<string[]>;

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp"];

function ipv4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

export function isPrivateIPv4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return true;
  const [a = 0, b = 0, c = 0] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

export function isPrivateIPv6(raw: string): boolean {
  const ip =
    raw
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .split("%")[0] ?? "";
  if (ip === "::" || ip === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  if (/^::ffff:/.test(ip)) return true;
  const first = Number.parseInt(ip.split(":")[0] || "0", 16);
  if (!Number.isFinite(first)) return true;
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 || // multicast
    (first === 0x2001 && ip.startsWith("2001:db8")) || // documentation
    first === 0x64 // 64:ff9b::/96 NAT64 can reach private v4
  );
}

export function isIpLiteral(host: string): "v4" | "v6" | null {
  if (ipv4Parts(host)) return "v4";
  if (host.includes(":")) return "v6";
  return null;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIpLiteral(ip);
  if (kind === "v4") return isPrivateIPv4(ip);
  if (kind === "v6") return isPrivateIPv6(ip);
  return true;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Static checks that need no network. */
export function checkUrlShape(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, reason: "scheme_not_allowed" };
  if (url.username || url.password) return { ok: false, reason: "credentials_in_url" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || (!host.includes(".") && !isIpLiteral(host)))
    return { ok: false, reason: "private_host" };
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s)))
    return { ok: false, reason: "private_host" };
  if (url.port && !["80", "443", "8080", "8443"].includes(url.port))
    return { ok: false, reason: "port_not_allowed" };
  if (isIpLiteral(host) && isPrivateAddress(host)) return { ok: false, reason: "private_address" };
  return { ok: true, url };
}

/** Full check: shape plus DNS resolution; every resolved address must be public. */
export async function checkUrl(
  raw: string,
  resolve: Resolver,
  signal: AbortSignal,
): Promise<UrlCheck> {
  const shape = checkUrlShape(raw);
  if (!shape.ok) return shape;
  const host = shape.url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return shape;
  let addresses: string[];
  try {
    addresses = await resolve(host, signal);
  } catch {
    return { ok: false, reason: "dns_failed" };
  }
  if (addresses.length === 0) return { ok: false, reason: "dns_failed" };
  if (addresses.some(isPrivateAddress)) return { ok: false, reason: "private_address" };
  return shape;
}

/** DNS-over-HTTPS resolver (the edge runtime has no DNS API). */
export const dohResolver: Resolver = async (hostname, signal) => {
  const out: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
      {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      },
    );
    if (!res.ok) throw new Error(`dns ${res.status}`);
    const json = (await res.json()) as { Answer?: { type: number; data: string }[] };
    for (const a of json.Answer ?? []) {
      if ((type === "A" && a.type === 1) || (type === "AAAA" && a.type === 28)) out.push(a.data);
    }
  }
  return out;
};
