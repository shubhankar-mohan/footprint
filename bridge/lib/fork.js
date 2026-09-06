// Fork a new session from any past ask.
//
// ── What this is NOT, and why ────────────────────────────────────────────
// The product plan called for the Agent SDK's `resume + forkSession +
// resumeSessionAt`, which forks a session at an arbitrary message with its
// exact internal context. Two things rule that out:
//
//   1. The CLI's `--fork-session` only forks from the END of a session. There
//      is no `--resume-at <uuid>` flag (checked against Claude Code 2.1.260).
//   2. The SDK route needs node_modules, and this bridge is dependency-free by
//      design — that is what makes the shipped .app self-contained.
//
// So a fork here REPLAYS rather than resumes: it opens a brand-new session
// seeded with the root→node slice we already build for `get_slice`. The
// user-facing promise — "carry on from this ask, without disturbing the
// original" — holds exactly. What differs is the cost: a replayed fork pays
// tokens for the recap, where a true fork would inherit cached context. The UI
// must say so rather than implying a free branch.
//
// The original session is never opened for writing. ~/.claude stays read-only.

const MAX_SEED = 90_000;  // keep the seed prompt comfortably sendable

export function buildForkPlan({ sessionId, uuid, cwd, slice, turns }) {
  if (!cwd) {
    return { ok: false, error: "This session has no recorded directory, so there is nowhere to start the fork." };
  }
  const body = String(slice ?? "").trim();
  if (!body) {
    return { ok: false, error: "There is nothing to carry into a fork from this point." };
  }

  let carried = body;
  let truncated = false;
  if (carried.length > MAX_SEED) {
    // Keep the END: the turns closest to the fork point are the ones you meant
    // to continue from.
    carried = carried.slice(carried.length - MAX_SEED);
    truncated = true;
  }

  const seed =
    `This session was forked from an earlier one (${sessionId}) at a specific point.\n` +
    `Everything below is that conversation up to the fork. The original is untouched.\n` +
    (truncated ? `Only the most recent part is included; earlier turns were dropped for length.\n` : "") +
    `\n---\n\n${carried}\n\n---\n\n` +
    `That is the context. Wait for my next instruction.`;

  return {
    ok: true,
    sessionId, uuid, cwd,
    seed,
    turns: Number.isFinite(turns) ? turns : 0,
    truncated,
    mutatesOriginal: false,
  };
}
