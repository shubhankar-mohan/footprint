// Runs lib/atlas.js inside a worker thread. Nothing here touches the bridge's
// event loop — that is the entire point of the file.
//
// Measured on the real corpus, a cold listSessions is ~750ms and a getTree on
// the largest session ~700ms. On the main thread that would stall held
// permission requests, and cc-hook.mjs waits up to 57s rather than failing open
// when the bridge is slow rather than dead (D2).

import { parentPort, workerData } from "node:worker_threads";
import * as atlas from "./atlas.js";

// The worker starts with its own env copy; carry the overrides across so tests
// and a custom CCBAR_DIR behave identically on both sides of the boundary.
if (workerData?.env) {
  for (const [k, v] of Object.entries(workerData.env)) {
    if (v !== undefined) process.env[k] = v;
  }
}

const OPS = {
  listSessions: () => atlas.listSessions(),
  getTree: (args) => atlas.getTree(args?.sessionId),
  getNode: (args) => atlas.getNode(args?.sessionId, args?.uuid),
  search: (args) => atlas.search(args?.query, { limit: args?.limit }),
};

parentPort.on("message", async (msg) => {
  const { id, op, args } = msg || {};
  try {
    const fn = OPS[op];
    if (!fn) throw new Error(`Unknown op: ${op}`);
    parentPort.postMessage({ id, ok: true, result: await fn(args) });
  } catch (e) {
    // Never let a bad request kill the worker — the bridge would lose the Atlas
    // for the rest of its run.
    parentPort.postMessage({ id, ok: false, error: String(e?.message || e) });
  }
});
