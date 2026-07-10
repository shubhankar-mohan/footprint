import { test } from "node:test";
import assert from "node:assert";
import { decisionOutput } from "../lib/hookdecision.js";

test("preToolUse allow → permissionDecision shape", () => {
  const out = decisionOutput("preToolUse", "allow", "ok");
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "allow");
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, "ok");
});

test("preToolUse ask → permissionDecision ask (never null)", () => {
  const out = decisionOutput("preToolUse", "ask", "timeout");
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
});

test("permissionRequest allow → decision.behavior shape", () => {
  const out = decisionOutput("permissionRequest", "allow");
  assert.equal(out.hookSpecificOutput.hookEventName, "PermissionRequest");
  assert.equal(out.hookSpecificOutput.decision.behavior, "allow");
});

test("permissionRequest allow with updatedInput carries it", () => {
  const out = decisionOutput("permissionRequest", "allow", "", { command: "echo hi" });
  assert.deepEqual(out.hookSpecificOutput.decision.updatedInput, { command: "echo hi" });
});

test("permissionRequest deny → behavior deny", () => {
  const out = decisionOutput("permissionRequest", "deny");
  assert.equal(out.hookSpecificOutput.decision.behavior, "deny");
});

test("permissionRequest ask → null (print nothing, Claude prompts)", () => {
  assert.equal(decisionOutput("permissionRequest", "ask"), null);
});
