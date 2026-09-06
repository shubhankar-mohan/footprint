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

import path from "node:path";
import * as marks from "./marks.js";
import { sliceFor, findTranscript } from "./slicer.js";
import * as notes from "./notes.js";
import { projectForCwd, projectLabel } from "./atlas.js";

const PROTOCOL_VERSION = "2024-11-05";

// ── the project boundary ──────────────────────────────────────────────────
//
// Claude Code launches an MCP server with its cwd set to the session's project
// directory, so process.cwd() is a reliable answer to "where is the user right
// now". Without that, get_slice would quote an unrelated project's transcript
// straight into the current conversation — on a machine holding both personal
// and employer code that is a data-boundary problem, not a papercut.
//
// So: reads default to the project you are standing in, and say plainly how to
// reach across when you mean to.

const SCOPE_PARAM = {
  type: "string",
  enum: ["project", "all"],
  default: "project",
  description:
    'Where to look. "project" (the default) stays inside the project you are working in. "all" reaches across every project on this machine — use it when you deliberately mean to quote other work.',
};

const BOUNDARY_NOTE =
  "By default this stays inside the project of your current working directory, so another codebase cannot leak into this conversation; pass scope \"all\" to reach across. If the working directory does not match any project on disk, nothing is restricted.";

// Read per call, not once at import. A project directory does not exist until
// that project has been used at least once, so a server started in a fresh
// checkout would otherwise be stuck on "unknown" for its whole life.
const here = () => projectForCwd(process.cwd());

// Which project a session lives in, by DIRECTORY. Labels are the friendly name
// and they collide — on the real corpus `-side-api-server` and `-work-api-server` are
// both "api-server" — and a boundary crossable by a coincidence of naming is not a
// boundary. The label is only ever used to talk to the user.
function projectOfSession(sessionId) {
  const fp = findTranscript(sessionId);
  if (!fp) return null;
  const dir = path.basename(path.dirname(fp));
  return { dir, name: projectLabel(dir) };
}

// null when the call may proceed; { cur, owner } when it crosses a boundary.
//
// Fails SAFE in both unknowable directions: an unrecognised cwd, or a session
// we cannot place, allows the call. A tool that silently refuses everything is
// worse than one that over-shares — the second is visible, the first just looks
// broken.
function crossing(sessionId, scope) {
  if (scope === "all") return null;
  const cur = here();
  if (!cur.known) return null;
  const owner = sessionId ? projectOfSession(sessionId) : null;
  if (!owner || owner.dir === cur.dir) return null;
  return { cur, owner };
}

// Deliberately calm. This is an expected outcome with an obvious next step, not
// a fault, so it names both projects, says why, and shows the exact call that
// overrides it.
function boundaryMessage(verb, { cur, owner }, example) {
  return [
    `Nothing was ${verb} — that belongs to a different project.`,
    "",
    `  it is in    ${owner.name}  (${owner.dir})`,
    `  you are in  ${cur.name}  (${cur.dir})`,
    "",
    "Footprint keeps remembered context inside the project you are working in, so an unrelated codebase cannot end up in this conversation by accident.",
    "",
    'If you meant to reach across, ask again with scope "all":',
    "",
    `    ${example}`,
  ].join("\n");
}

export const TOOLS = [
  {
    name: "get_slice",
    description:
      `Quote an earlier point in a Claude Code conversation. Returns everything from the start of that session up to the referenced turn, as markdown, so it can be added to the current context. Accepts either a node://<session>/<uuid> reference or the label of a mark you created earlier. ${BOUNDARY_NOTE}`,
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
        scope: SCOPE_PARAM,
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
      `Read back the notes recorded against turns in a session. Use this to recover the reasoning behind an old decision without re-reading the whole transcript. ${BOUNDARY_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "The session id to read notes from." },
        scope: SCOPE_PARAM,
      },
      required: ["session"],
    },
  },
  {
    name: "list_marks",
    description:
      `List the marks you have created, optionally narrowed to one session. Use this to find out what can be quoted by name. ${BOUNDARY_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Optional session id to filter by." },
        scope: SCOPE_PARAM,
      },
    },
  },
];

const ok = (text) => ({ content: [{ type: "text", text }] });
const fail = (text) => ({ content: [{ type: "text", text }], isError: true });

async function callTool(name, args = {}) {
  switch (name) {
    case "get_slice": {
      // Resolve the reference to a session BEFORE slicing, so a refused quote
      // is never built and never has a chance to be returned by accident.
      const target =
        marks.parseRef(args.ref) || marks.resolve(args.ref, args.session) || null;
      const cross = crossing(target?.sessionId, args.scope);
      if (cross) {
        return ok(boundaryMessage("quoted", cross,
          `get_slice(ref: ${JSON.stringify(String(args.ref))}, scope: "all")`));
      }
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
      // A listing is a search: it defaults to the project you are in, the same
      // as every other read here.
      if (args.session) {
        const cross = crossing(args.session, args.scope);
        if (cross) {
          return ok(boundaryMessage("listed", cross,
            `list_marks(session: ${JSON.stringify(String(args.session))}, scope: "all")`));
        }
      }
      const all = marks.list(args.session);
      const cur = args.scope === "all" ? null : here();
      const inScope = !cur || !cur.known
        ? all
        : all.filter((m) => (projectOfSession(m.sessionId)?.dir ?? cur.dir) === cur.dir);
      const elsewhere = all.length - inScope.length;
      const tail = elsewhere
        ? `\n\n${elsewhere} more in other projects — list_marks(scope: "all") to see them.`
        : "";

      if (!inScope.length) {
        const none = args.session ? `No marks in session ${args.session}.` : "No marks yet.";
        return ok(`${none}${tail}`);
      }
      const lines = inScope.map((m) => `- **${m.label}** — \`${m.ref}\``);
      return ok(`${inScope.length} mark${inScope.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}${tail}`);
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
      // A note is your own words about another project's work — still content
      // crossing into this conversation, so it sits behind the same door.
      const cross = crossing(args.session, args.scope);
      if (cross) {
        return ok(boundaryMessage("read", cross,
          `read_notes(session: ${JSON.stringify(String(args.session))}, scope: "all")`));
      }
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
