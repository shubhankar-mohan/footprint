// Corpus statistics for the Atlas overview.
//
// Deliberately thin. Most numbers you can compute about a conversation corpus
// are interesting once and actionable never — knowing you average 27 replies
// per ask does not change what you do next. The number that earns its place is
// compaction rate, because compaction is what silently breaks a long session
// into disconnected segments, and that IS something you can act on (start a
// fresh session sooner, or scope the ask smaller).
//
// Pure function over the session list the engine already builds — no parsing,
// no I/O, so it costs nothing to call.

const num = (v) => (Number.isFinite(v) ? v : 0);

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round1 = (n) => Math.round(n * 10) / 10;

export function summarise(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) {
    return {
      sessions: 0, turns: 0, medianTurns: 0,
      compactions: 0, compactionsPerSession: 0, sessionsThatCompacted: 0,
      branches: 0, projects: [], busiest: null,
    };
  }

  const turns = list.map((s) => num(s.turns));
  const compactions = list.reduce((n, s) => n + num(s.compactions), 0);

  const byProject = new Map();
  for (const s of list) {
    const key = s.project || "—";
    const p = byProject.get(key) || { project: key, sessions: 0, turns: 0, compactions: 0 };
    p.sessions += 1;
    p.turns += num(s.turns);
    p.compactions += num(s.compactions);
    byProject.set(key, p);
  }
  const projects = [...byProject.values()].sort((a, b) => b.turns - a.turns);

  return {
    sessions: list.length,
    turns: turns.reduce((a, b) => a + b, 0),
    medianTurns: median(turns),
    compactions,
    compactionsPerSession: round1(compactions / list.length),
    sessionsThatCompacted: list.filter((s) => num(s.compactions) > 0).length,
    branches: list.reduce((n, s) => n + num(s.branches), 0),
    projects,
    busiest: projects[0]?.project ?? null,
  };
}
