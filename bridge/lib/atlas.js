// The Atlas engine: browse, graph, and search across every session on disk.
//
// Read-only against ~/.claude. Everything here is grounded in the spike
// (docs/schema-findings.md):
//
//   • Sessions are depth-2 files only. Of 628 .jsonl files just 45 are sessions;
//     the rest are subagent transcripts under <session>/subagents/. Listing them
//     would show agents as if they were conversations.
//   • 69% of sessions branch. A rewind leaves the abandoned reply on disk as a
//     sibling, so the graph is a tree and the "live path" has to be computed,
//     not assumed.
//   • Only user/assistant records are turns; ~2/3 of records are metadata.
//   • Compaction carries logicalParentUuid — that node is the context frontier.
//
// Results are cached and invalidated by file mtime, because a full parse of the
// corpus is far too slow to do per request.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTree, conversationOnly } from "./tree.js";
import { extractText } from "./slice.js";
import * as titles from "./titles.js";

const PROJECTS = () =>
  process.env.CCBAR_PROJECTS || path.join(os.homedir(), ".claude", "projects");

const PREVIEW_CHARS = 140;
const SNIPPET_CHARS = 180;

// Two caches with very different costs.
//
// Summaries are tiny (a row each) and worth keeping for every session forever.
// Full parses hold every record and the whole tree: measured on the real corpus,
// retaining all 43 cost 406 MB of RSS. Those live in a small LRU instead — the
// browser only ever looks at one session at a time.
const summaryCache = new Map(); // id -> { mtime, row }
const treeCache = new Map();    // id -> { mtime, parsed }   (LRU, bounded)

export const MAX_TREE_CACHE = 4;
export const _treeCacheSize = () => treeCache.size;

function rememberTree(id, mtime, parsed) {
  treeCache.delete(id);
  treeCache.set(id, { mtime, parsed });
  // Map preserves insertion order, so the first key is the least recently used.
  while (treeCache.size > MAX_TREE_CACHE) {
    treeCache.delete(treeCache.keys().next().value);
  }
}

// Project dir names are the cwd with slashes turned into dashes.
function projectLabel(dirName) {
  const parts = dirName.replace(/^-/, "").split("-").filter(Boolean);
  return parts[parts.length - 1] || dirName;
}

// Depth 2 only — see the note above about subagents.
function sessionFiles() {
  const root = PROJECTS();
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return out;
  }
  for (const dir of dirs) {
    const dirPath = path.join(root, dir);
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const fp = path.join(dirPath, e.name);
      let st;
      try {
        st = fs.statSync(fp);
      } catch {
        continue;
      }
      if (st.size === 0) continue;
      out.push({
        id: e.name.replace(/\.jsonl$/, ""),
        fp,
        dir,
        project: projectLabel(dir),
        mtime: st.mtimeMs,
        size: st.size,
      });
    }
  }
  return out;
}

function readRecords(fp) {
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
      /* 29 CLI versions write these; skip what we cannot read */
    }
  }
  return out;
}

const isCompaction = (r) => Boolean(r?.isCompactSummary || r?.compactMetadata);

// Claude Code injects slash-command envelopes and local command output as `user`
// records. They are machinery, not something a person said, and titling a
// session "<command-name>/clear</command-name>" is useless — seen on the real
// corpus.
const COMMAND_ENVELOPE =
  /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|user-prompt-submit-hook|task-notification|task-id|system-reminder|tool-use-error)\b/;

const isCommandEnvelope = (text) => COMMAND_ENVELOPE.test(text || "");

// A `user` record whose content is only tool_result blocks is the tool
// reporting back, not the person.
function isToolResultRecord(r) {
  const c = r?.message?.content;
  return Array.isArray(c) && c.length > 0 && c.every((b) => b?.type === "tool_result");
}

// Parse one session into everything both the browser row and the graph need.
function parseSession(meta) {
  const hit = treeCache.get(meta.id);
  if (hit && hit.mtime === meta.mtime) {
    rememberTree(meta.id, meta.mtime, hit.parsed); // refresh LRU position
    return hit.parsed;
  }

  const records = readRecords(meta.fp);
  const tree = buildTree(records);
  const turns = conversationOnly([...tree.byUuid.values()]);

  // A branch point is a parent with more than one conversational child.
  let branches = 0;
  const kids = new Map();
  for (const t of turns) {
    if (t.parentUuid == null) continue;
    kids.set(t.parentUuid, (kids.get(t.parentUuid) || 0) + 1);
  }
  for (const n of kids.values()) if (n > 1) branches++;

  const titleRec = records.find((r) => r.type === "custom-title" || r.type === "ai-title");

  // First thing the human actually typed, skipping command machinery.
  const firstHuman = turns.find(
    (t) => t.type === "user" && extractText(t).trim() && !isCommandEnvelope(extractText(t).trim())
  );
  const firstUserText = firstHuman ? extractText(firstHuman).trim() : "";
  const lastAssistant = [...turns].reverse().find((t) => t.type === "assistant" && extractText(t).trim());

  // A user rename wins over anything derived from the transcript.
  const override = titles.get(meta.id);
  const derived =
    titleRec?.title?.trim() ||
    (firstUserText ? firstUserText.slice(0, 80) : `Session ${meta.id.slice(0, 8)}`);
  const title = override || derived;

  const preview =
    (lastAssistant ? extractText(lastAssistant) : firstUserText || "(no text yet)")
      .replace(/\s+/g, " ")
      .slice(0, PREVIEW_CHARS);

  const parsed = {
    id: meta.id,
    project: meta.project,
    dir: meta.dir,
    fp: meta.fp,
    updatedAt: meta.mtime,
    size: meta.size,
    title,
    preview,
    derivedTitle: derived,
    renamed: Boolean(override),
    cwd: records.find((r) => r.cwd)?.cwd || null,
    turns: turns.length,
    branches,
    compactions: records.filter(isCompaction).length,
    records,
    tree,
  };
  rememberTree(meta.id, meta.mtime, parsed);
  summaryCache.set(meta.id, { mtime: meta.mtime, row: rowOf(parsed) });
  return parsed;
}

// The cheap path: a row without holding the records or the tree.
//
// The cache is keyed by file mtime, but a rename changes the SIDECAR, not the
// transcript — so the override is applied here, on every read, rather than
// baked into the cached row where it would go stale until the file changed.
function withTitle(row) {
  const override = titles.get(row.id);
  return override
    ? { ...row, title: override, renamed: true }
    : { ...row, title: row.derivedTitle ?? row.title, renamed: false };
}

function summaryOf(meta) {
  const hit = summaryCache.get(meta.id);
  if (hit && hit.mtime === meta.mtime) return withTitle(hit.row);
  return withTitle(rowOf(parseSession(meta)));
}

// Strip the heavy fields before anything crosses the wire.
const rowOf = (p) => ({
  id: p.id,
  project: p.project,
  title: p.title,
  derivedTitle: p.derivedTitle,
  renamed: p.renamed,
  cwd: p.cwd,
  preview: p.preview,
  turns: p.turns,
  branches: p.branches,
  compactions: p.compactions,
  updatedAt: p.updatedAt,
  size: p.size,
});

export async function listSessions() {
  const metas = sessionFiles();
  const sessions = metas
    .map(summaryOf)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const projects = [...new Set(sessions.map((s) => s.project))].sort();
  return { sessions, projects, total: sessions.length };
}

// The newest leaf is the tip of the live path; everything hanging off a branch
// point that does not lead to it is an abandoned rewind.
function livePathIds(parsed) {
  const { tree } = parsed;
  const turns = conversationOnly([...tree.byUuid.values()]);
  if (!turns.length) return new Set();

  const hasChild = new Set();
  for (const t of turns) if (t.parentUuid != null) hasChild.add(t.parentUuid);
  const leaves = turns.filter((t) => !hasChild.has(t.uuid));
  const tip = leaves.reduce((a, b) => {
    const at = Date.parse(a?.timestamp || 0) || 0;
    const bt = Date.parse(b?.timestamp || 0) || 0;
    return bt >= at ? b : a;
  }, leaves[0]);

  const ids = new Set();
  let cur = tip;
  const seen = new Set();
  while (cur && !seen.has(cur.uuid)) {
    seen.add(cur.uuid);
    ids.add(cur.uuid);
    cur = cur.parentUuid != null ? tree.byUuid.get(cur.parentUuid) : null;
  }
  return ids;
}

export async function getTree(sessionId) {
  const meta = sessionFiles().find((m) => m.id === sessionId);
  if (!meta) return { ok: false, error: `Session "${sessionId}" not found.` };

  const parsed = parseSession(meta);
  const { tree } = parsed;

  // The graph is the USER'S JOURNEY: what they asked, in order, branching where
  // they rewound. Claude's replies and the tool chatter are the answer to a
  // node, not nodes themselves — drawing them buried 12 real asks under 979
  // boxes on a real session.
  const isAsk = (t) => {
    if (t.type !== "user") return false;
    const text = extractText(t).trim();
    return Boolean(text) && !isCommandEnvelope(text) && !isToolResultRecord(t);
  };

  const all = [...tree.byUuid.values()];
  const asks = conversationOnly(all).filter(isAsk);
  const askIds = new Set(asks.map((a) => a.uuid));

  // Relink asks to each other through everything in between (replies, tools,
  // attachments), so removing the machinery never breaks the chain.
  const graphParent = new Map();
  for (const a of asks) {
    let cur = a.parentUuid != null ? tree.byUuid.get(a.parentUuid) : null;
    const seen = new Set();
    while (cur && !seen.has(cur.uuid)) {
      if (askIds.has(cur.uuid)) break;
      seen.add(cur.uuid);
      cur = cur.parentUuid != null ? tree.byUuid.get(cur.parentUuid) : null;
    }
    if (cur && askIds.has(cur.uuid)) graphParent.set(a.uuid, cur.uuid);
  }

  // Everything an ask produced: the descendants up to (not including) the next
  // ask. That is the answer we reveal when the node is clicked.
  const childrenOf = new Map();
  for (const r of all) {
    if (r.parentUuid == null) continue;
    if (!childrenOf.has(r.parentUuid)) childrenOf.set(r.parentUuid, []);
    childrenOf.get(r.parentUuid).push(r);
  }
  function replyFor(ask) {
    const texts = [];
    const tools = [];
    let turns = 0;
    const stack = [...(childrenOf.get(ask.uuid) || [])];
    const seen = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (!n || seen.has(n.uuid)) continue;
      seen.add(n.uuid);
      if (askIds.has(n.uuid)) continue; // the next ask ends this reply
      if (n.type === "assistant") {
        turns++;
        const txt = extractText(n).trim();
        if (txt) texts.push(txt);
        for (const c of Array.isArray(n.message?.content) ? n.message.content : []) {
          if (c?.type === "tool_use" && c.name) tools.push(c.name);
        }
      }
      for (const c of childrenOf.get(n.uuid) || []) stack.push(c);
    }
    return { text: texts.join("\n\n"), tools: [...new Set(tools)], turns };
  }

  // "Abandoned" means a rewind superseded it — NOT merely "off the newest
  // chain". The old definition walked from the single newest leaf, and since a
  // compaction re-roots that chain it marked 21 of 46 asks in an actively-used
  // session as abandoned — in a session with ZERO forks.
  //
  // An ask is abandoned only if it, or an ancestor, lost a fork: a parent with
  // more than one child ask keeps the newest and discards the rest.
  const childAsks = new Map();
  for (const [child, parent] of graphParent) {
    if (!childAsks.has(parent)) childAsks.set(parent, []);
    childAsks.get(parent).push(child);
  }
  const at = (id) => Date.parse(tree.byUuid.get(id)?.timestamp || 0) || 0;
  const abandoned = new Set();
  const bury = (id) => {
    const stack = [id];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      abandoned.add(cur);
      for (const c of childAsks.get(cur) || []) stack.push(c);
    }
  };
  for (const [, siblings] of childAsks) {
    if (siblings.length < 2) continue;
    const kept = siblings.reduce((a, b) => (at(b) >= at(a) ? b : a));
    for (const sib of siblings) if (sib !== kept) bury(sib);
  }

  // Depth over the relinked ask graph, memoised: a walk to the root per node
  // with an O(n) membership test inside took 3.6s on a 4,000-turn session.
  const depthMemo = new Map();
  const depthOf = (id) => {
    const chain = [];
    let cur = id;
    let base = 0;
    const seen = new Set();
    while (cur != null && !seen.has(cur)) {
      if (depthMemo.has(cur)) { base = depthMemo.get(cur); break; }
      seen.add(cur);
      chain.push(cur);
      cur = graphParent.get(cur);
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      base = graphParent.has(chain[i]) ? base + 1 : 0;
      depthMemo.set(chain[i], base);
    }
    return depthMemo.get(id) ?? 0;
  };

  const frontierIds = new Set(
    all.filter(isCompaction).map((r) => r.logicalParentUuid || r.uuid)
  );

  const nodes = asks.map((a) => {
    const reply = replyFor(a);
    return {
      id: a.uuid,
      role: "user",
      preview: extractText(a).replace(/\s+/g, " ").slice(0, PREVIEW_CHARS),
      depth: depthOf(a.uuid),
      onLivePath: !abandoned.has(a.uuid),
      frontier: frontierIds.has(a.uuid),
      timestamp: a.timestamp || null,
      reply: {
        text: reply.text.replace(/\s+/g, " ").slice(0, PREVIEW_CHARS * 2),
        tools: reply.tools,
        turns: reply.turns,
      },
    };
  });

  const edges = [];
  for (const [child, parent] of graphParent) edges.push({ from: parent, to: child });

  return { ok: true, session: withTitle(rowOf(parsed)), nodes, edges };
}

// The full text of one turn. The tree payload carries only short previews —
// shipping every turn in full would be megabytes for a 1,000-turn session — so
// the inspector asks for the one node the user actually clicked.
export async function getNode(sessionId, uuid) {
  const meta = sessionFiles().find((m) => m.id === sessionId);
  if (!meta) return { ok: false, error: `Session "${sessionId}" not found.` };
  const parsed = parseSession(meta);
  const node = parsed.tree.byUuid.get(uuid);
  if (!node) return { ok: false, error: `Turn "${uuid}" not found.` };
  const content = Array.isArray(node.message?.content) ? node.message.content : [];
  return {
    ok: true,
    id: uuid,
    role: node.type,
    text: extractText(node),
    timestamp: node.timestamp || null,
    tools: content
      .filter((c) => c?.type === "tool_use")
      .map((c) => ({ name: c.name, keys: Object.keys(c.input || {}) })),
  };
}

export async function search(query, { limit = 50 } = {}) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return { hits: [], query: "" };

  const hits = [];
  for (const meta of sessionFiles()) {
    const parsed = parseSession(meta);
    for (const t of conversationOnly([...parsed.tree.byUuid.values()])) {
      const text = extractText(t);
      const at = text.toLowerCase().indexOf(q);
      if (at === -1) continue;
      const start = Math.max(0, at - 60);
      hits.push({
        sessionId: parsed.id,
        project: parsed.project,
        title: parsed.title,
        uuid: t.uuid,
        role: t.type,
        updatedAt: parsed.updatedAt,
        snippet: text.slice(start, start + SNIPPET_CHARS).replace(/\s+/g, " ").trim(),
      });
      if (hits.length >= limit) return { hits, query: q, truncated: true };
    }
  }
  hits.sort((a, b) => b.updatedAt - a.updatedAt);
  return { hits, query: q };
}
