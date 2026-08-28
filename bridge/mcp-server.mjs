#!/usr/bin/env node
// Footprint's MCP server. Claude Code launches this and talks JSON-RPC 2.0 over
// stdio, one JSON object per line.
//
// Register it with:
//   claude mcp add footprint -- node /path/to/bridge/mcp-server.mjs
//
// Everything it exposes is read-only against ~/.claude; the only thing it writes
// is the marks sidecar under CCBAR_DIR.
//
// stdout is the protocol channel and carries nothing but JSON-RPC. All logging
// goes to stderr — a stray console.log here would corrupt the stream and the
// client would drop the connection.

import { handleRequest } from "./lib/mcp.js";

const log = (...a) => process.stderr.write(`[footprint-mcp] ${a.join(" ")}\n`);

let buffer = "";

process.stdin.setEncoding("utf8");

process.stdin.on("data", async (chunk) => {
  buffer += chunk;

  // Newline-delimited JSON. A partial trailing line stays in the buffer until
  // the rest of it arrives.
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;

    let req;
    try {
      req = JSON.parse(line);
    } catch {
      log("dropped a malformed line");
      continue;
    }

    try {
      const res = await handleRequest(req);
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
    } catch (e) {
      log("handler threw:", String(e?.message || e));
      if (req?.id !== undefined && req?.id !== null) {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32603, message: "Internal error" },
          })}\n`
        );
      }
    }
  }
});

process.stdin.on("end", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

log("ready");
