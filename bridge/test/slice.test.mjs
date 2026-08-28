import { test } from "node:test";
import assert from "node:assert";
import { renderSlice, extractText } from "../lib/slice.js";

const user = (uuid, text) => ({
  type: "user", uuid, parentUuid: null,
  message: { content: [{ type: "text", text }] },
});
const asst = (uuid, text) => ({
  type: "assistant", uuid, parentUuid: null,
  message: { content: [{ type: "text", text }] },
});

test("extractText pulls text out of a content array", () => {
  assert.equal(extractText({ message: { content: [{ type: "text", text: "hello" }] } }), "hello");
});

test("extractText joins multiple text blocks", () => {
  assert.equal(
    extractText({ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }),
    "a\n\nb"
  );
});

test("extractText handles content given as a plain string", () => {
  assert.equal(extractText({ message: { content: "plain" } }), "plain");
});

test("extractText returns empty string when there is no text", () => {
  assert.equal(extractText({ message: { content: [{ type: "tool_use", name: "Bash" }] } }), "");
  assert.equal(extractText({}), "");
});

test("renderSlice labels each turn with its role", () => {
  const md = renderSlice({ nodes: [user("a", "what broke?"), asst("b", "a null deref")] });
  assert.match(md, /## You/);
  assert.match(md, /## Claude/);
  assert.match(md, /what broke\?/);
  assert.match(md, /a null deref/);
});

test("renderSlice keeps turns in the order given", () => {
  const md = renderSlice({ nodes: [user("a", "FIRST"), asst("b", "SECOND")] });
  assert.ok(md.indexOf("FIRST") < md.indexOf("SECOND"));
});

// A slice is pasted back into a live session, so a 600 KB Write payload would
// blow the context it is meant to enrich.
test("renderSlice collapses tool calls to a one-line summary", () => {
  const withTool = {
    type: "assistant", uuid: "t", parentUuid: null,
    message: { content: [
      { type: "text", text: "running it" },
      { type: "tool_use", name: "Bash", input: { command: "x".repeat(5000) } },
    ] },
  };
  const md = renderSlice({ nodes: [withTool] });
  assert.match(md, /running it/);
  assert.match(md, /Bash/, "the tool name is useful context");
  assert.ok(!md.includes("x".repeat(200)), "the tool payload must not be inlined");
  assert.ok(md.length < 2000, `slice should stay small, got ${md.length}`);
});

test("renderSlice includes a header naming the source session", () => {
  const md = renderSlice({ nodes: [user("a", "hi")], sessionId: "sess-123", ref: "node://sess-123/a" });
  assert.match(md, /sess-123/);
  assert.match(md, /node:\/\/sess-123\/a/);
});

// Compaction means the model no longer holds the earlier turns. A reference that
// stays silent about that is lying by omission.
test("renderSlice marks the context frontier when the path crosses a compaction", () => {
  const compact = {
    type: "system", uuid: "c", parentUuid: "a",
    isCompactSummary: true, logicalParentUuid: "a",
    message: { content: [{ type: "text", text: "summary of earlier work" }] },
  };
  const md = renderSlice({ nodes: [user("a", "old turn"), compact, asst("b", "new turn")] });
  assert.match(md, /frontier|compact/i, "the compaction boundary must be visible in the output");
});

test("renderSlice returns a usable document for an empty path", () => {
  const md = renderSlice({ nodes: [] });
  assert.equal(typeof md, "string");
  assert.ok(md.length > 0, "must not return an empty string");
});

test("renderSlice truncates an individual turn that is enormous", () => {
  const md = renderSlice({ nodes: [asst("a", "y".repeat(80_000))], maxCharsPerTurn: 500 });
  assert.ok(md.length < 3000, `expected truncation, got ${md.length}`);
  assert.match(md, /truncated/i, "truncation must be stated, not silent");
});

// Found by reading real output: a 145-turn slice was mostly the string
// "_(no text in this turn)_". Two causes, both noise.

// A `user` record whose content is a tool_result is the TOOL talking, not the
// human. Rendering it as "## You" with no body is actively misleading.
test("renderSlice does not render a tool-result record as a human turn", () => {
  const toolResult = {
    type: "user", uuid: "tr", parentUuid: "a",
    message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "exit 0" }] },
  };
  const md = renderSlice({ nodes: [user("a", "run it"), toolResult, asst("b", "done")] });
  const youCount = (md.match(/## You/g) || []).length;
  assert.equal(youCount, 1, "only the real human turn should be labelled You");
});

test("renderSlice omits turns that carry neither text nor a tool call", () => {
  const empty = { type: "assistant", uuid: "e", parentUuid: "a", message: { content: [] } };
  const md = renderSlice({ nodes: [user("a", "hi"), empty, asst("b", "hello")] });
  assert.ok(!md.includes("no text in this turn"), "empty turns must be dropped, not narrated");
});

test("renderSlice keeps a thinking-only assistant turn out of the transcript", () => {
  const thinkingOnly = {
    type: "assistant", uuid: "t", parentUuid: "a",
    message: { content: [{ type: "thinking", thinking: "hmm" }] },
  };
  const md = renderSlice({ nodes: [user("a", "hi"), thinkingOnly] });
  const claudeCount = (md.match(/## Claude/g) || []).length;
  assert.equal(claudeCount, 0, "a turn with no visible output adds nothing to a quote");
});

test("renderSlice still keeps an assistant turn that only made tool calls", () => {
  const toolOnly = {
    type: "assistant", uuid: "t", parentUuid: "a",
    message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
  };
  const md = renderSlice({ nodes: [user("a", "list files"), toolOnly] });
  assert.match(md, /Bash/, "what Claude DID is real content");
});

test("renderSlice reports the turn count it actually rendered", () => {
  const empty = { type: "assistant", uuid: "e", parentUuid: "a", message: { content: [] } };
  const md = renderSlice({ nodes: [user("a", "hi"), empty, asst("b", "hello")] });
  assert.match(md, /2 turns/, "the header must count rendered turns, not raw records");
});

// Real output showed runs of 8+ consecutive tool-only turns. Individually they
// are legitimate content; as a wall they crowd out the reasoning you came for.
test("renderSlice collapses a run of consecutive tool-only turns", () => {
  const toolTurn = (uuid, name) => ({
    type: "assistant", uuid, parentUuid: null,
    message: { content: [{ type: "tool_use", name, input: { command: "x" } }] },
  });
  const md = renderSlice({
    nodes: [
      user("a", "go"),
      toolTurn("t1", "Bash"), toolTurn("t2", "Bash"), toolTurn("t3", "Read"),
      toolTurn("t4", "Bash"), toolTurn("t5", "Grep"),
      asst("z", "here is what I found"),
    ],
  });
  const usedLines = (md.match(/_used \*\*/g) || []).length;
  assert.ok(usedLines <= 1, `expected a collapsed run, got ${usedLines} separate tool lines`);
  assert.match(md, /5 tool calls/, "the run should state how many calls it covers");
  assert.match(md, /Bash/, "and which tools were involved");
  assert.match(md, /here is what I found/, "surrounding reasoning must survive");
});

test("renderSlice leaves a single isolated tool call uncollapsed", () => {
  const one = {
    type: "assistant", uuid: "t", parentUuid: null,
    message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
  };
  const md = renderSlice({ nodes: [user("a", "list"), one, asst("z", "done")] });
  assert.match(md, /_used \*\*Bash\*\*/, "one call reads fine on its own");
});
