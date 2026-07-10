import Foundation
import CCBarCore

var failures = 0
func check(_ cond: Bool, _ msg: String) {
  if cond { print("  ✓ \(msg)") } else { print("  ✗ \(msg)"); failures += 1 }
}

// 1. Decode a real-shaped snapshot
let json = """
{"sessions":[{"id":"s1","cwd":"/repo/a","state":"working","tool":"Bash","updatedAt":1.0},
{"id":"s2","cwd":"/repo/b","state":"needs","tier":"owned"}],
"pending":[{"id":"p1","sessionId":"s2","channel":"permissionRequest","tool":"Bash",
"input":{"command":"echo hi"}}],
"aggregate":"needs","sessionMap":{"s1":{"cwd":"/repo/a","project":"a"}},"ts":1.0}
"""
let snap = try! JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
check(snap.sessions.count == 2, "decodes sessions")
check(snap.sessions[0].project == "a", "derives project from cwd")
check(snap.sessions[1].tier == .owned, "decodes tier")
check(snap.pending.first?.command == "echo hi", "extracts command from tool_input")
check(snap.pending.first?.channel == .permissionRequest, "decodes channel")
check(snap.aggregate == .needs, "decodes aggregate")

// 2. Aggregate priority
check(Snapshot.priority([.idle, .working, .needs]) == .needs, "needs wins")
check(Snapshot.priority([.idle, .working, .paused]) == .working, "working beats paused")
check(Snapshot.priority([.idle, .paused]) == .paused, "paused beats idle")
check(Snapshot.priority([.idle]) == .idle, "idle default")

// 3. Tolerates missing optional fields
let minimal = try! JSONDecoder().decode(
  Snapshot.self, from: Data(#"{"sessions":[],"pending":[],"aggregate":"idle"}"#.utf8))
check(minimal.sessions.isEmpty, "tolerates missing sessionMap/ts")

// 4. SessionStore reports newly-needs sessions once
let store = SessionStore()
_ = store.apply(Data(#"{"sessions":[{"id":"a","state":"working"}],"pending":[],"aggregate":"working"}"#.utf8))
let newly = store.apply(Data(#"{"sessions":[{"id":"a","state":"needs"}],"pending":[],"aggregate":"needs"}"#.utf8))
check(newly == ["a"], "apply reports a newly-needs session")
let again = store.apply(Data(#"{"sessions":[{"id":"a","state":"needs"}],"pending":[],"aggregate":"needs"}"#.utf8))
check(again.isEmpty, "does not re-report a session already in needs")
check(store.snapshot.aggregate == .needs, "store holds latest snapshot")

print(failures == 0 ? "\nALL CHECKS PASSED ✓" : "\n\(failures) FAILURES ✗")
exit(failures == 0 ? 0 : 1)
