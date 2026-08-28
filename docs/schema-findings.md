# Transcript schema — spike findings

**Run:** 28 Aug 2026 · `bridge/spike/schema-survey.mjs` · read-only against the real corpus
**Sample:** 45 sessions · 59,132 records · **0 parse failures**

This answers the four questions the Engine's design depends on. It replaces guesswork
with measurement, and one answer changed the plan.

---

## 0. On-disk layout (the finding that reframed everything)

`~/.claude/projects/` is **not** flat. Of 628 `.jsonl` files, only 45 are sessions:

```
<project>/<session>.jsonl                                        45   real sessions
<project>/<session-uuid>/subagents/agent-*.jsonl                402   subagent transcripts
<project>/<session-uuid>/subagents/workflows/wf_*/agent-*.jsonl 181   workflow subagents
<project>/memory/MEMORY.md                                            not a transcript
```

**Consequences**

- Session discovery must scan **depth 2 only**. `lib/transcript.js` already does exactly
  this and is correct — a recursive walk would surface 583 subagent files as if they were
  sessions.
- A subagent's parent is encoded **in its path**, not in its records. Linking a subagent
  sub-graph to the turn that spawned it needs no cross-file index — read the UUID from
  the directory name.
- Workflow-spawned agents nest one level deeper under `subagents/workflows/wf_*/`.
- Anything walking this tree must ignore `memory/`.

---

## Q1 — Rewind / branching

| Measure | Value |
|---|---|
| Sessions containing a branch point | **31 / 45 (68.9%)** |
| Total branch points | 195 |
| Max children at one parent | 3 |
| Records carrying `leafUuid` | 2,973 |

**Branching is the common case, not the exception.** Two thirds of real sessions contain
at least one parent with more than one conversational child — the on-disk trace of a
rewind or an edited-and-resent message. The abandoned branch is retained in full.

`leafUuid` (on `last-prompt` records) is the moving pointer to the current tip. The tree
is the history; the leaf pointer is the present.

**Design impact:** the graph renderer cannot assume a line. Multi-parent layout is a
Phase-3 requirement, not a Phase-4 nicety. A slice must resolve `root → node` along the
`parentUuid` chain, never by file order, because file order interleaves abandoned
branches with the live one.

---

## Q2 — Sidechains / subagents

**Zero** records with `isSidechain: true` across all 59,132 sampled records.

Subagents do not appear inline. They are separate files under the parent session's UUID
directory (see §0). The `isSidechain` field exists on every record and is uniformly
`false` in session transcripts.

**Design impact:** subagent sub-graphs are cheaper than planned. No inline detection, no
attach-point inference — the parent linkage is the directory name.

---

## Q3 — Compaction

| Measure | Value |
|---|---|
| Sessions with compaction | **10 / 45 (22.2%)** |
| Compact records | 28 |
| Records with `logicalParentUuid` | 14 |

Compaction records carry:

```
compactMetadata, content, cwd, entrypoint, gitBranch, isSidechain, level,
logicalParentUuid, parentUuid, sessionId, slug, subtype, timestamp, type,
userType, uuid, version
```

Both `parentUuid` **and** `logicalParentUuid` are present. `parentUuid` keeps the
physical chain intact; `logicalParentUuid` points across the compaction boundary.

**Design impact:** the context frontier is drawn where a compact record appears. Walk
`parentUuid` to reconstruct what was actually said; use `logicalParentUuid` to know what
the model still holds. A slice that crosses a frontier must say so — this is the
mechanism that keeps a reference from lying.

---

## Q4 — Version variance

**29 distinct CLI versions** in 45 sessions.

Present in **every** version (safe to depend on):

```
attachment, cwd, durationMs, entrypoint, gitBranch, hasOutput,
hookAdditionalContext, hookCount, hookErrors, hookInfos, isMeta, isSidechain,
level, message, messageCount, origin, parentUuid, preventedContinuation,
promptId, requestId, sessionId, stopReason, subtype, timestamp, toolUseID,
type, userType, uuid, version
```

Varies by version (**must** be optional):

```
apiErrorStatus, attributionMcpServer, attributionMcpTool, attributionPlugin,
attributionSkill, compactMetadata, content, effort, error,
interruptedMessageId, isApiErrorMessage, isCompactSummary,
isVisibleInTranscriptOnly, logicalParentUuid, mcpMeta,
pendingBackgroundAgentCount, pendingWorkflowCount, permissionMode, … (+14)
```

`uuid`, `parentUuid`, `type`, `timestamp`, and `sessionId` are universal — the tree can
be built from those alone. Everything the graph *decorates* with is optional.

**Design impact:** parse defensively by default. Treat any field outside the universal
list as absent-until-proven-present, and log-and-skip unknown record types rather than
failing a whole session. 0 parse failures across 59k records says the format is stable
in shape even as fields come and go.

---

## Record types observed

```
assistant 18563 · attachment 12819 · user 9613 · last-prompt 2973 · mode 2938
ai-title 2865 · permission-mode 2559 · system 1594 · pr-link 1218
queue-operation 1083 · bridge-session 1020 · atis-latch 632
file-history-snapshot 626 · file-history-delta 344 · frame-link 153
artifact-autoreact-ledger 64 · agent-name 28 · custom-title 27
artifact-comment-monitor 11 · cost-state 2
```

Only `user` and `assistant` are conversation. Roughly **two thirds of all records are
not turns** — the graph's default view must filter to `user`/`assistant` and treat the
rest as metadata.

---

## Verdict

No blockers. The tree is reconstructible from five universal fields, the format parsed
cleanly at 100%, and the two things assumed hard (subagent linkage, compaction) are both
simpler than the plan expected. Branching being the common case is the one finding that
adds work, and it lands on the graph renderer in Phase 3.
