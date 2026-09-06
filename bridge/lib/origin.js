// Who is allowed to drive the bridge.
//
// The bridge listens on 127.0.0.1 with no authentication. That is only safe
// while nothing on the web can reach it — and it could. There was no Origin
// check, and a POST with `Content-Type: text/plain` is a CORS *simple request*,
// which a browser sends WITHOUT a preflight. So any page the user happened to
// visit could fire state-changing requests at the bridge blind: approve a held
// permission, start a fork, drive a reveal. The response was unreadable
// cross-origin, but the side effect had already happened.
//
// The rule: a browser always sends Origin on a cross-origin request. Hooks, the
// CLI and the native app send none at all. So absence is allowed, and a present
// Origin must be loopback.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isAllowedOrigin(origin) {
  // No Origin header: not a browser cross-origin request.
  if (origin === undefined || origin === null || origin === "") return true;
  if (typeof origin !== "string") return false;

  let u;
  try {
    u = new URL(origin);
  } catch {
    return false; // "null" from a sandboxed iframe lands here too, correctly
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  // URL parsing is what makes the lookalikes safe: `127.0.0.1.evil.example` and
  // `evil.example#127.0.0.1` both have hostname `evil.example`. Never substring
  // match a hostname.
  const host = u.hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host);
}

// Only requests that change something need guarding; a GET of /state leaks
// nothing a page could read cross-origin anyway.
export function requiresOriginCheck(method) {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}
