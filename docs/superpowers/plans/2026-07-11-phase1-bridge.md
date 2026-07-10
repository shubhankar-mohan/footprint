# Phase 1 Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase 0 Node bridge to support the official `PermissionRequest` hook (primary approval channel) alongside `PreToolUse` (headless fallback), with call-dedupe, `updatedInput` answers, a persisted `session_id ↔ tmux ↔ cwd` map, and the full hook set — all verified by the smoke test.

**Architecture:** The bridge already ingests hooks, holds a gated request open, and serves `/state` + `/events`. This plan adds a channel-aware decision layer so one held request can resolve as either a `PreToolUse` `permissionDecision` or a `PermissionRequest` `decision.behavior` (with `updatedInput`), dedupes the two channels for a single tool call, and records a session map. No new runtime dependencies.

**Tech Stack:** Node ≥ 18 (ESM, dependency-free), `node:http`, `node:test` for units, existing `test/smoke.mjs` for end-to-end.

## Global Constraints

- **Dependency-free:** no `npm install`; standard library only (matches the spike).
- **Fail-open is sacred:** `hooks/cc-hook.mjs` must still print nothing + exit 0 when the bridge is unreachable. No change may weaken this.
- **Bounded wait:** a held request always resolves — by decision or by timeout. Bridge hold ≈55s; the `PreToolUse`/`PermissionRequest` settings timeout is 90s (`GATE_TIMEOUT_S`). Never remove the timeout.
- **`session_id` is the universal join key** across sessions, pending, and the session map.
- **PermissionRequest decision JSON** is `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny"[,"updatedInput":{…}]}}}`, and the *ask/timeout* case for this channel means **print nothing** (Claude shows its own prompt). This shape is per Claude Code hooks docs as of 2026-07 and is **confirmed against a live payload in Task 1**; `lib/hookdecision.js` is the single place to adjust it.
- **PreToolUse decision JSON** is the existing `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"|"deny"|"ask","permissionDecisionReason":…}}`.
- **Keep the existing 9 smoke checks green** at every commit.

## File Structure

- `docs/superpowers/specs/2026-07-11-hook-payloads.md` — **create** (Task 1): captured real payload + decision shapes; the authoritative contract.
- `bridge/lib/hookdecision.js` — **create** (Task 2): channel-aware `decisionOutput()`.
- `bridge/test/hookdecision.test.mjs` — **create** (Task 2): unit tests for it.
- `bridge/lib/pending.js` — **modify** (Task 3): carry `channel`; add `findByCall()`.
- `bridge/test/pending.test.mjs` — **create** (Task 3): unit tests for dedupe.
- `bridge/lib/sessions.js` — **modify** (Task 4): handle `PermissionRequest` event.
- `bridge/server.js` — **modify** (Task 5): gate `PermissionRequest`, dedupe, use `hookdecision`, accept `updatedInput` on `/decision`, surface session map.
- `bridge/hooks/cc-hook.mjs` — **modify** (Task 6): gate `PermissionRequest`; print nothing on passthrough.
- `bridge/scripts/install-hooks.mjs` — **modify** (Task 7): register `PermissionRequest`.
- `bridge/lib/session-map.js` — **create** (Task 8): persisted `session_id ↔ {tmux,cwd,project}`.
- `bridge/lib/paths.js` — **modify** (Task 8): add `SESSION_MAP` path.
- `bridge/test/session-map.test.mjs` — **create** (Task 8): unit tests.
- `bridge/test/smoke.mjs` — **modify** (Tasks 5): add PermissionRequest + dedupe + updatedInput checks.
- `bridge/package.json` — **modify** (Task 2): `test` runs units then smoke.

---

### Task 1: Capture real payloads + verify the contract (on-device, gates all code tasks)

**Files:**
- Create: `docs/superpowers/specs/2026-07-11-hook-payloads.md`

**Interfaces:**
- Produces: the authoritative request + decision JSON shapes for `PreToolUse` and `PermissionRequest`, consumed by Tasks 2, 5, 6.

This is a manual verification task (no code). It de-risks the `PermissionRequest` contract before we build against it.

- [ ] **Step 1: Run the bridge and install hooks**

```bash
cd bridge
npm start            # leave running in one terminal
# in another terminal:
npm run install-hooks -- --dry   # eyeball the diff
npm run install-hooks
```

- [ ] **Step 2: Trigger a real permission prompt from a live session**

```bash
cd /tmp && mkdir -p ccbar-scratch && cd ccbar-scratch && git init -q
claude
# in the session, ask: run: echo hi   (a Bash gate)
# approve it via:  npm run cli   → press [a]
```

- [ ] **Step 3: Inspect the captured payloads**

Run: `grep -c '"dir":"in"' ~/.claude-control-bar/events.log` (Expected: ≥ 1)
Open `~/.claude-control-bar/events.log`; find the `PreToolUse` entry and, if your Claude Code version fires it, the `PermissionRequest` entry. Record: does `PermissionRequest` fire in interactive mode? What are the exact `hook_event_name`, `tool_name`, `tool_input`, and (from the docs + any observed output) the exact **decision** JSON each channel expects?

- [ ] **Step 4: Confirm tmux ownership on-device**

```bash
npm run cli launch ~/tmp/ccbar-scratch
tmux ls                                   # cc-XXXX session exists
npm run cli send cc-XXXX "continue"       # nudge lands in the pane
tmux attach -t cc-XXXX                     # foreground + attached; Ctrl-b d to detach
```

- [ ] **Step 5: Write the contract doc**

Create `docs/superpowers/specs/2026-07-11-hook-payloads.md` with: a pasted real `PreToolUse` payload, a real `PermissionRequest` payload (or a note that it did not fire in this Claude Code version → we rely on `PreToolUse`), and the confirmed decision JSON for each channel. If the observed `PermissionRequest` decision shape differs from Global Constraints, note the correct shape here — Task 2 uses this doc as truth.

- [ ] **Step 6: Uninstall hooks + commit**

```bash
npm run uninstall-hooks
git add docs/superpowers/specs/2026-07-11-hook-payloads.md
git commit -m "docs: capture real PreToolUse/PermissionRequest payloads + tmux confirmation"
```

---

### Task 2: Channel-aware decision output module

**Files:**
- Create: `bridge/lib/hookdecision.js`
- Create: `bridge/test/hookdecision.test.mjs`
- Modify: `bridge/package.json` (test script)

**Interfaces:**
- Produces: `decisionOutput(channel, decision, reason?, updatedInput?)` where `channel` is `"preToolUse"|"permissionRequest"`, `decision` is `"allow"|"deny"|"ask"`. Returns a JSON-serializable object to send back to the hook, **or `null`** meaning "print nothing" (used for `permissionRequest` + `ask`). Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `bridge/test/hookdecision.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { decisionOutput } from "../lib/hookdecision.js";

test("preToolUse allow → permissionDecision shape", () => {
  const out = decisionOutput("preToolUse", "allow", "ok");
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "allow");
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, "ok");
});

test("preToolUse ask → permissionDecision ask (never null)", () => {
  const out = decisionOutput("preToolUse", "ask", "timeout");
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
});

test("permissionRequest allow → decision.behavior shape", () => {
  const out = decisionOutput("permissionRequest", "allow");
  assert.equal(out.hookSpecificOutput.hookEventName, "PermissionRequest");
  assert.equal(out.hookSpecificOutput.decision.behavior, "allow");
});

test("permissionRequest allow with updatedInput carries it", () => {
  const out = decisionOutput("permissionRequest", "allow", "", { command: "echo hi" });
  assert.deepEqual(out.hookSpecificOutput.decision.updatedInput, { command: "echo hi" });
});

test("permissionRequest deny → behavior deny", () => {
  const out = decisionOutput("permissionRequest", "deny");
  assert.equal(out.hookSpecificOutput.decision.behavior, "deny");
});

test("permissionRequest ask → null (print nothing, Claude prompts)", () => {
  assert.equal(decisionOutput("permissionRequest", "ask"), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd bridge && node --test test/hookdecision.test.mjs`
Expected: FAIL — `Cannot find module '../lib/hookdecision.js'`.

- [ ] **Step 3: Write the implementation**

Create `bridge/lib/hookdecision.js`:

```js
// Channel-aware permission decision output.
// One held request can resolve as either a PreToolUse `permissionDecision`
// or a PermissionRequest `decision.behavior`. Returns the JSON to hand back to
// the hook shim, or `null` meaning "print nothing" (PermissionRequest + ask:
// let Claude Code show its own prompt).

export function decisionOutput(channel, decision, reason = "", updatedInput = null) {
  if (channel === "permissionRequest") {
    if (decision === "ask") return null; // passthrough → Claude's own prompt
    const d = { behavior: decision }; // "allow" | "deny"
    if (decision === "allow" && updatedInput) d.updatedInput = updatedInput;
    if (reason) d.message = reason;
    return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: d } };
  }
  // default: preToolUse
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision, // "allow" | "deny" | "ask"
      permissionDecisionReason: reason || "via Claude Control Bar",
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd bridge && node --test test/hookdecision.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire unit tests into `npm test`**

In `bridge/package.json`, change the `test` script from `node test/smoke.mjs` to run units first:

```json
"scripts": {
  "test": "node --test test/*.test.mjs && node test/smoke.mjs",
  "start": "node server.js",
  "cli": "node cli.mjs",
  "install-hooks": "node scripts/install-hooks.mjs",
  "uninstall-hooks": "node scripts/uninstall-hooks.mjs"
}
```
(Preserve any other existing script keys verbatim; only change `test`.)

- [ ] **Step 6: Run the full suite + commit**

Run: `cd bridge && npm test`
Expected: unit tests PASS, then `ALL 9 CHECKS PASSED ✓`.

```bash
git add bridge/lib/hookdecision.js bridge/test/hookdecision.test.mjs bridge/package.json
git commit -m "feat(bridge): channel-aware decision output (PreToolUse + PermissionRequest)"
```

---

### Task 3: `channel` + call-dedupe in the pending model

**Files:**
- Modify: `bridge/lib/pending.js`
- Create: `bridge/test/pending.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `hold({sessionId, cwd, tool, input, channel, respond, timeoutMs})` now stores `channel`; `list()` includes `channel`. New `findByCall(sessionId, tool, input)` returns the existing pending for the same call or `null` (dedupe key = `sessionId` + `tool` + `JSON.stringify(input)`). Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `bridge/test/pending.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import * as pending from "../lib/pending.js";

test("hold stores channel and exposes it via list()", () => {
  const id = pending.hold({
    sessionId: "s1", cwd: "/x", tool: "Bash", input: { command: "ls" },
    channel: "permissionRequest", respond: () => {}, timeoutMs: 60000,
  });
  const row = pending.list().find((p) => p.id === id);
  assert.equal(row.channel, "permissionRequest");
  pending.resolve(id, "deny");
});

test("findByCall matches same session+tool+input, ignores others", () => {
  const id = pending.hold({
    sessionId: "s2", cwd: "/x", tool: "Bash", input: { command: "rm -rf build" },
    channel: "preToolUse", respond: () => {}, timeoutMs: 60000,
  });
  assert.equal(pending.findByCall("s2", "Bash", { command: "rm -rf build" }).id, id);
  assert.equal(pending.findByCall("s2", "Bash", { command: "other" }), null);
  assert.equal(pending.findByCall("sX", "Bash", { command: "rm -rf build" }), null);
  pending.resolve(id, "deny");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd bridge && node --test test/pending.test.mjs`
Expected: FAIL — `row.channel` is `undefined` / `findByCall is not a function`.

- [ ] **Step 3: Write the implementation**

In `bridge/lib/pending.js`, add `channel` to the `hold` signature and stored record, and add `findByCall`. Replace the `hold` function and add the new export:

```js
export function hold({ sessionId, cwd, tool, input, channel, respond, timeoutMs }) {
  const id = randomUUID();
  const ms = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;

  const timer = setTimeout(() => {
    resolve(id, "ask", "timeout: fell back to Claude Code's own prompt");
  }, ms);
  if (typeof timer.unref === "function") timer.unref();

  pending.set(id, {
    id, sessionId, cwd, tool, input,
    channel: channel || "preToolUse",
    respond, timer, createdAt: Date.now(),
  });
  return id;
}

// Find an existing pending for the same tool call (session + tool + input),
// used to dedupe when both PreToolUse and PermissionRequest fire for one call.
export function findByCall(sessionId, tool, input) {
  const key = JSON.stringify(input || null);
  return (
    [...pending.values()].find(
      (p) => p.sessionId === sessionId && p.tool === tool && JSON.stringify(p.input || null) === key
    ) || null
  );
}
```

(The existing `list()` already spreads `...rest`, so `channel` flows through automatically. Leave `resolve`, `findBySession`, and `list` as-is.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd bridge && node --test test/pending.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add bridge/lib/pending.js bridge/test/pending.test.mjs
git commit -m "feat(bridge): track channel + findByCall dedupe in pending model"
```

---

### Task 4: Handle `PermissionRequest` in the session model

**Files:**
- Modify: `bridge/lib/sessions.js`
- Create: `bridge/test/sessions.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `upsertFromHook` sets `state="needs"` for a `PermissionRequest` event.

- [ ] **Step 1: Write the failing test**

Create `bridge/test/sessions.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import * as sessions from "../lib/sessions.js";

test("PermissionRequest event puts the session in 'needs'", () => {
  sessions.upsertFromHook({ session_id: "p1", hook_event_name: "SessionStart" });
  sessions.upsertFromHook({ session_id: "p1", hook_event_name: "PermissionRequest", tool_name: "Bash" });
  const s = sessions.all().find((x) => x.id === "p1");
  assert.equal(s.state, "needs");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd bridge && node --test test/sessions.test.mjs`
Expected: FAIL — state is `idle`/`working`, not `needs` (no `PermissionRequest` case yet).

- [ ] **Step 3: Write the implementation**

In `bridge/lib/sessions.js`, inside the `switch (event)` in `upsertFromHook`, add a case **before** `case "Notification":`:

```js
    case "PermissionRequest":
      existing.state = "needs";
      existing.tool = payload.tool_name || existing.tool;
      break;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd bridge && node --test test/sessions.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bridge/lib/sessions.js bridge/test/sessions.test.mjs
git commit -m "feat(bridge): PermissionRequest event drives 'needs' state"
```

---

### Task 5: Wire gating + dedupe + updatedInput into the server

**Files:**
- Modify: `bridge/server.js`
- Modify: `bridge/test/smoke.mjs`

**Interfaces:**
- Consumes: `decisionOutput` (Task 2), `findByCall` + `channel` (Task 3), `PermissionRequest` state (Task 4).
- Produces: `/hook` holds `PermissionRequest` events (always a gate) and `PreToolUse` events flagged `gate:true`, deduping the two for one call; `/decision` accepts optional `updatedInput`.

- [ ] **Step 1: Write the failing smoke checks**

In `bridge/test/smoke.mjs`, add a helper next to `sendGatedHook` (after line ~53):

```js
// Fire a PermissionRequest hook POST that BLOCKS; return its response promise.
function sendPermissionRequest(sessionId, command) {
  return fetch(base + "/hook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      cwd: "/tmp/scratch",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command },
      timeout_ms: 3000,
    }),
  }).then((r) => r.json());
}
```

Then, before the final `console.log(\`\nALL ${pass}...\`)`, add:

```js
    // 7. PermissionRequest holds and resolves with decision.behavior
    const heldPR = sendPermissionRequest("sess-2", "echo hi");
    await sleep(150);
    state = await api("/state");
    const pr = state.pending.find((p) => p.sessionId === "sess-2");
    ok(pr && pr.channel === "permissionRequest", "PermissionRequest is held with channel=permissionRequest");
    await api("/decision", "POST", { id: pr.id, decision: "allow", updatedInput: { command: "echo hi" } });
    const prOut = await heldPR;
    ok(prOut.hookSpecificOutput.decision.behavior === "allow", "PermissionRequest resolves with decision.behavior=allow");
    ok(prOut.hookSpecificOutput.decision.updatedInput.command === "echo hi", "PermissionRequest carries updatedInput");

    // 8. Dedupe: PreToolUse + PermissionRequest for the same call → one pending
    const a = sendGatedHook("sess-3", "ls -la");
    await sleep(80);
    const b = sendPermissionRequest("sess-3", "ls -la");
    await sleep(120);
    state = await api("/state");
    ok(
      state.pending.filter((p) => p.sessionId === "sess-3").length === 1,
      "PreToolUse + PermissionRequest for one call dedupe to a single pending"
    );
    const dupe = state.pending.find((p) => p.sessionId === "sess-3");
    await api("/decision", "POST", { id: dupe.id, decision: "deny" });
    await Promise.race([a, b]);
```

- [ ] **Step 2: Run smoke to verify it fails**

Run: `cd bridge && node test/smoke.mjs`
Expected: FAIL at check 7 — `PermissionRequest` isn't gated yet, so `heldPR` returns `{ok:true}` and `pr` is undefined.

- [ ] **Step 3: Implement the server changes**

In `bridge/server.js`:

(a) Add the import after the `pending` import (line ~24):

```js
import { decisionOutput } from "./lib/hookdecision.js";
```

(b) Replace `isPermissionGate` (lines ~93-95) so `PermissionRequest` always gates:

```js
function isPermissionGate(payload) {
  if (payload.hook_event_name === "PermissionRequest") return true;
  return payload.hook_event_name === "PreToolUse" && payload.gate === true;
}
```

(c) Delete the local `decisionOutput` function (lines ~97-106) — it's now imported.

(d) Replace the gate branch inside `POST /hook` (the `if (isPermissionGate(payload)) { … }` block) with a channel-aware, deduped version:

```js
    if (isPermissionGate(payload)) {
      const channel =
        payload.hook_event_name === "PermissionRequest" ? "permissionRequest" : "preToolUse";

      // Dedupe: if the other channel already holds this exact call, don't
      // double-prompt. Resolve THIS hook to passthrough so Claude proceeds via
      // the still-held request, and keep the single pending.
      const existing = pending.findByCall(payload.session_id, payload.tool_name, payload.tool_input);
      if (existing) {
        const out = decisionOutput(channel, "ask");
        if (out) return sendJSON(res, 200, out);
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": 2 });
        return res.end("{}");
      }

      const id = pending.hold({
        sessionId: payload.session_id,
        cwd: payload.cwd,
        tool: payload.tool_name,
        input: payload.tool_input,
        channel,
        timeoutMs: payload.timeout_ms,
        respond: (decision, reason, updatedInput) => {
          sessions.markNeeds(payload.session_id, false);
          appendEventLog({ dir: "decision", id, channel, decision, reason });
          const out = decisionOutput(channel, decision, reason, updatedInput);
          if (out) sendJSON(res, 200, out);
          else {
            res.writeHead(200, { "Content-Type": "application/json", "Content-Length": 2 });
            res.end("{}"); // passthrough: hook prints nothing
          }
          broadcast();
        },
      });
      sessions.markNeeds(payload.session_id, true);
      log(`held ${channel} request ${id} (${payload.tool_name})`);
      broadcast();
      return;
    }
```

(e) Update `resolve` call path: `pending.resolve` must forward `updatedInput`. In `POST /decision`, replace its body:

```js
  if (req.method === "POST" && pathname === "/decision") {
    const { id, decision, reason, updatedInput } = await readBody(req);
    if (!id || !["allow", "deny", "ask"].includes(decision)) {
      return sendJSON(res, 400, { error: "need {id, decision: allow|deny|ask}" });
    }
    const ok = pending.resolve(id, decision, reason, updatedInput);
    return sendJSON(res, ok ? 200 : 404, { ok });
  }
```

(f) In `bridge/lib/pending.js`, update `resolve` to pass `updatedInput` through to `respond`:

```js
export function resolve(id, decision, reason = "", updatedInput = null) {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  try {
    p.respond(decision, reason, updatedInput);
  } catch {
    // response already gone; nothing to do
  }
  return true;
}
```

(The timeout path calls `resolve(id, "ask", "...")` with no `updatedInput` → `null`, correct.)

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `cd bridge && npm test`
Expected: units PASS, then all smoke checks incl. the new 7 & 8 → `ALL 14 CHECKS PASSED ✓` (9 original + 5 new).

- [ ] **Step 5: Commit**

```bash
git add bridge/server.js bridge/lib/pending.js bridge/test/smoke.mjs
git commit -m "feat(bridge): gate PermissionRequest, dedupe channels, support updatedInput"
```

---

### Task 6: Teach the hook shim to gate PermissionRequest

**Files:**
- Modify: `bridge/hooks/cc-hook.mjs`

**Interfaces:**
- Consumes: bridge `/hook` gate behavior (Task 5).
- Produces: the shim blocks on `PermissionRequest` (always) and `PreToolUse` for watched tools; prints nothing when the bridge returns `{}` (passthrough) or on any failure (fail-open preserved).

- [ ] **Step 1: Update the gate predicate**

In `bridge/hooks/cc-hook.mjs`, replace the `isGate` line (~68):

```js
  const isGate =
    event === "PermissionRequest" ||
    (event === "PreToolUse" && GATE_TOOLS.includes(tool));
```

- [ ] **Step 2: Print nothing on passthrough**

In the `if (isGate) { … }` block (~84-89), replace the decision write so an empty/passthrough object prints nothing:

```js
    if (isGate) {
      const decision = await resp.json();
      // `{}` (or empty) = passthrough → print nothing, Claude prompts normally.
      if (decision && Object.keys(decision).length > 0) {
        process.stdout.write(JSON.stringify(decision));
      }
    }
```

- [ ] **Step 3: Manually verify fail-open is intact**

Run (bridge NOT running):
```bash
echo '{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"echo hi"}}' | node bridge/hooks/cc-hook.mjs; echo "exit=$?"
```
Expected: no stdout, `exit=0`.

- [ ] **Step 4: Commit**

```bash
git add bridge/hooks/cc-hook.mjs
git commit -m "feat(hook): gate PermissionRequest; print nothing on passthrough (fail-open intact)"
```

---

### Task 7: Register the full hook set incl. PermissionRequest

**Files:**
- Modify: `bridge/scripts/install-hooks.mjs`

**Interfaces:**
- Produces: `~/.claude/settings.json` gains a `PermissionRequest` hook with the long gate timeout, merged non-destructively (existing backup/merge/idempotent contract unchanged).

- [ ] **Step 1: Add the PermissionRequest entry**

In `bridge/scripts/install-hooks.mjs`, in the `OUR_HOOKS` object, add a `PermissionRequest` key (catch-all matcher, long timeout so we can hold it):

```js
  // The official permission channel — long timeout so we can hold it open.
  PermissionRequest: [{ hooks: [hookObj(GATE_TIMEOUT_S)] }],
```

- [ ] **Step 2: Verify the dry-run shows it, and uninstall removes it**

Run: `cd bridge && npm run install-hooks -- --dry`
Expected: the printed "after" hooks include a `PermissionRequest` entry pointing at `cc-hook.mjs`.

(Uninstall already keys off the `cc-hook.mjs` command via `isOurs`, so no change is needed there — confirm by reading `scripts/uninstall-hooks.mjs` and checking it iterates all events in `settings.hooks`. If it hardcodes an event list, add `PermissionRequest` to it.)

- [ ] **Step 3: Commit**

```bash
git add bridge/scripts/install-hooks.mjs
git commit -m "feat(hooks): register PermissionRequest in the global hook set"
```

---

### Task 8: Persisted session map (session_id ↔ tmux ↔ cwd)

**Files:**
- Create: `bridge/lib/session-map.js`
- Modify: `bridge/lib/paths.js`
- Modify: `bridge/server.js` (populate on SessionStart + tmux launch; surface in snapshot)
- Create: `bridge/test/session-map.test.mjs`

**Interfaces:**
- Produces: `set(sessionId, {tmux?, cwd?, project?})`, `get(sessionId)`, `all()`; persisted to `SESSION_MAP` (`~/.claude-control-bar/session-map.json`). Surfaced in `/state` as `snapshot().sessionMap`.

- [ ] **Step 1: Add the path**

In `bridge/lib/paths.js`, after the `EVENT_LOG` export (~line 20):

```js
// Persisted session_id ↔ {tmux, cwd, project} map (survives bridge restarts).
export const SESSION_MAP = path.join(CCBAR_DIR, "session-map.json");
```

- [ ] **Step 2: Write the failing test**

Create `bridge/test/session-map.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { SESSION_MAP } from "../lib/paths.js";
import * as map from "../lib/session-map.js";

test("set/get/all round-trips and merges", () => {
  try { fs.unlinkSync(SESSION_MAP); } catch {}
  map.reload();
  map.set("s1", { cwd: "/repo/a", project: "a" });
  map.set("s1", { tmux: "cc-1" }); // merge, don't clobber cwd
  assert.deepEqual(map.get("s1"), { cwd: "/repo/a", project: "a", tmux: "cc-1" });
  assert.ok(map.all().s1);
});

test("persists across a reload", () => {
  map.set("s2", { cwd: "/repo/b" });
  map.reload();
  assert.equal(map.get("s2").cwd, "/repo/b");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd bridge && node --test test/session-map.test.mjs`
Expected: FAIL — `Cannot find module '../lib/session-map.js'`.

- [ ] **Step 4: Write the implementation**

Create `bridge/lib/session-map.js`:

```js
// Persisted session_id ↔ {tmux, cwd, project} map. Lets the app label sessions
// and route to the right tmux target across bridge restarts. Best-effort I/O.

import fs from "node:fs";
import { SESSION_MAP, ensureDir } from "./paths.js";

let cache = load();

function load() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_MAP, "utf8")) || {};
  } catch {
    return {};
  }
}

function save() {
  try {
    ensureDir();
    fs.writeFileSync(SESSION_MAP, JSON.stringify(cache, null, 2));
  } catch {
    /* best effort */
  }
}

export function reload() {
  cache = load();
  return cache;
}

export function set(sessionId, fields) {
  if (!sessionId) return;
  cache[sessionId] = { ...(cache[sessionId] || {}), ...fields };
  save();
}

export function get(sessionId) {
  return cache[sessionId] || null;
}

export function all() {
  return { ...cache };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd bridge && node --test test/session-map.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Populate + surface it in the server**

In `bridge/server.js`:

(a) Import after the sessions import:

```js
import * as sessionMap from "./lib/session-map.js";
```

(b) In `snapshot()`, add the map:

```js
function snapshot() {
  return {
    sessions: sessions.all(),
    pending: pending.list(),
    aggregate: sessions.aggregateState(),
    sessionMap: sessionMap.all(),
    ts: Date.now(),
  };
}
```

(c) In `POST /hook`, right after `sessions.upsertFromHook(payload);`, record cwd/project:

```js
    if (payload.session_id && payload.cwd) {
      sessionMap.set(payload.session_id, {
        cwd: payload.cwd,
        project: payload.cwd.split("/").filter(Boolean).pop() || null,
      });
    }
```

(d) In `POST /tmux/launch`, after `sessions.registerOwned(...)`, record the tmux target:

```js
      sessionMap.set(info.name, { cwd, tmux: info.name, project: (cwd || "").split("/").filter(Boolean).pop() || null });
```

- [ ] **Step 7: Run the full suite + commit**

Run: `cd bridge && npm test`
Expected: all unit suites PASS, then `ALL 14 CHECKS PASSED ✓`.

```bash
git add bridge/lib/session-map.js bridge/lib/paths.js bridge/server.js bridge/test/session-map.test.mjs
git commit -m "feat(bridge): persisted session_id ↔ tmux ↔ cwd map, surfaced in /state"
```

---

## Self-Review

**Spec coverage (against the Phase 1 spec §5 bridge-side slices):**
- Slice 0 capture + tmux confirm → Task 1. ✅
- PermissionRequest primary + PreToolUse fallback (D2) → Tasks 2, 5, 6, 7. ✅
- First-responder-wins / bounded wait (D3) → preserved (timeout untouched; dedupe passthrough) — Tasks 3, 5. ✅
- `updatedInput` structured answers → Tasks 2, 5. ✅
- `session_id` join key + session map → Task 8. ✅
- Full hook set + consented install (bridge portion) → Task 7 (the in-app consent UI is app-side, deferred to the app plan). ✅
- Keep 9 smoke checks green → asserted at Tasks 2, 5, 8. ✅

**Deferred to the app plan (not this subsystem):** Slices 1A–1F Swift work (supervisor, client, list UI, glyph, notifications, Allow/Deny surface). Requires Xcode + Task 1's captured payloads.

**Placeholder scan:** none — every code step shows complete code; every run step shows the command + expected result.

**Type/name consistency:** `decisionOutput(channel, decision, reason, updatedInput)` signature identical across Tasks 2 and 5; `respond(decision, reason, updatedInput)` consistent across pending.js (Task 3/5) and server.js (Task 5); `channel` values `"preToolUse"|"permissionRequest"` consistent throughout; `findByCall(sessionId, tool, input)` consistent Tasks 3 & 5; `set/get/all/reload` consistent Task 8.

**Note for the implementer:** Task 1 is authoritative for the exact `PermissionRequest` decision JSON. If the live payload shows a different shape than Global Constraints, adjust **only** `lib/hookdecision.js` (Task 2) and the two smoke assertions in Task 5 — nothing else depends on the wire shape.
