const STORAGE_KEY = "bmgbrand_ref";
const STORAGE_TS_KEY = "bmgbrand_ref_ts";
const COOKIE_NAME = "ref";
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

export function captureRefFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ref");
    if (!raw) return;
    const slug = raw.toLowerCase();
    if (!SLUG_RE.test(slug)) return;
    localStorage.setItem(STORAGE_KEY, slug);
    localStorage.setItem(STORAGE_TS_KEY, String(Date.now()));
  } catch {
    // localStorage may be unavailable (private mode, etc.) — silently ignore
  }
}

export function getStoredRef(): string | null {
  if (typeof window === "undefined") return null;
  // Priority: URL ?ref=  →  cookie  →  localStorage (with TTL)
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("ref");
    if (fromUrl && SLUG_RE.test(fromUrl.toLowerCase())) return fromUrl.toLowerCase();
  } catch {}

  const fromCookie = readCookie(COOKIE_NAME);
  if (fromCookie && SLUG_RE.test(fromCookie.toLowerCase())) return fromCookie.toLowerCase();

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const ts = Number(localStorage.getItem(STORAGE_TS_KEY));
    if (stored && SLUG_RE.test(stored) && Number.isFinite(ts) && Date.now() - ts < TTL_MS) {
      return stored;
    }
    if (stored && (!Number.isFinite(ts) || Date.now() - ts >= TTL_MS)) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_TS_KEY);
    }
  } catch {}

  return null;
}
