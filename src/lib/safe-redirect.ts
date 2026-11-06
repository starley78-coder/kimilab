/** Accepts only same-origin relative paths so sign-in cannot redirect off-site. */
export function safeRedirectPath(value: unknown, fallback = "/chat"): string {
  if (typeof value !== "string" || !value) return fallback;
  let path = value;
  try {
    // Router may hand us a full href; keep only path + search + hash of same-origin URLs.
    if (/^https?:\/\//i.test(path)) {
      if (typeof window === "undefined") return fallback;
      const url = new URL(path);
      if (url.origin !== window.location.origin) return fallback;
      path = url.pathname + url.search + url.hash;
    }
  } catch {
    return fallback;
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  if (path.startsWith("/auth") || path.startsWith("/reset-password")) return fallback;
  return path;
}
