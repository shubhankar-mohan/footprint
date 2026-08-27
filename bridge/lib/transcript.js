// Best-effort reads of Claude Code's transcript JSONL files. Used for (a) the
// one-line "what is Claude saying" glance shown next to a permission prompt, and
// (b) discovering sessions that were already running before our hooks installed.
// Transcript format is internal/unstable — everything here degrades to null.
//
// BOUNDED READS. The first version did fs.readFileSync(whole file).split("\n")
// TWICE per session — once to find `cwd` (which lives on line 1) and once to
// find the last assistant message (which lives at the end). On a real corpus
// that measured 583 ms and 183 MB of RSS for 54 files, on the event loop, at
// boot. Transcripts here reach 19 MB.
//
// We read only the two ends we actually need:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ HEAD 64 KB          …file body, never read…    TAIL 64 KB│
//   │ cwd, sessionId                        last assistant text│
//   └──────────────────────────────────────────────────────────┘
//     drop last partial line              drop first partial line
//
// The tail grows (64 KB → 256 KB → 1 MB) only when no assistant message was
// found in the first window, so the common case stays cheap.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Overridable so tests can point at a fixture dir instead of the real
// ~/.claude/projects. This module was previously untestable for exactly that
// reason, which is why it shipped at 0% coverage.
const PROJECTS =
  process.env.CCBAR_PROJECTS || path.join(os.homedir(), ".claude", "projects");

const HEAD_BYTES = 64 * 1024;
const TAIL_WINDOWS = [64 * 1024, 256 * 1024, 1024 * 1024];

// Read a byte range without materializing the whole file.
function readRange(fp, start, length) {
  let fd;
  try {
    fd = fs.openSync(fp, "r");
    const buf = Buffer.allocUnsafe(length);
    const read = fs.readSync(fd, buf, 0, length, start);
    return buf.subarray(0, read).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function sizeOf(fp) {
  try {
    return fs.statSync(fp).size;
  } catch {
    return 0;
  }
}

// First lines of the file. Drops a trailing partial line unless we read it all.
function headLines(fp, maxBytes = HEAD_BYTES) {
  const size = sizeOf(fp);
  if (!size) return [];
  const chunk = readRange(fp, 0, Math.min(maxBytes, size));
  const lines = chunk.split("\n");
  if (size > maxBytes) lines.pop(); // last line is probably cut mid-JSON
  return lines.filter(Boolean);
}

// Last lines of the file. Drops a leading partial line unless we read it all.
function tailLines(fp, maxBytes) {
  const size = sizeOf(fp);
  if (!size) return [];
  const start = Math.max(0, size - maxBytes);
  const chunk = readRange(fp, start, size - start);
  const lines = chunk.split("\n");
  if (start > 0) lines.shift(); // first line is probably cut mid-JSON
  return lines.filter(Boolean);
}

function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// The last assistant text message (trimmed, capped), or null.
export function lastAssistantText(transcriptPath) {
  const size = sizeOf(transcriptPath);
  if (!size) return null;

  let scanned = 0;
  for (const window of TAIL_WINDOWS) {
    const lines = tailLines(transcriptPath, window);
    for (let i = lines.length - 1; i >= 0; i--) {
      const o = parse(lines[i]);
      const content = o?.message?.content;
      if (o?.type === "assistant" && Array.isArray(content)) {
        const text = (content.find((c) => c.type === "text")?.text || "").trim();
        if (text) return text.replace(/\s+/g, " ").slice(0, 200);
      }
    }
    scanned = window;
    if (size <= scanned) break; // we already read the whole file
  }
  return null;
}

// `cwd` appears on the very first records, so the head window is enough.
function cwdFromTranscript(fp) {
  for (const l of headLines(fp)) {
    const o = parse(l);
    if (o?.cwd) return o.cwd;
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
      if (st.size === 0) continue;
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

// Exported for tests — the byte-window helpers are the whole point of this file.
export const __test = { headLines, tailLines, readRange };
