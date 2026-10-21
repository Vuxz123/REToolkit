# Windows vendor MCP qualification

Continue approved M5 with CPython 3.12 x64, GhidraMCP bridge6.0.0 and its Windows
dependency pywin32. The existing strict wheel guard rejects pywin32.pth, so real
vendor installation is currently unsupported despite passing synthetic fixtures.
Use the current JavaScript installer and final-path generation architecture.

## Selected approach

Keep isolated Python (-B -I -S) and never evaluate arbitrary .pth files or call
site.addsitedir. A code-owned adapter supports only pywin32 312,
pywin32-312-cp312-cp312-win_amd64.whl. Permit only its root pywin32.pth whose
normalized content equals the known upstream file (CRLF/LF interchangeable),
bounded at1KiB, and retain it unchanged in the sealed inventory. Every other .pth,
sitecustomize.py and usercustomize.py stays forbidden. Reject unsupported pywin32
versions/filenames before executing Python. The exception is scoped to that wheel;
other distributions cannot supply a lookalike pywin32.pth.

A shared fixed Python bootstrap prefix inserts the selected site followed by its
win32, win32/lib and Pythonwin directories, and retains an os.add_dll_directory
handle for site/pywin32_system32. Enable this only when the selected site's
pywin32 distribution metadata declares version312. Require matching expected
layout. Do not import pywin32_bootstrap, run postinstall scripts, edit registry,
copy DLLs globally or use global Python/PATH. The fixed metadata probe also imports
pywintypes, win32api and win32event when pywin32 is installed, proving native
dependency loading before activation. MCP launch uses the identical prefix.
Pip's bootstrap remains first and independent; pip check still validates metadata.

Alternatives rejected: allowing site startup executes arbitrary hooks; omitting
pywin32 violates MCP's declared Windows dependency. No general plugin hook runner.

## Qualification harness

An explicit npm test:vendor-mcp accepts exactly four arguments: Python lock JSON,
prepopulated package cache, GhidraMCP extension ZIP, installed Ghidra directory.
Create a fresh owned Temp toolkit root. Install with fetch refused; a missing
cache fails. Its process-idle seam is valid only for this private new test root.
Do not select a runtime in the user's toolkit. Use private HOME/APPDATA/TEMP for
the bridge. Hold a read lease through actual child close; fixed managed command
comes from prepareMcpCommand after full verify. Verify sealed files after launch.

Handshake sends only initialize, notifications/initialized and paginated
tools/list. Never tools/call, list_instances, connect_instance, GUI or target
queries. Bound frames1MiB, total output4MiB, pages8, tools4096/page, deadline30s;
drain/drop stderr, sanitize errors. Terminate only the owned child, confirm close,
retain ownership/temp diagnostics if close is uncertain. Tools/list failure,
malformed output, deadline, early exit and broken stdin must never hang.

Extension ZIP is extracted by checked archive IO into private Temp. Read bounded
extension.properties and Module.manifest; require one GhidraMCP root and nonempty
lib JAR. Compare plugin6.0.0 with locked bridge version and extension Ghidra
compatibility version against actual application.properties. Hash exact ZIP
bytes. This proves static metadata/layout agreement, not plugin activation or
live GUI compatibility; the result explicitly leaves those unqualified.

Research uses real immutable Python.org embedded3.12.10 ZIP, pip25.0.1 wheel,
existing bridge6.0.0 wheel and downloaded exact PyPI wheels. Verify index/release
digests when available; label recorded-download honestly otherwise. Public
downloads and generated locks/cache remain ignored, never fabricated vendor
hashes or credentials. No publisher bundle is shipped as qualified by default.

## Verification and delivery

TDD pywin32 narrow exception/layout/import, handshake bounds/close, extension
mismatch/unsafe ZIP. Preserve215 baseline JS and7 PS suites. Run source-owned
Python smoke and real vendor smoke, report separately. Independent spec then
quality reviews. Integrate only explicit changed paths with original-byte
backup/hash guard; preserve scripts/retk-core.ps1, .claude and July documents.
No commit/push or production runtime activation is part of this continuation.
