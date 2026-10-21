# Global retk command verification — 2026-10-20

The user requested an installed command usable directly from CMD after installing
Node.js. The existing npm `bin.retk` mapping now has a documented registration
script: `npm ci`, then `npm run cli:install`. Registration uses standard offline
npm link with lifecycle scripts, audit and funding disabled. The source checkout
continues to own engines and workspaces when invoked from another directory.

`retk --version`/`-v` report package version `0.2.0`; main help advertises the
installed command. Direct `node re.js` and `re.cmd` still work. No package was
published to the registry, no dependencies changed, and no PATH editor was added.

## Tests and review

- Existing baseline: **514 JS tests passed**; **268 production paths** were
  backed up and hashed before delivery.
- Worktree `npm test`: **515 passed, 0 failed, 0 skipped**.
- Worktree `npm run test:legacy`: **7 PowerShell suites passed**.
- TDD RED: the new CLI test failed on unimplemented `--version`; GREEN:
  **4/4 CLI tests passed**, including `-v`, extra-argument refusal and help.
- `npm run test:cli-install` passed: actual npm registration in an isolated
  global prefix, real `retk.cmd` from another directory, version/help, JSON
  diagnostics, original toolkit-root resolution, explicit-root fixture init,
  error exit codes, unlinking and unchanged package/lock bytes.
- The initial smoke fixture used CLI `--prefix`, which npm also uses to select
  its source project. Inspection of installed npm11 code identified that test
  harness mistake. Setting `npm_config_prefix` isolates only the global
  destination while preserving source discovery; the actual npm script then
  passed without registry access. Production registration uses the existing
  configured prefix and needs no override.
- Independent read-only review found no important issues and separately passed
  **4 CLI tests** plus the isolated real npm/CMD smoke.

## Main installation and verification

Delivered **10 owned files** with hash guards, preserving all **262 other
baseline paths** byte-for-byte. Main repeated **515/515 JS tests**, **7/7
PowerShell suites** and the isolated npm/CMD smoke successfully. Whitespace
checks passed. No blanket synchronization or commit was used.

After confirming that no `retk` command or global package was occupied, the
reviewed main checkout was registered in
`C:\Users\DPC00176\AppData\Roaming\npm` through the actual npm script.
From a foreign CMD working directory, `retk --version` returned `0.2.0`,
`retk --help` passed, and `retk doctor --json` returned exit0 with engine paths
under `C:\Users\DPC00176\REToolkit`. This diagnostic check is not vendor
engine execution or analysis acceptance. The package and lock bytes stayed
unchanged; PATH was already configured and was not edited. No registry
publication occurred. Local evidence: `.worktrees/command-registration.json`,
`.worktrees/command-delivery.json` and `.worktrees/command-main-*.log`.

## Boundaries

This is a source-linked local installation. Keep the checkout at its registered
path; re-register after moving it. The npm global prefix must already be on PATH
for bare `retk`; the command does not silently edit PATH. Relative build/lock/
output paths still resolve from the caller's directory; use absolute paths when
calling elsewhere. No public npm package installation is implied.

Registration does not install Node itself, download engines, alter engine state,
update global agent skills, run a vendor engine, commit or push changes.
