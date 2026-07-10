import Foundation

// The app's view of the bridge's /state snapshot. Grounded in the real captured
// payloads (docs/superpowers/specs/2026-07-11-hook-payloads.md) and the bridge's
// snapshot(): { sessions, pending, aggregate, sessionMap, ts }.

public enum SessionState: String, Codable, Sendable { case idle, working, needs, paused, ended }
public enum Tier: String, Codable, Sendable { case owned, attached, bestEffort = "best-effort" }
public enum Channel: String, Codable, Sendable { case preToolUse, permissionRequest }

public struct Session: Codable, Identifiable, Equatable, Sendable {
  public let id: String
  public var cwd: String?
  public var tier: Tier?
  public var tmux: String?
  public var state: SessionState
  public var tool: String?
  public var lastLine: String?
  public var updatedAt: Double?

  public var project: String { cwd.flatMap { $0.split(separator: "/").last.map(String.init) } ?? "—" }
}

public struct Pending: Codable, Identifiable, Equatable, Sendable {
  public let id: String
  public let sessionId: String
  public var channel: Channel?
  public var tool: String?
  public var input: [String: JSONValue]?
  public var createdAt: Double?

  public var command: String? {
    if case let .string(s)? = input?["command"] { return s }
    return nil
  }
}

public struct SessionMapEntry: Codable, Equatable, Sendable {
  public var cwd: String?
  public var tmux: String?
  public var project: String?
}

public struct Snapshot: Codable, Equatable, Sendable {
  public var sessions: [Session]
  public var pending: [Pending]
  public var aggregate: SessionState
  public var sessionMap: [String: SessionMapEntry]?
  public var ts: Double?

  public init(
    sessions: [Session], pending: [Pending], aggregate: SessionState,
    sessionMap: [String: SessionMapEntry]? = nil, ts: Double? = nil
  ) {
    self.sessions = sessions; self.pending = pending; self.aggregate = aggregate
    self.sessionMap = sessionMap; self.ts = ts
  }

  public static let empty = Snapshot(sessions: [], pending: [], aggregate: .idle, sessionMap: [:])

  /// needs > working > paused > idle. Defensive local recompute of the aggregate.
  public static func priority(_ states: [SessionState]) -> SessionState {
    if states.contains(.needs) { return .needs }
    if states.contains(.working) { return .working }
    if states.contains(.paused) { return .paused }
    return .idle
  }
}

// Minimal JSON value so arbitrary tool_input decodes losslessly.
public enum JSONValue: Codable, Equatable, Sendable {
  case string(String), number(Double), bool(Bool)
  case object([String: JSONValue]), array([JSONValue]), null

  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let b = try? c.decode(Bool.self) { self = .bool(b) }
    else if let n = try? c.decode(Double.self) { self = .number(n) }
    else if let s = try? c.decode(String.self) { self = .string(s) }
    else if let o = try? c.decode([String: JSONValue].self) { self = .object(o) }
    else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
    else { self = .null }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .string(let s): try c.encode(s)
    case .number(let n): try c.encode(n)
    case .bool(let b): try c.encode(b)
    case .object(let o): try c.encode(o)
    case .array(let a): try c.encode(a)
    case .null: try c.encodeNil()
    }
  }
}
