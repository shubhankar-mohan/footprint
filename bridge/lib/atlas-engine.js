// Main-thread client for the Atlas worker.
//
//   bridge (event loop)          worker thread
//   ───────────────────          ─────────────
//   listSessions() ──postMessage──▶ parse 43 sessions (~750ms)
//        │                             │
//        └──────────◀──postMessage─────┘
//
// The bridge keeps answering hook POSTs and holding permission requests open
// the whole time. Worker threads are built into Node, so this costs no
// dependency (D1) and satisfies D2.
//
// The worker is started lazily on first use — a Bar user who never opens the
// Atlas pays nothing for it.

import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "atlas-worker.mjs");

let worker = null;
let nextId = 1;
const inflight = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(WORKER, {
    workerData: {
      env: {
        CCBAR_PROJECTS: process.env.CCBAR_PROJECTS,
        CCBAR_DIR: process.env.CCBAR_DIR,
      },
    },
  });
  // Deliberately NOT unref'd. An unref'd worker is torn down whenever the main
  // loop briefly drains, which happens between test cases and would happen
  // between idle HTTP requests too — the next call then lands on a dead thread.
  // The worker is started lazily, so a Bar-only user never spawns one; once it
  // exists, shutdown() is what ends it.

  worker.on("message", (msg) => {
    const pending = inflight.get(msg?.id);
    if (!pending) return;
    inflight.delete(msg.id);
    pending.resolve(msg.ok ? msg.result : { ok: false, error: msg.error });
  });

  // If the worker dies, fail every waiter rather than hanging them forever, and
  // drop the handle so the next call starts a fresh one.
  const die = (why) => {
    for (const [, p] of inflight) p.resolve({ ok: false, error: `Atlas worker ${why}` });
    inflight.clear();
    worker = null;
  };
  worker.on("error", (e) => die(`failed: ${e?.message || e}`));
  worker.on("exit", (code) => {
    if (code !== 0) die(`exited with code ${code}`);
    else worker = null;
  });

  return worker;
}

function post(op, args) {
  return new Promise((resolve) => {
    const w = ensureWorker();
    const id = nextId++;
    inflight.set(id, { resolve });
    try {
      w.postMessage({ id, op, args });
    } catch (e) {
      inflight.delete(id);
      resolve({ ok: false, error: String(e?.message || e) });
    }
  });
}

// A worker that died between calls should not surface as a user-visible error:
// drop the dead handle and try once more on a fresh thread.
async function call(op, args) {
  const first = await post(op, args);
  const died =
    first && first.ok === false && typeof first.error === "string" &&
    /Atlas worker (failed|exited)/.test(first.error);
  if (!died) return first;
  worker = null;
  return post(op, args);
}

export const listSessions = () => call("listSessions");
export const getTree = (sessionId) => call("getTree", { sessionId });
export const getNode = (sessionId, uuid) => call("getNode", { sessionId, uuid });
export const search = (query, opts = {}) => call("search", { query, limit: opts.limit });

export async function shutdown() {
  if (!worker) return;
  const w = worker;
  worker = null;
  try {
    await w.terminate();
  } catch {
    /* already gone */
  }
}
