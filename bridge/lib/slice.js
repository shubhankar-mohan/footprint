// Serializes a root→node path into markdown that can be pasted back into a live
// Claude Code session.
//
// The whole point of a slice is to ADD a recap to the current context, so the
// output has to be small and honest:
//
//   • Tool calls collapse to one line. A single Write payload measured 600 KB in
//     the real corpus; inlining one would blow the context this is meant to enrich.
//   • Turns are individually capped, and truncation is stated rather than silent.
//   • A compaction boundary is called out. Past that line the model no longer
//     holds the earlier turns, and a reference that stays quiet about that is
//     lying by omission — see docs/schema-findings.md Q3.

const DEFAULT_MAX_CHARS_PER_TURN = 4000;

const ROLE_LABEL = { user: "You", assistant: "Claude" };

// Records store content either as a block array or, in older sessions, a string.
export function extractText(node) {
  const content = node?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n\n");
}

function toolSummaries(node) {
  const content = node?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((c) => c?.type === "tool_use")
    .map((c) => {
      const input = c.input && typeof c.input === "object" ? c.input : {};
      const keys = Object.keys(input);
      let size = 0;
      try {
        size = Buffer.byteLength(JSON.stringify(input) ?? "");
      } catch {
        /* ignore */
      }
      const detail = keys.length ? ` (${keys.join(", ")}; ${size} bytes)` : "";
      return `_used **${c.name || "tool"}**${detail}_`;
    });
}

function isCompaction(node) {
  return Boolean(node?.isCompactSummary || node?.compactMetadata);
}

// A `user` record whose content is a tool_result is the TOOL reporting back, not
// the human speaking. Labelling it "You" with an empty body is worse than
// dropping it: it invents a turn that never happened.
function isToolResult(node) {
  const content = node?.message?.content;
  if (!Array.isArray(content)) return false;
  return content.length > 0 && content.every((c) => c?.type === "tool_result");
}

// A turn earns its place if it said something or did something. Thinking-only
// and empty turns are neither, and in a real 145-turn slice they were the
// majority of the output.
function renderable(node) {
  if (isCompaction(node)) return true;
  if (!ROLE_LABEL[node?.type]) return false;
  if (isToolResult(node)) return false;
  return Boolean(extractText(node).trim()) || toolSummaries(node).length > 0;
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n_… truncated (${text.length - max} more characters)_`;
}

export function renderSlice({
  nodes = [],
  sessionId,
  ref,
  maxCharsPerTurn = DEFAULT_MAX_CHARS_PER_TURN,
} = {}) {
  // Count what actually gets rendered, not what was fed in — the header should
  // describe the document the reader is holding.
  const kept = nodes.filter(renderable);

  const head = ["# Slice from an earlier session"];
  if (sessionId) head.push(`Session \`${sessionId}\``);
  if (ref) head.push(`Reference \`${ref}\``);
  head.push(`${kept.length} turn${kept.length === 1 ? "" : "s"}, oldest first.`);

  if (!kept.length) {
    return `${head.join("\n\n")}\n\n_This path is empty — nothing to quote._\n`;
  }

  const parts = [head.join("\n\n")];

  // A turn that only ran tools, with nothing said around it.
  const isToolOnly = (n) =>
    !isCompaction(n) && !extractText(n).trim() && toolSummaries(n).length > 0;

  for (let i = 0; i < kept.length; i++) {
    const node = kept[i];

    // Collapse a RUN of tool-only turns into one line. Individually each is real
    // content; as a wall of 20 they crowd out the reasoning the quote is for.
    if (isToolOnly(node)) {
      let j = i;
      const names = [];
      while (j < kept.length && isToolOnly(kept[j])) {
        const c = kept[j].message.content.filter((b) => b?.type === "tool_use");
        for (const b of c) names.push(b.name || "tool");
        j++;
      }
      const runLength = j - i;
      if (runLength > 1) {
        const tally = [...new Set(names)]
          .map((n) => {
            const c = names.filter((x) => x === n).length;
            return c > 1 ? `${n} ×${c}` : n;
          })
          .join(", ");
        parts.push(`_${names.length} tool calls — ${tally}_`);
        i = j - 1;
        continue;
      }
    }

    if (isCompaction(node)) {
      parts.push(
        "---\n\n" +
          "**⌁ context frontier — the conversation was compacted here.**\n" +
          "_Turns above this line are on disk but are no longer in the model's live context._"
      );
      const summary = extractText(node).trim();
      if (summary) parts.push(truncate(summary, maxCharsPerTurn));
      continue;
    }

    const label = ROLE_LABEL[node?.type];
    if (!label) continue; // metadata records carry no turn

    const body = truncate(extractText(node).trim(), maxCharsPerTurn);
    const tools = toolSummaries(node);
    const block = [body, ...tools].filter(Boolean).join("\n\n");
    parts.push(`## ${label}\n\n${block || "_(no text in this turn)_"}`);
  }

  return `${parts.join("\n\n")}\n`;
}
