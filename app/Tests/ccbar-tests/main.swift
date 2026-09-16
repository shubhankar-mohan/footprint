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

// 3b. Usage (statusline rate_limits) decodes
let usageJSON = #"{"sessions":[],"pending":[],"aggregate":"idle","usage":{"fiveHour":{"used_percentage":42.5,"resets_at":1738425600},"sevenDay":{"used_percentage":10,"resets_at":1738857600}}}"#
let us = try! JSONDecoder().decode(Snapshot.self, from: Data(usageJSON.utf8))
check(us.usage?.fiveHour?.usedPercentage == 42.5, "decodes usage.fiveHour.used_percentage")
check(us.usage?.fiveHour?.resetsAt == 1738425600, "decodes usage resets_at (epoch)")
check(us.usage?.peakPercentage == 42.5, "usage peakPercentage = max window")

// 4. SessionStore reports newly-needs sessions once
let store = SessionStore()
_ = store.apply(Data(#"{"sessions":[{"id":"a","state":"working"}],"pending":[],"aggregate":"working"}"#.utf8))
let newly = store.apply(Data(#"{"sessions":[{"id":"a","state":"needs"}],"pending":[],"aggregate":"needs"}"#.utf8))
check(newly == ["a"], "apply reports a newly-needs session")
let again = store.apply(Data(#"{"sessions":[{"id":"a","state":"needs"}],"pending":[],"aggregate":"needs"}"#.utf8))
check(again.isEmpty, "does not re-report a session already in needs")
check(store.snapshot.aggregate == .needs, "store holds latest snapshot")

// 5. Port file: bare integer (today's format) and JSON with a pid (the bridge's
// new one). A pid that isn't running means a crashed bridge left the file behind.
check(BridgePaths.parsePortFile("54321\n") == 54321, "parses a bare integer port")
check(BridgePaths.parsePortFile("  ") == nil, "empty port file is nothing")
check(BridgePaths.parsePortFile("garbage") == nil, "unparseable port file is nothing")
check(BridgePaths.parsePortFile("0") == nil, "port 0 is not a port")
let alive = ProcessInfo.processInfo.processIdentifier
check(
  BridgePaths.parsePortFile("{\"port\":54321,\"pid\":\(alive),\"startedAt\":1}") == 54321,
  "parses JSON port whose pid is alive")
check(
  BridgePaths.parsePortFile("{\"port\":54321,\"pid\":999999,\"startedAt\":1}") == nil,
  "JSON port whose pid is dead is stale")
check(
  BridgePaths.parsePortFile("{\"port\":54321}") == 54321,
  "JSON port with no pid is taken at face value")
check(BridgePaths.isProcessAlive(alive), "isProcessAlive sees this process")
check(!BridgePaths.isProcessAlive(0), "isProcessAlive rejects pid 0")


// ── installed terminals ───────────────────────────────────────────────────
// The Start sheet used to offer Warp, Terminal and iTerm unconditionally, and
// defaulted to Warp because that happened to be the author's setup. On a Mac
// without Warp the default was a terminal that does not exist, and "Start a
// session" failed at the click.
print("\nTerminal detection")

let all = TerminalChoice.allKnown
check(all.contains { $0.id == "Terminal" }, "Apple Terminal is a known choice")
check(all.contains { $0.id == "Warp" }, "Warp is a known choice")
check(all.contains { $0.id == "iTerm" }, "iTerm is a known choice")

let installed = TerminalChoice.installed()
check(!installed.isEmpty, "at least one terminal is always found")
check(
  installed.contains { $0.id == "Terminal" },
  "Apple Terminal ships with macOS, so it is always available as a fallback"
)
check(
  installed.allSatisfy { c in all.contains { $0.id == c.id } },
  "installed is a subset of known"
)

// The default must be something the machine actually has.
let fallback = TerminalChoice.defaultChoice()
check(
  installed.contains { $0.id == fallback.id },
  "the default terminal is one that is actually installed"
)

// A remembered choice that is no longer installed must not be honoured —
// uninstalling Warp should not leave Start permanently broken.
check(
  TerminalChoice.resolve("Warp-That-Does-Not-Exist").id == fallback.id,
  "an unknown or uninstalled remembered choice falls back"
)
check(
  TerminalChoice.resolve("Terminal").id == "Terminal",
  "an installed remembered choice is kept"
)

// 12. Usage freshness. The poller backs off when the endpoint rate limits us,
// so the reading on screen can legitimately be several minutes old. What it must
// never do is present a frozen number as a live one.
let nowMs = Date().timeIntervalSince1970 * 1000
func usageSnapshot(agedMinutes: Double) -> Usage? {
  let at = nowMs - agedMinutes * 60 * 1000
  let j = #"{"sessions":[],"pending":[],"aggregate":"idle","usage":{"fiveHour":{"used_percentage":17,"resets_at":1789596000},"updatedAt":\#(at)}}"#
  return try? JSONDecoder().decode(Snapshot.self, from: Data(j.utf8)).usage
}

check(usageSnapshot(agedMinutes: 2)?.updatedAt != nil, "decodes usage.updatedAt")
check(usageSnapshot(agedMinutes: 2)?.isStale == false, "a two-minute-old reading is current")
check(
  usageSnapshot(agedMinutes: 40)?.isStale == true,
  "a forty-minute-old reading is stale — past any normal backoff"
)
check(usageSnapshot(agedMinutes: 40)?.ageDescription == "40m", "describes its age in minutes")
check(usageSnapshot(agedMinutes: 150)?.ageDescription == "2h", "describes a long age in hours")

// No updatedAt at all means an older bridge, not a stale reading. Crying wolf
// on every upgrade would teach the user to ignore the warning.
let noStamp = try! JSONDecoder().decode(
  Snapshot.self,
  from: Data(#"{"sessions":[],"pending":[],"aggregate":"idle","usage":{"fiveHour":{"used_percentage":17}}}"#.utf8)
)
check(noStamp.usage?.isStale == false, "a reading with no timestamp is not called stale")

print(failures == 0 ? "\nALL CHECKS PASSED ✓" : "\n\(failures) FAILURES ✗")
exit(failures == 0 ? 0 : 1)
