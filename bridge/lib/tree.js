// Reconstructs a session's conversation tree from its JSONL records.
//
// Grounded in docs/schema-findings.md, which surveyed 45 real sessions:
//
//   • Five fields are present in EVERY CLI version and are all this needs:
//     uuid, parentUuid, type, timestamp, sessionId. Everything else is optional.
//   • Branching is the common case (31 of 45 sessions), not the exception — a
//     rewind or an edited-and-resent message leaves the abandoned branch on disk
//     as a sibling. So a parent may have several children, and walking the tree
//     by FILE ORDER would interleave dead branches with the live one.
//   • Only `user` and `assistant` are conversation. Roughly two thirds of records
//     are metadata (attachment, ai-title, mode, file-history-*, …).
//
//   record list ─▶ buildTree ─▶ { byUuid, children, roots }
//                                      │
//                                      └─▶ pathToRoot(uuid) walks parentUuid
//                                          upward, so it can never wander into
//                                          an abandoned sibling branch.

const CONVERSATION_TYPES = new Set(["user", "assistant"]);

// Guards against a malformed parent chain; real depths are far below this.
const MAX_DEPTH = 100_000;

// Index records by uuid and by parent. Records without a uuid are metadata and
// carry no position in the tree.
export function buildTree(records) {
  const byUuid = new Map();
  const children = new Map();

  for (const r of records) {
    if (!r || !r.uuid) continue;
    byUuid.set(r.uuid, r);
  }

  const roots = [];
  for (const r of byUuid.values()) {
    // A parentUuid we cannot resolve makes this a root: subagent transcripts and
    // truncated files both produce records whose parent lives elsewhere.
    const parent = r.parentUuid != null && byUuid.has(r.parentUuid) ? r.parentUuid : null;
    if (parent === null) {
      roots.push(r);
      continue;
    }
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(r);
  }

  return { byUuid, children, roots };
}

// The chain from the session root down to `uuid`, root first. This is the
// definition of "context up to here" that a slice serializes.
export function pathToRoot(tree, uuid) {
  const node = tree.byUuid.get(uuid);
  if (!node) return [];

  const path = [];
  const seen = new Set();
  let cur = node;

  for (let i = 0; cur && i < MAX_DEPTH; i++) {
    if (seen.has(cur.uuid)) break; // cyclic chain — stop rather than hang
    seen.add(cur.uuid);
    path.push(cur);
    cur = cur.parentUuid != null ? tree.byUuid.get(cur.parentUuid) : null;
  }

  return path.reverse();
}

// The turns a human would recognise as the conversation.
export function conversationOnly(records) {
  return records.filter((r) => r && CONVERSATION_TYPES.has(r.type) && !r.isMeta);
}
