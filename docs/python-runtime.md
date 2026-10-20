# Locked Python and MCP CLI

`python-runtime` manages Windows x64 CPython 3.12 and the Python MCP CLI. It uses
the same engine read/write leases and checked ZIP/cache primitives as the archive
installer. Existing GUI/PyGhidra Python, Ghidra extensions and global .NET stay on
their separate setup paths. This does not qualify a compatible vendor release set.

```powershell
node re.js python-runtime plan config/my-python.lock.json --json
node re.js python-runtime install config/my-python.lock.json --cache D:\RetkPackages --json
node re.js python-runtime verify --json
# Equivalent early PowerShell delegation:
.\install-re-toolkit.ps1 -PythonManifest config/my-python.lock.json -Plan
.\install-re-toolkit.ps1 -PythonManifest config/my-python.lock.json -PackageCache D:\RetkPackages
```

All commands accept `--root <toolkit>`. Plan and verify do not access the network
or create files. Install downloads only missing assets, checking their exact byte
count and SHA256. A prepopulated `<sha256>.zip` cache also holds wheel bytes; the
transaction copies them to their locked `.whl` filenames. Cache must remain
outside runtime/engine trees, workspaces, transactions and lease directories.
Manifest flags cannot mix with each other or with legacy install/version flags;
delegation happens before any legacy temporary-directory cleanup.

## Lock schema

Schema1 requires exactly the fields shown below. Placeholders are explanatory
and deliberately fail validation; supply real immutable asset URLs, versions,
filenames, sizes and hashes. No runnable vendor lock with invented hashes ships.

```json
{
  "kind": "retoolkit-python-lock",
  "schemaVersion": 1,
  "platform": "win32-x64",
  "python": {
    "version": "<3.12.patch>",
    "archiveRoot": "<ZIP root folder, or empty string>",
    "source": {"url": "https://<publisher>/<release>.zip", "sha256": "<64 lowercase hex>", "size": 123, "verification": "publisher-checksum"}
  },
  "pip": {
    "name": "pip", "version": "<exact>", "filename": "<actual wheel basename>.whl",
    "source": {"url": "https://<publisher>/<pip-wheel>.whl", "sha256": "<64 lowercase hex>", "size": 123, "verification": "publisher-checksum"}
  },
  "wheels": [{
    "name": "ghidra-mcp-bridge", "version": "<exact>", "filename": "<actual bridge wheel basename>.whl",
    "source": {"url": "https://<publisher>/<bridge-wheel>.whl", "sha256": "<64 lowercase hex>", "size": 123, "verification": "publisher-checksum"}
  }]
}
```

Include **every dependency** in `wheels`, with canonical lowercase dashed package
names, exact versions and real wheel filenames. Pip is a separate pinned bootstrap;
do not duplicate it in `wheels`. URLs require HTTPS without credentials, queries,
fragments, `latest` or branch names. Use `recorded-download` instead of
`publisher-checksum` when recording bytes without an authenticated publisher
checksum; neither label makes REToolkit authenticate a provenance assertion.

Limits: lock1MiB; at most256 dependency wheels; aggregate source/expanded data8GiB;
aggregate ZIP entries100,000; paths64 components/32,768 characters; path/inventory
metadata128MiB; wheel metadata files1MiB. ZIP path/link/case/CRC checks run before
Python. Wheel startup hooks (`.pth`, `sitecustomize.py`, `usercustomize.py`) are
rejected. Sources must supply a nonempty `python.exe` and no `pyvenv.cfg`.

## Build, selection and launch

Each install creates `runtime/python/generations/<UUID>/{python,site,receipt.json}`
at its final path **before executing Python**. It never moves a built environment.
Python documents that virtualenvs contain absolute interpreter paths and should be
recreated when moved. [Python venv documentation](https://docs.python.org/3/library/venv.html).

Install executes the explicitly locked interpreter and pip locally. Hash checking
does not sandbox this code. Fixed `-B -I -S` bootstraps use the pinned pip wheel,
an offline private wheelhouse, exact hashed requirements and `--no-deps`,
`--only-binary=:all:`, `--require-hashes`, `--no-index`, `--no-compile`,
`--no-cache-dir`, `--no-input`, `--isolated` and `--disable-pip-version-check`.
All pip config is disabled with `PIP_CONFIG_FILE=NUL`; install HOME/APPDATA/TEMP
are private, inherited indexes/proxies/credentials are excluded. This follows
[pip hash checking](https://pip.pypa.io/en/stable/topics/secure-installs/) and
[config disabling](https://pip.pypa.io/en/stable/topics/configuration/).

Before selection, the installer checks CPython version/bits, pip version,
`pip check`, the exact installed distribution set, fixed console entry metadata
and a callable `bridge_mcp_ghidra.cli:main` import. It does not start MCP, a JVM,
GUI or target query. The Python tree must remain unchanged during wheel install.
Each bounded probe owns its Python child, drains output and confirms close;
timeouts or cancellation retain installation ownership for inspection.

Only a completed receipt with the exact file inventory can be selected by
`runtime/python/active.json`. The pointer records the generation UUID and hash of
the exact receipt bytes. Publication verifies sources, files, process idleness and
the prior pointer again. Known failures restore the previous pointer byte-for-byte.
Prior and failed generations remain, alongside journals in
`.cache/python-runtime/transactions/<UUID>`. There is no automatic cleanup or
PID-only recovery. Uncertain rollback preserves the exclusive writer gate.

`node re.js mcp` and doctor probes acquire a reader before verifying all selected
files and retain it through bridge close. Launch uses the selected `python.exe`
with fixed isolated arguments and a minimal Java/discovery environment, avoiding
generated console launchers. No active pointer means the legacy bridge route.
A present invalid pointer, receipt or changed inventory blocks MCP without
silently falling back. Native preparation remains independent of this optional
runtime. Doctor identifies the managed bridge release from the receipt, separately
from the extension's Ghidra compatibility version or an MCP SDK server version.

`verify` returns exit1 for absent/invalid/changed state. If an already selected
profile is corrupt, install refuses replacement until its ownership and recorded
evidence are inspected; do not remove gates or edit receipt hashes to bypass it.
Restore known-good recorded bytes or perform an explicitly reviewed recovery.

## Qualification

`npm test` covers fixture schemas, offline arguments, bounded process ownership,
archive attacks, source/interpreter tamper, pointer rollback, launch and diagnostic
isolation. `npm run test:python-runtime` additionally copies an installed CPython
to Temp and uses its bundled pinned pip wheel plus source-owned bridge/dependency
wheels with networking refused. It never activates the production profile.
Real vendor wheels, extension compatibility, live GUI behavior and a publisher
checksum-backed release lock still require separate qualification.
