# Locked Python/MCP runtime

Continue the approved JS-first roadmap after release hardening. Implement an
offline-wheel installation path for the MCP CLI. Keep the previous uncommitted
M5 changes and user's unrelated files. Do not change this machine's installed
Python, virtualenvs, extensions or active runtime during implementation.

## Architecture and scope

Create each runtime at its final unique path `runtime/python/generations/<UUID>`.
It contains `python/` (portable CPython ZIP), `site/` (locked wheel installation),
and `receipt.json`. Never rename a built generation or modify an older one.
An atomic `runtime/python/active.json` pointer selects a completed generation;
rollback restores the previous pointer's exact bytes. Prior generations remain.
This avoids relocating virtualenv launchers with absolute interpreter paths.
No virtualenv, global pip, registry, PATH edit, online dependency resolution or
package source-build step is used.

Support CPython3.12 Windows x64 and fixed MCP console entry
`bridge_mcp_ghidra.cli:main` from `ghidra-mcp-bridge`. Managed PyGhidra GUI,
extension deployment and .NET remain separate; their legacy runtime stays usable.
No pointer means legacy MCP fallback. A present but invalid pointer/receipt must
block managed MCP, not silently fall back or block unrelated native preparation.

## Lock and receipts

Lock schema1 exact fields:
`{kind:'retoolkit-python-lock',schemaVersion:1,platform:'win32-x64',
 python:{version:'3.12.x',source:<source>,archiveRoot:<safe prefix or ''>},
 pip:{name:'pip',version:<exact>,filename:<safe .whl basename>,source:<source>},
 wheels:[{name:<canonical lowercase PEP503 name>,version:<exact>,
          filename:<safe .whl basename>,source:<source>}...]}`.
Source is `{url,sha256,size,verification}` with the same HTTPS immutable asset,
actual digest/size and checksum-provenance rules as the archive lock. Python URL
ends.zip; wheel URLs end.whl. At most256 unique normalized wheel names, pip is not
duplicated in wheels, `ghidra-mcp-bridge` is mandatory. No extras, ranges, sdists,
credentials/query/fragments or arbitrary entry/probe commands. Lock<=1MiB;
combined downloaded bytes<=8GiB. Do not invent vendor hashes in a runnable lock.

Receipt exact fields:
`{kind:'retoolkit-python-receipt',schemaVersion:1,platform:'win32-x64',
 generation:<UUID>,createdAt:<ISO>,lockFingerprint:<sha256>,
 python:<lock python>,pip:<lock pip>,wheels:<lock wheels>,
 probe:{pythonVersion:<exact>,bits:64,implementation:'cpython',
        distributions:[{name,version}],entryPoint:'bridge_mcp_ghidra.cli:main'},
 files:[{path,size,sha256}],limitations:[<strings>]}`.
Inventory paths are relative to generation; every file except root receipt.json
is included. Byte budget128MiB and shared path/count caps apply; no links/case
collisions/path traversal. Empty directories do not imply executable identity.
Active pointer: `{kind:'retoolkit-python-active',schemaVersion:1,
 generation:<UUID>,receiptSha256:<hash of exact receipt bytes>}`.
Missing receipt is unknown; wrong pointer/schema/hash/input facts/file inventory
are invalid/changed. Verify is readonly. Never persist secrets or absolute paths
in receipts. Probe metadata must match the exact locked distribution set.

## Installation transaction

Reuse the M5 safe downloader/private verified archive copy/ZIP extractor as a
shared module, retaining all26 archive installer regressions. Cache filenames
remain content-addressed; private wheel copies have the locked wheel basenames.
Validate wheel ZIP paths/types/CRC before pip; aggregate archive count/expanded
bytes across Python+all wheels (100k entries/8GiB), metadata paths128MiB and
64-component paths. Reject .pth, sitecustomize.py and usercustomize.py in wheels
because managed launch does not execute site startup hooks. Wheel metadata files
are bounded at1MiB. All caches stay outside workspaces/generations/transactions.

Hold the existing exclusive toolchain writer gate, inspect workspace/process
idleness before building and activation. Download/copy/verify sources, extract
runtime, require nonempty python.exe and reject pyvenv.cfg. Preflight probe actual
CPython version/bits under isolated flags. Execute only the explicitly locked
Python/pip locally; plan must disclose this. Use the pinned pip wheel on sys.path,
not the interpreter's bundled/global pip. Generate name==version requirements
with --hash=sha256 for every wheel. Pip uses --isolated --no-index --no-deps
--only-binary=:all: --require-hashes --no-compile --no-cache-dir --no-input,
targeting generation/site with the private wheelhouse. Disable all pip config
using PIP_CONFIG_FILE=NUL and strip inherited credentials/index/proxy/Python vars.
APPDATA/HOME/TEMP for install probes point into transaction-owned directories.

Run pip check and a fixed metadata/import probe. Check exact locked distributions,
entry metadata and callable bridge entry. No GUI/JVM, MCP server, connect_instance
or target query during install. Python executes with -B -I -S; runtime launch also
uses those flags and inserts only the selected site path. Never use generated .exe
console scripts. This avoids bytecode mutations and absolute shebang relocation.
Do not claim a malicious reviewed archive is sandboxed merely because it is hashed.

Only after all bounded probes and inventory checks succeed, write receipt, recheck
sources/inventory/old pointer, journal activation intent and replace active.json.
Verify active state and then commit journal. On failure restore previous pointer;
retain failed generation/journal. Unknown rollback or Python timeout preserves
writer gate for inspection. Do not release a gate from PID evidence alone.
The runner owns only its new Python process, drains bounded output, uses a deadline
and confirms actual close before returning; timeout/cancellation uncertainty keeps
the install gate. No unbounded wait or logs of inherited environment/credentials.

## CLI and use

`python-runtime plan <lock>`, `python-runtime install <lock> [--cache <folder>]`,
`python-runtime verify`, with --root/--json. Plan and verify are offline/readonly.
The retained installer gets -PythonManifest with existing -Plan/-PackageCache,
delegating early; reject mixed locked/archive/legacy flags before temp sweeps.

`node re.js mcp` and doctor --probe choose a managed command only when active
selection exists. Acquire read lease before full receipt/file verification and
keep it through bridge close (probe already owns such a lease). Corrupt managed
state blocks MCP with stable codes. Diagnostics use declared/verified managed
bridge version rather than confusing interpreter or MCP SDK versions. Native
Ghidra preparation stays independent of a broken optional managed MCP profile.

## Tests and qualification

TDD for schema, duplicate wheel names, offline command args, config/environment
isolation, bounded streams/deadlines, exact dependency/probe reports, sources,
tamper, stable generation paths, pointer rollback/uncertainty, junctions/paths,
managed launch and legacy fallback. Existing175 JS/7 PS suites remain passing.
Real offline smoke uses a copied installed CPython and its bundled pip wheel,
plus tiny source-owned wheels; it must not activate a production profile or
download/run a real vendor MCP wheel. Report fixture capability separately from
actual bridge/plugin compatibility. Independent spec then quality reviews.

Sources: [Python venv portability](https://docs.python.org/3/library/venv.html),
[pip secure installs](https://pip.pypa.io/en/stable/topics/secure-installs/),
[pip config disable](https://pip.pypa.io/en/stable/topics/configuration/).
