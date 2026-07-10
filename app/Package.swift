// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ClaudeControlBar",
  platforms: [.macOS(.v13)],
  targets: [
    // Shared logic + views, so both the app and the test runner can use them.
    .target(name: "CCBarCore", path: "Sources/CCBarCore"),
    .executableTarget(
      name: "ClaudeControlBar",
      dependencies: ["CCBarCore"],
      path: "Sources/ClaudeControlBar"
    ),
    // XCTest is unavailable with Command Line Tools; this is a plain assertion
    // runner that exits non-zero on failure.
    .executableTarget(
      name: "ccbar-tests",
      dependencies: ["CCBarCore"],
      path: "Tests/ccbar-tests"
    ),
  ]
)
