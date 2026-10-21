# Global retk command implementation

**Goal:** Node24 plus npm installation makes `retk` usable directly from CMD.

**Architecture:** Existing npm bin mapping, a standard source-link registration
script, version output and current command docs. Keep toolkit data in its checkout.

- [x] Back up existing main hashes and reuse ignored worktree; baseline514.
- [x] RED/GREEN `test/cli.test.js`: `--version`/`-v` report package version,
  mixed arguments fail, help advertises `retk`. Add `cli:install` npm script
  using offline npm link with scripts/audit/funding disabled.
- [x] Add optional `test/cli-install-smoke.mjs` and `test:cli-install` script:
  isolated npm prefix/caller directory; actual generated CMD shim runs help,
  version, JSON doctor and explicit-root init. Check failure exit codes; unlink
  only isolated registration and prove source checkout remains intact.
- [x] README, CLAUDE and install skill document global command installation,
  linked-root semantics, uninstall, Node24 and npm-prefix PATH troubleshooting.
- [x] Independent code review; full JS/PS suites and isolated install smoke.
- [x] Hash-guarded scoped delivery; repeat checks in main; inspect real command
  collisions, register main checkout in existing npm prefix and verify from a
  foreign CMD working directory. Record limits/evidence. No commit or publish.
