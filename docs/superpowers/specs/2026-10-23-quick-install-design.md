# Quick installation on a new Windows machine

The user's request authorizes adding a quick installation path to the existing
Windows/Node toolkit. Keep the current checkout and all existing installation
commands; do not run a real installation, change this machine's PATH, or commit.

Use `install.cmd` from an extracted checkout. A thin PowerShell 5.1 bootstrap
selects Node >=24 with bundled npm, or downloads toolkit-local Node 24.15.0 x64
from nodejs.org using the checked-in SHA256/size lock. No Git, winget or admin
requirement is introduced. The portable Node archive is checked before extraction
and an existing extracted runtime is verified before reuse.

`node scripts/quickstart.mjs` owns installation after Node becomes available.
Default `full` installs frozen npm dependencies, Electron, native engines, the
separate GhidraMCP CLI Python runtime, and GUI Python/extension/local .NET.
`desktop` installs CLI+Electron; `cli` installs only the CLI dependencies/command.
The existing transactional installers retain ownership, hash checks and recovery
behavior. Verified matching runtimes can be reused; changed existing selections
fail for inspection. Never resume an uncertain write from a journal automatically.

A managed command shim pins the selected Node and absolute checkout entry point.
Append only its directory to the user's PATH, unless `--no-path` is requested;
never edit machine PATH or replace an unrelated global command. Explain command
collisions and require a new terminal to observe PATH changes. Do not auto-open
the GUI. This avoids npm global-prefix permissions and lets portable Node coexist
with older system Node without routing retk through that old executable.

Expose `--plan`, `--profile cli|desktop|full`, `--no-path`, `--cache`, `--json`,
and `--help`, plus `retk quickstart` after installation. Plan/help must be offline
and write-free even without Node. Use stage status, bounded summaries, per-stage
logs and a saved report; failure stops dependent stages and exits nonzero.
Reruns inspect real receipts, never trust a previous "done" flag. Close an active
toolkit GUI before replacing npm dependencies; do not kill it. A lock excludes
concurrent quick installers and is released only after owned work returns.
The `retk quickstart` variant also accepts global `--root <checkout>` so typed
desktop commands preserve their normal root binding; `install.cmd` stays bound
to its own checkout.

Unity Editor/modules/licenses, LDPlayer, harness installation/login, Jev API keys
and library archives remain explicit follow-up configuration. Installing packages
does not prove Ghidra activation, MCP connectivity or reconstructed gameplay.

Rejected alternatives: a new MSI introduces a separate release/update system;
winget requires another package manager and can modify system installations.
Portable bootstrap plus existing Node installers covers fresh machines directly.

Verification: fail-first orchestration/CLI/ownership/receipt tests, PowerShell
bootstrap plan and archive safety fixtures, isolated command/PATH planning tests,
and full Node regression. No engine or real user PATH mutation during acceptance.
