// Channel-aware permission decision output.
// One held request can resolve as either a PreToolUse `permissionDecision`
// or a PermissionRequest `decision.behavior`. Returns the JSON to hand back to
// the hook shim, or `null` meaning "print nothing" (PermissionRequest + ask:
// let Claude Code show its own prompt).

export function decisionOutput(channel, decision, reason = "", updatedInput = null) {
  if (channel === "permissionRequest") {
    if (decision === "ask") return null; // passthrough → Claude's own prompt
    const d = { behavior: decision }; // "allow" | "deny"
    if (decision === "allow" && updatedInput) d.updatedInput = updatedInput;
    if (reason) d.message = reason;
    return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: d } };
  }
  // default: preToolUse
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision, // "allow" | "deny" | "ask"
      permissionDecisionReason: reason || "via Claude Control Bar",
    },
  };
}
