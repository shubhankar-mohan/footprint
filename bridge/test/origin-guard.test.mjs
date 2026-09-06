import { test } from "node:test";
import assert from "node:assert";
import { isAllowedOrigin } from "../lib/origin.js";

// The bridge listens on 127.0.0.1 with no authentication, which is fine only
// while nothing on the web can reach it. It could: there was no Origin check,
// and a POST with Content-Type: text/plain is a CORS "simple request", so a
// browser sends it WITHOUT a preflight. Any page you visited could fire
// state-changing requests at the bridge blind — approve a permission, start a
// fork, drive a reveal.
//
// Same-origin and non-browser callers (hooks, the CLI, curl) send no Origin
// header at all, so absence is allowed; a present, foreign Origin is not.

test("a request with no Origin is allowed — hooks, CLI, the app", () => {
  assert.equal(isAllowedOrigin(undefined), true);
  assert.equal(isAllowedOrigin(null), true);
  assert.equal(isAllowedOrigin(""), true);
});

test("the Atlas page itself is allowed on any loopback port", () => {
  assert.equal(isAllowedOrigin("http://127.0.0.1:8791"), true);
  assert.equal(isAllowedOrigin("http://localhost:63973"), true);
  assert.equal(isAllowedOrigin("http://[::1]:8080"), true);
});

test("a web page is refused", () => {
  assert.equal(isAllowedOrigin("https://evil.example"), false);
  assert.equal(isAllowedOrigin("http://evil.example"), false);
  assert.equal(isAllowedOrigin("null"), false);           // sandboxed iframe
});

// The interesting bypasses: a hostname that merely CONTAINS localhost.
test("a lookalike hostname does not pass", () => {
  for (const o of [
    "http://127.0.0.1.evil.example",
    "http://localhost.evil.example",
    "https://notlocalhost",
    "http://evil.example#127.0.0.1",
    "http://user@evil.example",
  ]) assert.equal(isAllowedOrigin(o), false, o);
});

test("garbage is refused, never thrown on", () => {
  for (const o of ["://", "http://", "%%%", "http://[", 12345, {}]) {
    assert.doesNotThrow(() => isAllowedOrigin(o));
    assert.equal(isAllowedOrigin(o), false, String(o));
  }
});
