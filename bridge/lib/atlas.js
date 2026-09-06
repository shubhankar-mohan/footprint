// The Atlas engine: browse, graph, and search across every session on disk.
//
// Read-only against ~/.claude. Everything here is grounded in the spike
// (docs/schema-findings.md):
//
//   • Sessions are depth-2 files only. Of 628 .jsonl files just 45 are sessions;
//     the rest are subagent transcripts under <session>/subagents/. Listing them
//     would show agents as if they were conversations.
//   • ~18% of sessions branch at the ASK level (7 of 40 on the real corpus).
//     The 69% figure from the schema spike counted branch points among all
//     conversational turns, which is mostly assistant regenerations — not
//     something the user did. A rewind leaves the abandoned reply on disk as a
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
//
// More precisely: every character that is not a letter or a digit becomes a
// dash, so `/Users/you/work/api/push_notifications` is stored as
// `-Users-you-work-api-push-notifications`. Verified against a real corpus —
// 21 of 21 sessions whose `cwd` record could be read encode exactly this way,
// including the underscore and the one directory with a space in its name.
//
// This is the ONE place that mapping lives. lib/mcp.js imports it rather than
// writing a second copy that could drift.
export function projectDirName(cwd) {
  return String(cwd || "").replace(/[^a-zA-Z0-9]/g, "-");
}

// The human name for a project: the last path segment. It is what the browser
// groups by and what a person recognises — but it is LOSSY and it collides.
// Two different directories collapse to the same label whenever they share a
// last segment — `-Users-you-work-api` and `-Users-you-side-api` are both
// "api", and a checkout beside its own test fixture (`-proj` / `-proj-test-proj`)
// collides too. Both shapes occur on real machines. Anywhere a mistake would
// cross a data boundary, compare the directory, never the label.
export function projectLabel(dirName) {
  const parts = dirName.replace(/^-/, "").split("-").filter(Boolean);
  return parts[parts.length - 1] || dirName;
}

// Which project is the caller standing in? `known` is false when that cwd has
// no transcripts on disk, and every caller is expected to fail SAFE on it —
// a boundary that silently refuses everything is worse than one that
// over-shares, because the second is visible and the first is not.
export function projectForCwd(cwd) {
  const dir = projectDirName(cwd);
  let known = false;
  try {
    known = Boolean(dir) && fs.statSync(path.join(PROJECTS(), dir)).isDirectory();
  } catch {
    known = false;
  }
  return { dir, name: projectLabel(dir), known };
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

// The single definition of "something the user asked".
function isAskRecord(t) {
  if (t.type !== "user") return false;
  const text = extractText(t).trim();
  return Boolean(text) && !isCommandEnvelope(text) && !isToolResultRecord(t);
}

// The ask graph: which asks exist, and which ask each one hangs off.
//
// Both the browser row's branch count and the drawn graph come from HERE. They
// were two implementations once, and they disagreed in both directions — the
// row claimed 14 branches where the graph drew none, and after a first attempt
// at a fix the row claimed none where the graph drew one. The second bug was
// mine: I walked a map built from the filtered conversational list, so a
// metadata record sitting between two asks broke the chain. Relinking must walk
// the FULL tree.
function askGraph(tree) {
  const all = [...tree.byUuid.values()];
  const asks = conversationOnly(all).filter(isAskRecord);
  const askIds = new Set(asks.map((a) => a.uuid));

  // Walk up through everything in between — replies, tools, attachments,
  // metadata — until the nearest ancestor that is itself an ask.
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
  return { all, asks, askIds, graphParent };
}

// A fork is an ask with more than one ask hanging off it — exactly what the
// graph draws as a split.
function countAskForks(tree) {
  const { graphParent } = askGraph(tree);
  const kids = new Map();
  for (const parent of graphParent.values()) kids.set(parent, (kids.get(parent) || 0) + 1);
  let n = 0;
  for (const c of kids.values()) if (c > 1) n++;
  return n;
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

  // A branch point is an ask with more than one ask hanging off it — the same
  // forks the graph draws. Counting every conversational turn instead made this
  // number include assistant retries, so the row said "14 branches" and the
  // graph beside it showed zero. A count that contradicts the picture is worse
  // than no count.
  const branches = countAskForks(tree);

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
  // The exact directory beside the friendly label, because labels collide.
  projectDir: p.dir,
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
  // Same builder the browser row's branch count uses, so the number beside a
  // session can never contradict the picture inside it.
  const { all, asks, askIds, graphParent } = askGraph(tree);

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

// How many times `needle` occurs in `hay`. Both are already lowercased.
function countOf(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    n++;
    at = hay.indexOf(needle, at + needle.length);
  }
  return n;
}

// Which of the query's words this turn contains, and how often in total.
//
// Ranking is deliberately two-tiered:
//   1. how many DISTINCT query words appear — a turn holding "widget layer"
//      beats one that only says "widget", however many times it says it;
//   2. then the raw number of occurrences.
// It is not normalised by length. The snippet is a fixed 180-character window,
// so a long turn with several hits still produces a better window than a short
// turn with one; dividing by length would hand the row to a passing mention in
// a one-line reply. The cost is that a pasted file full of the term can win —
// which, on the real corpus, is usually the right answer anyway.
function scoreMatch(lowerText, terms) {
  let distinct = 0;
  let total = 0;
  for (const t of terms) {
    const n = countOf(lowerText, t);
    if (n) {
      distinct++;
      total += n;
    }
  }
  return { distinct, total };
}

const beats = (a, b) => (a.distinct !== b.distinct ? a.distinct > b.distinct : a.total > b.total);

// The ask a match sits under — the nearest user prompt at or above it.
//
// This is what titles a search row. The old code titled every row with the
// session's FIRST ask, so on the real corpus the top five rows for "schema"
// were five copies of the same sentence. The enclosing ask answers the question
// a reader actually has — "what were we doing when this came up" — and it
// varies with the match rather than with the file.
function enclosingAsk(tree, node) {
  let cur = node;
  const seen = new Set();
  while (cur && !seen.has(cur.uuid)) {
    seen.add(cur.uuid);
    if (isAskRecord(cur)) return cur;
    cur = cur.parentUuid != null ? tree.byUuid.get(cur.parentUuid) : null;
  }
  return null;
}

const oneLine = (s, n = 80) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

// Search every session on disk.
//
//   project        — a project to restrict to, named EITHER by its friendly
//                    label ("api-server") or by its exact directory
//                    ("-Users-you-side-api-server"). Labels collide; directories do
//                    not, so anything enforcing a boundary should pass a
//                    directory.
//   scope          — "all" (default) searches everything; "project" restricts.
//                    "project" with no project named cannot scope, so it does
//                    not pretend to: it searches everything and says scope
//                    "all" in the reply. Silently returning nothing would look
//                    exactly like having no history.
//   groupBySession — default true. Collapses a session's many matches into one
//                    row carrying its best match and a matchCount, so the list
//                    stops showing the same conversation five times.
export async function search(query, { limit = 50, project = null, scope = "all", groupBySession = true } = {}) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return { hits: [], query: "", scope: "all", project: null, grouped: groupBySession !== false };

  const wanted = project ? String(project) : null;
  const scoped = scope === "project" && Boolean(wanted);
  const terms = [...new Set(q.split(/\s+/).filter(Boolean))];

  const hits = [];
  let truncated = false;

  for (const meta of sessionFiles()) {
    // Scope BEFORE parsing: an out-of-scope project costs nothing to skip, and
    // this is what keeps a scoped search cheap on a machine with many projects.
    if (scoped && meta.project !== wanted && meta.dir !== wanted) continue;

    const parsed = parseSession(meta);
    const turns = conversationOnly([...parsed.tree.byUuid.values()]);

    let matchCount = 0;
    let best = null;
    let bestScore = null;

    for (const t of turns) {
      const text = extractText(t);
      const lower = text.toLowerCase();
      const at = lower.indexOf(q);
      if (at === -1) continue;
      matchCount++;

      const score = scoreMatch(lower, terms);
      // `beats` is strict, so an equal contest keeps the turn we saw first —
      // the earliest mention, which is where the topic was introduced and is
      // stable from run to run.
      const isBest = !best || beats(score, bestScore);
      if (isBest) {
        best = { turn: t, at, text };
        bestScore = score;
      }

      if (!groupBySession) {
        hits.push(hitOf(parsed, t, text, at, 1));
        if (hits.length >= limit) {
          truncated = true;
          break;
        }
      }
    }

    if (truncated) break;

    if (groupBySession && best) {
      hits.push(hitOf(parsed, best.turn, best.text, best.at, matchCount));
      if (hits.length >= limit) {
        // One session per row, so a full row means a full session: nothing is
        // half-counted when we stop here.
        truncated = true;
        break;
      }
    }
  }

  hits.sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    hits,
    query: q,
    scope: scoped ? "project" : "all",
    project: scoped ? wanted : null,
    grouped: groupBySession !== false,
    ...(truncated ? { truncated: true } : {}),
  };

  function hitOf(parsed, turn, text, at, matchCount) {
    const start = Math.max(0, at - 60);
    const ask = enclosingAsk(parsed.tree, turn);
    // A rename writes the sidecar, not the transcript, so the cached parse can
    // hold a stale name. Read the override here, the same way withTitle does.
    const sessionTitle = titles.get(parsed.id) || parsed.derivedTitle || parsed.title;
    return {
      sessionId: parsed.id,
      project: parsed.project,
      projectDir: parsed.dir,
      // What matched, and separately which conversation it was in. The browser
      // shows both; they used to be the same string.
      title: oneLine(ask ? extractText(ask) : text) || sessionTitle,
      sessionTitle,
      uuid: turn.uuid,
      role: turn.type,
      updatedAt: parsed.updatedAt,
      matchCount,
      snippet: text.slice(start, start + SNIPPET_CHARS).replace(/\s+/g, " ").trim(),
    };
  }
}
