// Best-effort reads of Claude Code's transcript JSONL files. Used for (a) the
// one-line "what is Claude saying" glance shown next to a permission prompt, and
// (b) discovering sessions that were already running before our hooks installed.
// Transcript format is internal/unstable — everything here degrades to null.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECTS = path.join(os.homedir(), ".claude", "projects");

function readLines(fp) {
  try {
    return fs.readFileSync(fp, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// The last assistant text message (trimmed, capped), or null.
export function lastAssistantText(transcriptPath) {
  const lines = readLines(transcriptPath);
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const content = o?.message?.content;
    if (o?.type === "assistant" && Array.isArray(content)) {
      const text = (content.find((c) => c.type === "text")?.text || "").trim();
      if (text) return text.replace(/\s+/g, " ").slice(0, 200);
    }
  }
  return null;
}

function cwdFromTranscript(fp) {
  for (const l of readLines(fp)) {
    try {
      const o = JSON.parse(l);
      if (o.cwd) return o.cwd;
    } catch {
      /* skip */
    }
  }
  return null;
}

// Sessions whose transcript changed within maxAgeMs — the "best-effort" tier, so
// sessions started before our hooks appear (read-only) instead of being invisible.
export function discoverSessions(maxAgeMs = 6 * 3600 * 1000) {
  const out = [];
  const now = Date.now();
  let dirs;
  try {
    dirs = fs.readdirSync(PROJECTS);
  } catch {
    return out;
  }
  for (const dir of dirs) {
    const dirPath = path.join(PROJECTS, dir);
    let files;
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = path.join(dirPath, f);
      let st;
      try {
        st = fs.statSync(fp);
      } catch {
        continue;
      }
      if (now - st.mtimeMs > maxAgeMs) continue;
      out.push({
        id: f.replace(/\.jsonl$/, ""),
        cwd: cwdFromTranscript(fp),
        lastLine: lastAssistantText(fp),
        updatedAt: st.mtimeMs,
      });
    }
  }
  return out;
}
