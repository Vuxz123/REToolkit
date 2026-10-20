# Python/MCP lock implementation plan

Use superpowers:subagent-driven-development and TDD. Approved roadmap and user's
continue instruction authorize implementation; no new production installation.
Node24 ESM, existing ZIP dependencies and Python stdlib/pinned pip wheel only.

Module ownership and API contracts:

- Root owns `src/python-runtime/manifest.js`: `validatePythonLock`,
  `readPythonLock`, `planPythonRuntime(root,lock)`, `pythonLockFingerprint`,
  `validatePythonReceipt`, `validateActivePointer`, constants `ACTIVE_PATH`,
  `GENERATIONS_PATH`, `ENTRY_POINT`, `PYTHON_LIMITATIONS`.
- Root owns `verify.js`: `snapshotPythonGeneration(folder)` => files (exclude
  receipt.json only), `verifyPythonGeneration(root,generation)` => report,
  `inspectManagedPython(root)` synchronous => `{state:'absent'|'selected'|'invalid',
  generation?,receipt?,python?,site?,error?}`, `verifyPythonRuntime(root)` =>
  `{ok,state,errors,profile?,limitations}`. profile includes exact selected paths.
- Installer agent owns `src/toolchain/archive-io.js` extraction of existing safe
  primitives (and minimal installer.js imports), `src/python-runtime/installer.js`
  `installPythonRuntime(root,lock,{cache,fetchImpl,inspectProcesses,onEvent,
  executePython=defaultExecutePython}={})` and own tests. Import root manifest+
  verify and runner APIs. Own wheel ZIP preflight and Python generation journal.
- Runner agent owns `src/python-runtime/runner.js`, own tests and fixed bootstrap
  script constants. Exports `executePython(file,args,{cwd,env,timeoutMs}={})`
  -> `{stdout,stderr,exitCode}` (sanitized errors; timeout preserveToolchainGate),
  `pythonInstallEnvironment(transactionDir)` -> minimal isolated env,
  `pythonMcpEnvironment(toolkitEnv)` -> minimal launch env,
  `runPythonBuild({python,site,pipWheel,wheelhouse,requirements,expectedPython,
  wheels,transactionDir},{executePython}={})` -> receipt.probe.
  Provide `managedMcpArgs(site)` -> `['-B','-I','-S','-c',<fixed bootstrap>,site,
  '--transport','stdio']` calling fixed bridge_mcp_ghidra.cli.main. Helpers must
  validate/serialize JSON output and dependency/entrypoint exactness.
- Root owns launcher.js (`prepareMcpCommand(toolkit)` under caller read lease),
  toolkit/read descriptor/diagnostics/mcp-probe/re.js integration, new CLI and
  early PS -PythonManifest delegation, docs/package/real smoke/final delivery.

Installer layout: `runtime/python/generations/<runId>/{python,site,receipt.json}`.
Preflight extracted Python archive in a transaction dir then rename unexecuted
archiveRoot into final generation/python BEFORE any Python probe/pip command.
Private wheelhouse/requirements/probe HOME/cache/logs live in the transaction,
not the sealed generation. Journal path `.cache/python-runtime/transactions/<id>`.
Receipt and active pointer exact schemas are in design. Root verifier will be
ready early; coordinate missing exports instead of editing other owner's module.

Tasks:

- [x] Inspect current virtualenv mechanism, primary Python/pip docs; isolate and
  copy35 pending M5 files; hash137 baseline source files without unrelated files.
- [x] Baseline175 JS and7 PS; dependencies cached locally.
- [x] Runner agent: tests red/green for fixed command/environment/probe/deadline.
- [x] Installer agent: shared IO preservation tests, generation install/rollback/
  source/wheel/metadata bounds red/green, own self-review.
- [x] Root: manifest/receipt verification red/green, MCP selection/read lease and
  diagnostic isolation, strict CLI/PS delegation tests.
- [x] Independent spec review, fixes, independent quality review, fixes.
- [x] Full suites and real isolated Python/pip + source-owned wheel smoke.
- [x] Docs/roadmap/verification; guarded changed-file integration and root checks;
  preserve previous pending M5 and unrelated files; no commit/push or live update.
