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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";

import {
  writePort,
  readPort,
  releasePort,
  ensureDir,
  CCBAR_DIR,
  EVENT_LOG,
} from "./lib/paths.js";
import * as eventlog from "./lib/eventlog.js";
import * as atlasEngine from "./lib/atlas-engine.js";
import * as slicer from "./lib/slicer.js";
import * as marks from "./lib/marks.js";
import * as titles from "./lib/titles.js";
import * as notes from "./lib/notes.js";
import { isAllowedOrigin, requiresOriginCheck } from "./lib/origin.js";
import { summarise } from "./lib/stats.js";
import { buildForkPlan } from "./lib/fork.js";
import * as sessions from "./lib/sessions.js";
import * as dismissed from "./lib/dismissed.js";
import * as pending from "./lib/pending.js";
import * as sessionMap from "./lib/session-map.js";
import * as usage from "./lib/usage.js";
import * as usagePoll from "./lib/usage-poll.js";
import * as autoresume from "./lib/autoresume.js";
import * as transcript from "./lib/transcript.js";
import { decisionOutput } from "./lib/hookdecision.js";
import * as tmux from "./scripts/tmux.mjs";
import * as revealer from "./scripts/reveal.mjs";

// The Atlas is a single static page: no build step, no bundler, no dependency —
// it talks to /atlas/api/* with fetch. See D1.
const ATLAS_PAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "atlas",
  "index.html"
);

function sendAtlasPage(res) {
  let html;
  try {
    html = fs.readFileSync(ATLAS_PAGE);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    return res.end("Atlas page missing from this build.");
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": html.length,
    "Cache-Control": "no-store",
  });
  res.end(html);
}

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.CCBAR_PORT || "0", 10); // 0 = random free port

const sseClients = new Set();

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(line);
}

// Redacted, size-capped, rotating, and ASYNC — it sits on the permission hot
// path, so a slow disk must never stall a held tool call. See lib/eventlog.js.
const appendEventLog = eventlog.append;

// Reconcile "needs" before every snapshot, so a stale badge cannot survive even
// one read of /state.
//
// Only sessions ALREADY in "needs" are statted — usually none, at most a
// handful — so this stays cheap on a path that runs on every SSE broadcast.
function sweepNeeds() {
  const needy = sessions.all().filter((s) => s.state === "needs");
  if (!needy.length) return [];

  const pendingIds = new Set(pending.list().map((p) => p.sessionId).filter(Boolean));

  // A transcript that advanced after the session started needing us is the
  // precise signal that it was answered in the terminal — far better than a
  // timeout, which is only the backstop for a session that died outright.
  const activityAt = new Map();
  for (const s of needy) {
    if (pendingIds.has(s.id)) continue; // deterministic already, no stat needed
    try {
      const fp = slicer.findTranscript(s.id);
      if (fp) activityAt.set(s.id, fs.statSync(fp).mtimeMs);
    } catch { /* no transcript found — fall back to the TTL */ }
  }

  const cleared = sessions.sweepStaleNeeds({ pendingIds, activityAt });
  if (cleared.length) log(`cleared ${cleared.length} stale needs: ${cleared.join(", ")}`);
  return cleared;
}

// Fork seeds are read once, seconds after they are written. Anything still
// here from a previous run is litter — and it is plaintext conversation, so it
// should not sit on disk indefinitely.
const FORK_SEED_TTL_MS = 60 * 60 * 1000;
function sweepOldForkSeeds() {
  try {
    const cutoff = Date.now() - FORK_SEED_TTL_MS;
    for (const f of fs.readdirSync(CCBAR_DIR)) {
      if (!f.startsWith("fork-") || !f.endsWith(".md")) continue;
      const fp = path.join(CCBAR_DIR, f);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
      } catch { /* raced with something else, fine */ }
    }
  } catch { /* directory unreadable — not worth failing a fork over */ }
}

function snapshot() {
  sweepNeeds();
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

  // Nothing on the web may drive this bridge. It listens on loopback with no
  // authentication, and a text/plain POST is a CORS simple request — no
  // preflight — so without this any page the user visited could approve a held
  // permission, start a fork or drive a reveal, blind. Hooks, the CLI and the
  // native app send no Origin at all, which is allowed; a foreign one is not.
  if (requiresOriginCheck(req.method) && !isAllowedOrigin(req.headers.origin)) {
    return sendJSON(res, 403, {
      ok: false,
      error: "Refused: this request did not come from Footprint.",
    });
  }

  // --- Health ------------------------------------------------------------
  if (req.method === "GET" && pathname === "/health") {
    return sendJSON(res, 200, { ok: true, ts: Date.now() });
  }

  // --- The Atlas ---------------------------------------------------------
  // Added BESIDE the Bar's endpoints, never on top of them (D4). Every handler
  // delegates to a worker thread, so a 750ms parse of the corpus never stalls a
  // held permission request on this loop (D2).
  if (req.method === "GET" && pathname === "/atlas") {
    return sendAtlasPage(res);
  }
  if (req.method === "GET" && pathname.startsWith("/atlas/api/")) {
    const op = pathname.slice("/atlas/api/".length);
    try {
      if (op === "sessions") return sendJSON(res, 200, await atlasEngine.listSessions());
      if (op === "tree") {
        return sendJSON(res, 200, await atlasEngine.getTree(url.searchParams.get("id")));
      }
      if (op === "node") {
        return sendJSON(res, 200, await atlasEngine.getNode(
          url.searchParams.get("session"), url.searchParams.get("uuid")));
      }
      if (op === "search") {
        const q = url.searchParams.get("q") || "";
        const limit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
        // Scoping contract (see lib/atlas.js search()):
        //   project  — restrict to one project, by name
        //   scope    — "all" (default here; the Atlas is a browser with no
        //              ambient project) or "project" with `project` set
        //   groupBySession — collapse a session's many hits into one row
        return sendJSON(res, 200, await atlasEngine.search(q, {
          limit,
          project: url.searchParams.get("project") || null,
          scope: url.searchParams.get("scope") || "all",
          groupBySession: url.searchParams.get("group") !== "0",
        }));
      }
      if (op === "slice") {
        const ref = url.searchParams.get("ref") || "";
        return sendJSON(res, 200, slicer.sliceFor(ref));
      }
      // The whole corpus in one answer. Both halves are pure functions over the
      // session list the engine already builds, so this costs one listSessions
      // and no extra parsing.
      if (op === "notes") {
        return sendJSON(res, 200, {
          ok: true,
          notes: notes.forSession(url.searchParams.get("session") || ""),
        });
      }
      if (op === "forest") {
        const d = await atlasEngine.listSessions();
        const list = d.sessions || [];
        return sendJSON(res, 200, {
          ok: true,
          stats: summarise(list),
          sessions: list.map((x) => ({
            id: x.id, project: x.project, title: x.title, turns: x.turns,
            branches: x.branches, compactions: x.compactions, updatedAt: x.updatedAt,
          })),
        });
      }
      if (op === "marks") {
        return sendJSON(res, 200, { marks: marks.list(url.searchParams.get("session") || undefined) });
      }
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: String(e?.message || e) });
    }
    return sendJSON(res, 404, { ok: false, error: `Unknown Atlas endpoint: ${op}` });
  }
  // Rename a session. Written to OUR sidecar — ~/.claude stays read-only.
  if (req.method === "POST" && pathname === "/atlas/api/rename") {
    const { session, name } = await readBody(req);
    try {
      const applied = titles.set(session, name);
      titles.flush();
      return sendJSON(res, 200, { ok: true, title: applied });
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: String(e?.message || e) });
    }
  }

  // Reply to a past conversation: open a terminal running `claude --resume <id>`
  // in that session's own directory, so the context is already loaded.
  if (req.method === "POST" && pathname === "/atlas/api/resume") {
    const { session, cwd, terminal } = await readBody(req);
    if (!session) return sendJSON(res, 400, { ok: false, error: "need {session}" });
    try {
      if (!(await tmux.hasTmux())) {
        return sendJSON(res, 200, {
          ok: false,
          error: "tmux is not installed — Footprint uses it to own a session it can reply to.",
          command: `claude --resume ${session}`,
        });
      }
      const info = await tmux.launch({ cwd, flags: { resume: session }, terminal });
      await revealer.reveal({ tier: "owned", session: info.name, app: terminal, cwd });
      return sendJSON(res, 200, { ok: true, ...info });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: String(e?.message || e) });
    }
  }

  if (req.method === "POST" && pathname === "/atlas/api/mark") {
    const { session, uuid, label } = await readBody(req);
    try {
      const m = marks.add({ sessionId: session, uuid, label });
      marks.flush();
      return sendJSON(res, 200, { ok: true, mark: m });
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: String(e?.message || e) });
    }
  }

  // --- notes: a sentence about why a turn mattered -----------------------
  // Separate from marks on purpose: a mark is a label you quote by, a note is
  // the reason, and one cap must not truncate the other.
  if (req.method === "POST" && pathname === "/atlas/api/note") {
    const { session, uuid, text } = await readBody(req);
    try {
      const saved = notes.set(session, uuid, text);
      return sendJSON(res, 200, { ok: true, note: saved });
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: String(e?.message || e) });
    }
  }

  // --- fork: a new session carrying everything up to one ask -------------
  // A REPLAY, not a resume — the CLI can only fork from the END of a session
  // and the SDK route needs node_modules. See lib/fork.js. The original
  // session is never opened for writing.
  if (req.method === "POST" && pathname === "/atlas/api/fork") {
    const { session, uuid, cwd, terminal } = await readBody(req);
    if (!session || !uuid) return sendJSON(res, 400, { ok: false, error: "need {session, uuid}" });
    try {
      const sliced = slicer.sliceFor(`node://${session}/${uuid}`);
      if (!sliced.ok) return sendJSON(res, 400, { ok: false, error: sliced.error });

      const plan = buildForkPlan({
        sessionId: session, uuid, cwd,
        slice: sliced.markdown, turns: sliced.turns,
      });
      if (!plan.ok) return sendJSON(res, 400, plan);

      if (!(await tmux.hasTmux())) {
        return sendJSON(res, 200, {
          ok: false,
          error: "tmux is not installed — Footprint uses it to own the forked session.",
        });
      }

      // The seed goes to a file, not down a pipe of keystrokes.
      //
      // These accumulate: each is up to 90KB of verbatim conversation, and
      // nothing was ever deleting them. Sweep old ones on the way in — the file
      // is only needed for the instant it takes tmux to start claude. A
      // millisecond timestamp also collided for two forks in the same tick, so
      // the name carries randomness too.
      ensureDir();
      sweepOldForkSeeds();
      const seedPath = path.join(
        CCBAR_DIR,
        `fork-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.md`
      );
      fs.writeFileSync(seedPath, plan.seed, "utf8");

      const info = await tmux.launch({ cwd: plan.cwd, flags: { promptFile: seedPath }, terminal });
      await revealer.reveal({ tier: "owned", session: info.name, app: terminal, cwd: plan.cwd });
      return sendJSON(res, 200, {
        ok: true, ...info, turns: plan.turns, truncated: plan.truncated,
      });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: String(e?.message || e) });
    }
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
          // "ask" means we fell through to Claude Code's own prompt — the
          // session is still blocked on the user, so it must STAY in Needs you.
          sessions.resolveNeeds(payload.session_id, decision);
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
    const { cwd, name, flags, terminal } = await readBody(req);
    try {
      // No placeholder row: the session appears (as Owned) when claude's own
      // hooks fire, linked via the tmux env vars — one row, not two.
      const info = await tmux.launch({ cwd, name, flags, terminal });
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

  // --- dismiss: remove an (idle) session from the list -------------------
  if (req.method === "POST" && pathname === "/dismiss") {
    const { sessionId } = await readBody(req);
    if (!sessionId) return sendJSON(res, 400, { error: "need {sessionId}" });
    dismissed.add(sessionId);
    sessions.remove(sessionId);
    log(`dismissed ${sessionId}`);
    broadcast();
    return sendJSON(res, 200, { ok: true });
  }

  // --- reveal: jump to a session's terminal ------------------------------
  if (req.method === "POST" && pathname === "/reveal") {
    const { sessionId, session, tier, app, pid, cwd } = await readBody(req);
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
        cwd: cwd || s?.cwd,
      });
      appendEventLog({ dir: "reveal", sessionId, app: app || s?.terminalApp, tty: s?.tty, result: r });
      log(`reveal ${sessionId || session || "?"} → ${r.method} (${r.reliable ? "reliable" : "best-effort"})`);
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

  // Re-adopt owned tmux sessions still alive from a previous bridge run.
  // An idle owned session fires no hooks, so nothing else would re-register it.
  (async () => {
    try {
      if (process.env.CCBAR_NO_DISCOVER) return;
      const owned = await tmux.listOwned();
      for (const o of owned) {
        sessions.registerOwned(o.name, { cwd: o.cwd, tmux: o.name, terminalApp: o.terminal });
      }
      if (owned.length) {
        log(`re-adopted ${owned.length} owned tmux session(s)`);
        broadcast();
      }
    } catch {
      /* best effort */
    }
  })();

  // Real-time usage: poll the account usage API (authoritative) every 60s.
  if (!process.env.CCBAR_NO_USAGE_POLL) {
    usagePoll.start({
      intervalMs: 60_000,
      onResult: (r) => {
        appendEventLog({ dir: "usage-poll", result: r });
        if (r.ok) {
          log(`usage poll: 5h ${Math.round(r.fiveHour)}% · weekly ${Math.round(r.sevenDay)}%`);
          broadcast();
        } else {
          log(`usage poll: ${r.reason} (falling back to statusline)`);
        }
      },
    });
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

function shutdown() {
  log("shutting down");
  sessionMap.flush(); // a coalesced write may still be pending
  marks.flush();
  titles.flush();
  notes.flush(); // coalesced at 800ms — a note typed just before quit would be lost
  atlasEngine.shutdown();
  // Give up our claim on the port so the next reader is not sent to a ghost.
  releasePort();

  // SSE connections never end on their own, and server.close() waits for every
  // open connection — so with the app attached, shutdown hung forever. The
  // result was a zombie: listener closed, port released, process alive, and the
  // menu-bar app pinned to a bridge that accepts nothing. Observed in the wild.
  for (const res of sseClients) {
    try { res.end(); } catch { /* already gone */ }
  }
  sseClients.clear();

  server.close(() => process.exit(0));

  // Belt and braces: if anything else is still holding a socket, do not hang
  // around. A bridge that will not die is worse than one that exits abruptly.
  const bail = setTimeout(() => process.exit(0), 3000);
  if (typeof bail.unref === "function") bail.unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
