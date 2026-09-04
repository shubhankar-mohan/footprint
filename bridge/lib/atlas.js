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
  /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|user-prompt-submit-hook)\b/;

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

  const title =
    titleRec?.title?.trim() ||
    (firstUserText ? firstUserText.slice(0, 80) : `Session ${meta.id.slice(0, 8)}`);

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
function summaryOf(meta) {
  const hit = summaryCache.get(meta.id);
  if (hit && hit.mtime === meta.mtime) return hit.row;
  return rowOf(parseSession(meta));
}

// Strip the heavy fields before anything crosses the wire.
const rowOf = (p) => ({
  id: p.id,
  project: p.project,
  title: p.title,
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

  // A turn earns a place in the graph if it said something or did something.
  // In a real 1907-node session, 50% had neither — drawing them buried the
  // conversation under a wall of "(no text)".
  const meaningful = (t) => {
    const text = extractText(t).trim();
    if (isCommandEnvelope(text)) return false; // machinery, not a person talking
    if (isToolResultRecord(t)) return false; // the tool reporting back
    const tools = (Array.isArray(t.message?.content) ? t.message.content : []).filter(
      (c) => c?.type === "tool_use"
    );
    return Boolean(text) || tools.length > 0;
  };

  const turns = conversationOnly([...tree.byUuid.values()]).filter(meaningful);
  const kept = new Set(turns.map((t) => t.uuid));

  // Re-link through everything we skipped. A turn's immediate parent is very
  // often an attachment or a tool-result, so linking only on a direct
  // turn-to-turn parent shattered one conversation into 521 fragments and the
  // layout drew each as a separate branch.
  const graphParent = new Map();
  for (const t of turns) {
    let cur = t.parentUuid != null ? tree.byUuid.get(t.parentUuid) : null;
    const seen = new Set();
    while (cur && !seen.has(cur.uuid)) {
      if (kept.has(cur.uuid)) break;
      seen.add(cur.uuid);
      cur = cur.parentUuid != null ? tree.byUuid.get(cur.parentUuid) : null;
    }
    if (cur && kept.has(cur.uuid)) graphParent.set(t.uuid, cur.uuid);
  }

  const live = livePathIds(parsed);

  // Depth over the RELINKED graph, memoised: walking per node with an O(n)
  // membership test made a 4,000-turn session take 3.6 seconds.
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
    [...tree.byUuid.values()].filter(isCompaction).map((r) => r.logicalParentUuid || r.uuid)
  );

  const nodes = turns.map((t) => ({
    id: t.uuid,
    role: t.type,
    preview: extractText(t).replace(/\s+/g, " ").slice(0, PREVIEW_CHARS),
    depth: depthOf(t.uuid),
    onLivePath: live.has(t.uuid),
    frontier: frontierIds.has(t.uuid),
    timestamp: t.timestamp || null,
    tools: (Array.isArray(t.message?.content) ? t.message.content : [])
      .filter((c) => c?.type === "tool_use")
      .map((c) => c.name),
  }));

  const edges = [];
  for (const [child, parent] of graphParent) edges.push({ from: parent, to: child });

  return { ok: true, session: rowOf(parsed), nodes, edges };
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
