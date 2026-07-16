#!/usr/bin/env node
// Claude Control Bar — Phase 0 local bridge.
//
// A tiny, dependency-free HTTP server bound to 127.0.0.1. It:
//   • ingests Claude Code hook events into an in-memory session model
//   • HOLDS permission requests open until a decision arrives (or times out)
//   • serves state over GET /state and an SSE stream at GET /events
//   • owns tmux sessions (create / send-keys / attach / continue)
//
// Nothing here is production-hard — it exists to prove the loop and capture
// real hook payload shapes for Phase 1.

import http from "node:http";
import fs from "node:fs";
import { URL } from "node:url";

import {
  ensureDir,
  writePort,
  readPort,
  EVENT_LOG,
} from "./lib/paths.js";
import * as sessions from "./lib/sessions.js";
import * as pending from "./lib/pending.js";
import * as sessionMap from "./lib/session-map.js";
import * as usage from "./lib/usage.js";
import * as autoresume from "./lib/autoresume.js";
import * as transcript from "./lib/transcript.js";
import { decisionOutput } from "./lib/hookdecision.js";
import * as tmux from "./scripts/tmux.mjs";
import * as revealer from "./scripts/reveal.mjs";

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.CCBAR_PORT || "0", 10); // 0 = random free port

const sseClients = new Set();

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(line);
}

function appendEventLog(obj) {
  try {
    ensureDir();
    fs.appendFileSync(EVENT_LOG, JSON.stringify(obj) + "\n");
  } catch {
    /* best effort */
  }
}

function snapshot() {
  return {
    sessions: sessions.all(),
    pending: pending.list(),
    aggregate: sessions.aggregateState(),
    sessionMap: sessionMap.all(),
    usage: usage.get(),
    autoResume: autoresume.list(),
    autoResumeGlobal: autoresume.globalEnabled(),
    ts: Date.now(),
  };
}

function broadcast() {
  const data = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({ _raw: raw });
      }
    });
  });
}

// Is this hook event a permission gate we should hold open?
// PermissionRequest (the official approval channel) always gates. PreToolUse
// gates only when the hook shim flags it (`gate: true`) for a watched tool, so
// ordinary PreToolUse events still flow straight through.
function isPermissionGate(payload) {
  // bypassPermissions = the user explicitly opted out of prompts; gating there is
  // pointless and would stall the session (and any controlling agent session).
  if (payload.permission_mode === "bypassPermissions") return false;
  if (payload.hook_event_name === "PermissionRequest") return true;
  return payload.hook_event_name === "PreToolUse" && payload.gate === true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const { pathname } = url;

  // --- Health ------------------------------------------------------------
  if (req.method === "GET" && pathname === "/health") {
    return sendJSON(res, 200, { ok: true, ts: Date.now() });
  }

  // --- Live state --------------------------------------------------------
  if (req.method === "GET" && pathname === "/state") {
    return sendJSON(res, 200, snapshot());
  }

  // --- SSE stream --------------------------------------------------------
  if (req.method === "GET" && pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // --- Hook ingest -------------------------------------------------------
  if (req.method === "POST" && pathname === "/hook") {
    const payload = await readBody(req);
    appendEventLog({ dir: "in", payload });
    sessions.upsertFromHook(payload);
    if (payload.session_id && payload.cwd) {
      sessionMap.set(payload.session_id, {
        cwd: payload.cwd,
        project: payload.cwd.split("/").filter(Boolean).pop() || null,
      });
    }

    // A permission gate: hold the response open until a decision arrives.
    if (isPermissionGate(payload)) {
      const channel =
        payload.hook_event_name === "PermissionRequest" ? "permissionRequest" : "preToolUse";

      // Dedupe: if the other channel already holds this exact call, don't
      // double-prompt. Resolve THIS hook to passthrough and keep the one pending.
      const existing = pending.findByCall(
        payload.session_id,
        payload.tool_name,
        payload.tool_input
      );
      if (existing) {
        const out = decisionOutput(channel, "ask");
        if (out) return sendJSON(res, 200, out);
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": 2 });
        return res.end("{}");
      }

      // Read Claude's last message so the UI can show what you're approving.
      const context = payload.transcript_path
        ? transcript.lastAssistantText(payload.transcript_path)
        : null;
      if (context) sessions.setLastLine(payload.session_id, context);

      const id = pending.hold({
        sessionId: payload.session_id,
        cwd: payload.cwd,
        tool: payload.tool_name,
        input: payload.tool_input,
        channel,
        context,
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
      return; // response deliberately NOT sent yet
    }

    // Non-gate events: acknowledge immediately.
    broadcast();
    return sendJSON(res, 200, { ok: true });
  }

  // --- Decision (Allow / Deny from the UI) -------------------------------
  if (req.method === "POST" && pathname === "/decision") {
    const { id, decision, reason, updatedInput } = await readBody(req);
    if (!id || !["allow", "deny", "ask"].includes(decision)) {
      return sendJSON(res, 400, { error: "need {id, decision: allow|deny|ask}" });
    }
    const ok = pending.resolve(id, decision, reason, updatedInput);
    return sendJSON(res, ok ? 200 : 404, { ok });
  }

  // --- tmux: launch an Owned session -------------------------------------
  if (req.method === "POST" && pathname === "/tmux/launch") {
    const { cwd, name, flags } = await readBody(req);
    try {
      const info = await tmux.launch({ cwd, name, flags });
      sessions.registerOwned(info.name, { cwd, tmux: info.name });
      sessionMap.set(info.name, {
        cwd,
        tmux: info.name,
        project: (cwd || "").split("/").filter(Boolean).pop() || null,
      });
      broadcast();
      return sendJSON(res, 200, info);
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) });
    }
  }

  // --- tmux: send a short input / nudge ----------------------------------
  if (req.method === "POST" && pathname === "/tmux/send") {
    const { name, text } = await readBody(req);
    try {
      await tmux.sendKeys(name, text);
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) });
    }
  }

  // --- auto-resume toggle (Owned sessions) -------------------------------
  if (req.method === "POST" && pathname === "/autoresume") {
    const { name, on, global } = await readBody(req);
    if (typeof global === "boolean") autoresume.setGlobal(global);
    else autoresume.setEnabled(name, !!on);
    broadcast();
    return sendJSON(res, 200, {
      ok: true,
      enabled: autoresume.list(),
      global: autoresume.globalEnabled(),
    });
  }

  // --- usage: statusline rate_limits ingest ------------------------------
  if (req.method === "POST" && pathname === "/usage") {
    const body = await readBody(req);
    usage.set(body);
    // The statusline payload carries a friendly session name — capture it.
    if (body.session_id && body.session_name) {
      sessions.setName(body.session_id, body.session_name);
      sessionMap.set(body.session_id, { name: body.session_name });
    }
    broadcast();
    return sendJSON(res, 200, { ok: true });
  }

  // --- reveal: jump to a session's terminal ------------------------------
  if (req.method === "POST" && pathname === "/reveal") {
    const { sessionId, session, tier, app, pid } = await readBody(req);
    // The bridge is authoritative for a session's terminal identity: look up the
    // stored tier / tmux target / tty / terminalApp captured from its hooks.
    const s = sessionId ? sessions.get(sessionId) : null;
    try {
      const r = await revealer.reveal({
        tier: tier || s?.tier,
        session: session || s?.tmux,
        app: app || s?.terminalApp,
        tty: s?.tty,
        pid: pid || s?.pid,
      });
      return sendJSON(res, 200, r);
    } catch (e) {
      return sendJSON(res, 500, { error: String(e.message || e) });
    }
  }

  sendJSON(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  const { port } = server.address();
  writePort(port);
  log(`bridge listening on http://${HOST}:${port}`);
  log(`port written to ${readPort() === port ? "port file ✓" : "port file ✗"}`);
  log(`event log: ${EVENT_LOG}`);
  // Best-effort: surface sessions already running before our hooks installed.
  try {
    const found = process.env.CCBAR_NO_DISCOVER ? [] : transcript.discoverSessions();
    for (const s of found) sessions.registerDiscovered(s);
    if (found.length) log(`discovered ${found.length} existing session(s) from transcripts`);
  } catch {
    /* best effort */
  }
});

// Heartbeat keeps SSE connections warm.
const hb = setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(": ping\n\n");
    } catch {
      sseClients.delete(res);
    }
  }
}, 15_000);
if (typeof hb.unref === "function") hb.unref();

// Auto-resume poll: no hook fires on a usage-limit pause, so we capture the pane
// of enabled Owned sessions and, on a limit banner, schedule a `continue` at the
// reset time (from the statusline rate_limits resets_at).
const arPoll = setInterval(async () => {
  // Owned sessions with auto-resume on (per-session opt-in OR the global switch).
  const owned = sessions
    .all()
    .filter((s) => s.tier === "owned")
    .map((s) => s.tmux || s.id);
  const names = owned.filter((n) => autoresume.shouldResume(n));
  if (!names.length) return;
  if (!(await tmux.hasTmux())) return;
  const u = usage.get();
  for (const name of names) {
    if (autoresume.isScheduled(name)) continue;
    const pane = await tmux.capturePane(name);
    if (autoresume.detectLimit(pane)) {
      sessions.setState(name, "paused");
      const resetsAt = u?.fiveHour?.resets_at;
      if (resetsAt) autoresume.scheduleResume(name, resetsAt);
      broadcast();
    }
  }
}, 20_000);
if (typeof arPoll.unref === "function") arPoll.unref();

process.on("SIGINT", () => {
  log("shutting down");
  server.close(() => process.exit(0));
});
