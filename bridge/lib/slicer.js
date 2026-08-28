// Turns a reference into quotable markdown. This is the whole differentiator:
//
//   "root-cause"              ─┐
//   "node://<session>/<uuid>" ─┴─▶ locate transcript ─▶ build tree
//                                       ─▶ walk parentUuid to root
//                                       ─▶ render markdown
//
// Locating is depth-2 only, deliberately. Of 628 .jsonl files in the real corpus
// just 45 are sessions; the rest are subagent transcripts nested under
// <session>/subagents/. A recursive search would resolve an agent file as if it
// were a session. See docs/schema-findings.md §0.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTree, pathToRoot, conversationOnly } from "./tree.js";
import { renderSlice } from "./slice.js";
import * as marks from "./marks.js";

const PROJECTS = () =>
  process.env.CCBAR_PROJECTS || path.join(os.homedir(), ".claude", "projects");

// <projects>/<project>/<sessionId>.jsonl — one level down, never deeper.
export function findTranscript(sessionId) {
  if (!sessionId) return null;
  const root = PROJECTS();
  let dirs;
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const fp = path.join(root, d, `${sessionId}.jsonl`);
    try {
      if (fs.statSync(fp).isFile()) return fp;
    } catch {
      /* not here */
    }
  }
  return null;
}

// Log-and-skip on malformed lines: 29 CLI versions write these files and a live
// session's last line can be half-written.
export function readSession(fp) {
  let text;
  try {
    text = fs.readFileSync(fp, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return out;
}

export function sliceFor(refOrLabel, { sessionId, maxCharsPerTurn } = {}) {
  if (!refOrLabel || typeof refOrLabel !== "string") {
    return { ok: false, error: "A reference is required, e.g. node://<session>/<uuid> or a mark label." };
  }

  // A bare label resolves through the marks sidecar; a node:// ref is direct.
  let target = marks.parseRef(refOrLabel);
  if (!target) {
    const mark = marks.resolve(refOrLabel, sessionId);
    if (mark) target = { sessionId: mark.sessionId, uuid: mark.uuid };
  }
  if (!target) {
    return {
      ok: false,
      error: `Could not parse "${refOrLabel}" as a node reference, and no mark with that label exists.`,
    };
  }

  const fp = findTranscript(target.sessionId);
  if (!fp) {
    return { ok: false, error: `No session transcript found for "${target.sessionId}".` };
  }

  const tree = buildTree(readSession(fp));
  if (!tree.byUuid.has(target.uuid)) {
    return { ok: false, error: `Node "${target.uuid}" not found in session ${target.sessionId}.` };
  }

  const nodes = conversationOnly(pathToRoot(tree, target.uuid));
  const ref = marks.formatRef(target.sessionId, target.uuid);
  const mark = marks.resolve(ref);

  return {
    ok: true,
    ref,
    sessionId: target.sessionId,
    uuid: target.uuid,
    label: mark?.label ?? null,
    turns: nodes.length,
    markdown: renderSlice({ nodes, sessionId: target.sessionId, ref, maxCharsPerTurn }),
  };
}
