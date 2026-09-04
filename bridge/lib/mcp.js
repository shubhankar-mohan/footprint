// The MCP surface: how a live Claude Code session reaches back into an old one.
//
//   mark  ──▶ names a node        ──▶ node://<session>/<uuid>
//   get_slice ──▶ that node's root→node path, as markdown, injected into context
//   list_marks ──▶ what you named earlier
//
// This is "quote the past" from docs/footprint-product-plan.md §3 — the honest
// reference that ADDS a recap rather than pretending to restore context. It
// reads transcripts directly, so it works whether or not the Bar is running.
//
// JSON-RPC 2.0 is hand-rolled to keep the bridge dependency-free (D1); the
// protocol surface we need is three methods wide.

import * as marks from "./marks.js";
import { sliceFor } from "./slicer.js";
import * as notes from "./notes.js";

const PROTOCOL_VERSION = "2024-11-05";

export const TOOLS = [
  {
    name: "get_slice",
    description:
      "Quote an earlier point in a Claude Code conversation. Returns everything from the start of that session up to the referenced turn, as markdown, so it can be added to the current context. Accepts either a node://<session>/<uuid> reference or the label of a mark you created earlier.",
    inputSchema: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "A node://<session>/<uuid> reference, or a mark label such as 'root-cause'.",
        },
        session: {
          type: "string",
          description: "Optional session id, used to disambiguate a bare label.",
        },
      },
      required: ["ref"],
    },
  },
  {
    name: "mark",
    description:
      "Give a memorable name to a turn in a Claude Code session so you can quote it later by name instead of by uuid. Marking the same node again replaces its label.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "The session id the turn belongs to." },
        uuid: { type: "string", description: "The uuid of the turn to mark." },
        label: { type: "string", description: "A short memorable name, e.g. 'root-cause'." },
      },
      required: ["session", "uuid", "label"],
    },
  },
  {
    name: "note",
    description:
      "Record why a turn mattered, in your own words. A mark is a label you quote by; a note is the reason behind it — the one thing the transcript cannot reconstruct later. Writing an empty note clears it.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "The session id the turn belongs to." },
        uuid: { type: "string", description: "The uuid of the turn to annotate." },
        text: { type: "string", description: "The note. A sentence or two is the point." },
      },
      required: ["session", "uuid", "text"],
    },
  },
  {
    name: "read_notes",
    description:
      "Read back the notes recorded against turns in a session. Use this to recover the reasoning behind an old decision without re-reading the whole transcript.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "The session id to read notes from." },
      },
      required: ["session"],
    },
  },
  {
    name: "list_marks",
    description:
      "List the marks you have created, optionally narrowed to one session. Use this to find out what can be quoted by name.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Optional session id to filter by." },
      },
    },
  },
];

const ok = (text) => ({ content: [{ type: "text", text }] });
const fail = (text) => ({ content: [{ type: "text", text }], isError: true });

async function callTool(name, args = {}) {
  switch (name) {
    case "get_slice": {
      const r = sliceFor(args.ref, { sessionId: args.session });
      return r.ok ? ok(r.markdown) : fail(r.error);
    }
    case "mark": {
      try {
        const m = marks.add({ sessionId: args.session, uuid: args.uuid, label: args.label });
        marks.flush();
        return ok(`Marked \`${m.label}\` → ${m.ref}\n\nQuote it later with: get_slice(ref: "${m.label}")`);
      } catch (e) {
        return fail(String(e.message || e));
      }
    }
    case "list_marks": {
      const list = marks.list(args.session);
      if (!list.length) {
        return ok(args.session ? `No marks in session ${args.session}.` : "No marks yet.");
      }
      const lines = list.map((m) => `- **${m.label}** — \`${m.ref}\``);
      return ok(`${list.length} mark${list.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}`);
    }
    case "note": {
      try {
        const saved = notes.set(args.session, args.uuid, args.text);
        notes.flush();
        return ok(saved
          ? `Noted against \`${args.uuid}\`:\n\n> ${saved}`
          : `Cleared the note on \`${args.uuid}\`.`);
      } catch (e) {
        return fail(String(e.message || e));
      }
    }
    case "read_notes": {
      const all = notes.forSession(args.session);
      const keys = Object.keys(all);
      if (!keys.length) return ok(`No notes in session ${args.session}.`);
      const lines = keys.map((u) => `- \`${u}\`\n  > ${all[u]}`);
      return ok(`${keys.length} note${keys.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}`);
    }
    default:
      return fail(`Unknown tool: ${name}`);
  }
}

export async function handleRequest(req) {
  // A notification carries no id and must never be answered.
  if (!req || req.id === undefined || req.id === null) return null;

  const reply = (result) => ({ jsonrpc: "2.0", id: req.id, result });

  switch (req.method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "footprint", version: "0.1.0" },
      });

    case "tools/list":
      return reply({ tools: TOOLS });

    case "tools/call":
      try {
        return reply(await callTool(req.params?.name, req.params?.arguments));
      } catch (e) {
        // A tool that throws is reported as a tool error, never as a dead server.
        return reply(fail(`Tool failed: ${String(e?.message || e)}`));
      }

    default:
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      };
  }
}
