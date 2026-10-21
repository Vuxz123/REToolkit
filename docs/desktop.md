# Node desktop and reconstruction tools

Large exports can use `retk assets index Game --max-graph-mib 256` or `512`.
Default128MiB and250000-file/200000-node/1000000-edge caps remain bounded.
This selects local graph storage/memory budget; AI/desktop responses remain
paged and bounded. Known bulk payloads are explicit read-only hash descriptors;
object references and MonoBehaviour fields remain represented. Indexing success
does not establish successful Unity compilation or gameplay.

Install Node.js24+, then from this checkout:

```cmd
npm ci
npm run cli:install
npm run gui:install
retk gui
```

Electron44.9.1 is pinned. `gui:install` installs that vendor runtime and gives
Windows AppContainer read/execute access only to its binary directory. The
renderer retains sandbox/context isolation and no Node access. Typed operations
run the same Node CLI; closing the window waits for active commands. Job previews
are bounded; large results are saved under `.cache/desktop-jobs/<UUID>/result.json`.
Use operation receipts for durable evidence. This is a source checkout desktop,
not an installed standalone Windows exe.

## Private Ghidra GUI runtime

```cmd
retk desktop-runtime plan --lock config/desktop-windows-x64.lock.json
retk desktop-runtime install --lock config/desktop-windows-x64.lock.json
retk desktop-runtime verify
retk pyghidra-gui Game
retk ghidra-gui Game
retk desktop-launch status <run UUID>
```

The lock pins CPython3.12.10, PyGhidra3.1.0, JPype1.5.2 and all38 wheels,
GhidraMCP6.0.0 extension and local .NET8.0.22; installed Ghidra12.1.2 PUBLIC
is required. Python and settings remain separate from the main MCP profile.
Installer journals and immutable generations support owned-pointer rollback.
Use a reasonably short toolkit path: Windows native Python extensions have a
loader path limit. Invalid selected profiles block execution. Launch never
installs packages or silently repairs a venv.

Node owns a foreground JVM/GUI worker and workspace/toolchain leases through
observed close. `launched` means process spawn, not completed analysis, enabled
extension or connected MCP Program. No existing Ghidra window is killed or
unlocked. Native setup in the desktop requires an explicit reviewed native lock;
use `config/native-windows-x64.lock.json`.

## Image and video comparison

```cmd
retk visual compare Game --request visual-request.json
retk visual report Game --operation <UUID> --section summary
```

See [the request contract](../src/visual/README.md). Declare exact screen/state,
profile, required regions and explicit baseline provenance. The tool creates
hash-bound reports and diff PNGs, compares every required region and marks stale,
missing or mismatched evidence unverified. It never resizes captures implicitly.
Video requires an explicitly selected ffmpeg and aligned timestamps; unsupported
formats are not passes. Fixture comparisons prove mechanics, not game fidelity.
Typed `visual.compare`/`visual.report` tools are also available in assets MCP.

For large exports, select `sqlite` in the graph operation's storage field. See
[large-project storage and scoped migration](assets-storage.md) for CLI examples,
paging, storage limits and version2 manifest details.

## Script and field migration

```cmd
retk migration observe Game
retk migration plan Game --request migration.json --observations observations.json
retk migration apply Game --plan plan.json --observations observations.json
retk migration observe Game --receipt receipt.json
retk migration verify Game --receipt receipt.json --observations post-observations.json
```

Stop AssetRipper before migration. Observation uses the exact matching Unity
Editor and an isolated copy. Saved plan/output paths are under
`04_Notes/assets/migration/<UUID>`. Apply creates a fresh staged project and keeps
the original export unchanged. Use reported paths for subsequent commands.
The desktop and typed assets MCP expose these operations too.

Migration requires Editor-observed assembly/full type/GUID/local fileID and
serialized-value assertions. Supported scalar/object-reference field renames
preserve unlisted YAML/meta/large reference IDs. Compilation, bindings, values
and gameplay are separate results. DLLs remain retained; automatic DLL removal,
full DLL-to-C# conversion, arrays/nested/managed-reference fields and type
conversion remain unsupported and fail explicitly. IL2CPP dump stubs do not
recover the original method implementations.

## Visible-window regression

The desktop CLI explicitly launches Electron with `windowsHide:false`.
Background CLI jobs retain hidden-console startup. An offscreen image alone
does not prove that Windows displays the application window. Run
`node test/real-desktop-visible.mjs` for an isolated actual-CLI check that
asserts the native Electron window is visible and closes its own fixture.
