# Windows vendor MCP qualification evidence

Local Windows qualification on2026-10-20, based on0ce7313. No production runtime,
virtualenv, Ghidra plugin, Program or workspace was replaced or queried.

## Observed real set

| Check | Result | Practical boundary |
| --- | --- | --- |
| CPython3.12.10 x64, pip25.0.1,35 locked vendor distributions | Offline install, pip check, exact metadata and callable entry passed | Runs only the explicitly supplied code in a private Temp generation |
| pywin32312 cp312-win_amd64 | Exact hook preserved in receipt; native imports passed under -B -I -S | Hook is not executed; only fixed local paths/DLL directory are added |
| GhidraMCP bridge6.0.0 | initialize and tools/list passed,30 advertised tools, actual child close | No tools/call, instance switch, discovery call or target content query |
| Extension6.0.0 + Ghidra12.1.2 | ZIP/layout/JAR and version metadata matched | No GUI plugin activation or live Ghidra protocol acceptance |
| Post-launch generation | Exact sealed file inventory unchanged | Does not attest any Program or analysis |

The bridge release is6.0.0. Initialize reports serverVersion1.28.1 from its MCP SDK;
that is not the bridge release. Advertised tools here are the initial discovery
surface; no tool groups were loaded. Upstream's explicit
[v6.0.0 release](https://github.com/bethington/ghidra-mcp/releases/tag/v6.0.0)
declares Ghidra12.1.2 and Java21 compatibility; local checks above are narrower.

## Artifact identity and provenance

The generated Python lock fingerprint is
`95203e60cd2f73473689d3bb46e01e1ff8e79f65dfd26f0eabc9b01d58d07f26`.
It pins the35 distribution versions observed in the existing toolkit metadata;
no dependency version resolution or source build occurred. Downloads were prepared
separately; the actual installation used only the prepopulated checked cache.

- Official Python.org embedded ZIP3.12.10 x64:11,133,606bytes,
  SHA256 `4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3`.
  Labeled recorded-download; no independent publisher signature was verified.
- PyPI pip/dependency wheel bytes matched published release JSON size/SHA256.
- Existing bridge/extension assets matched GitHubv6.0.0 release asset size/SHA256.
  Extension ZIP728,120bytes,
  SHA256 `867731de27d5143632a010943b907a6485dd54d0e19729e2f85ee9f692c99873`.
- The only .pth among36 wheels (pip plus35 distributions) was pywin32.pth,
 185bytes CRLF, SHA256
 `e7cd73df98b91c407dfd96d1f4dd18b7f9a60f29902b92cf5ece79b6eb637b81`.

The recorded publisher-checksum label for registry/release assets records those
published digests, not independent author/signature authentication. Downloaded
assets, generated lock, provenance and cache remain ignored under
`.worktrees/vendor-mcp-artifacts/`; no default vendor bundle is selected by code.

## Regression and review

The previous synthetic smoke omitted pywin32. Its real wheel contains a .pth that
the old installer correctly rejected, making the real Windows vendor set unusable.
The fix is an explicit, exact pywin32312 exception and controlled bootstrap rather
than enabling Python site startup. Unsupported versions, alternative hook paths,
lookalike distributions or altered hook bytes remain blocked before execution.

TDD covers the exception, retained DLL handle, native layout/metadata checks,
installed hook receipt/tamper, unsafe extension ZIPs and metadata mismatch. The
empty upstream Module.manifest exposed an overly strict test assumption; an empty
regular marker is now accepted while required JARs remain nonempty.

Independent spec review found and verified fixes for combined stdout/stderr byte
accounting, sanitized top-level failure reporting, bounded module-marker reads,
and missing failure-path tests. Transport tests cover page/tool limits, duplicate
names/cyclic cursors, EPIPE, deadlines, oversized frames, total output and uncertain
child close. Failures retain diagnostics; an unconfirmed child retains its lease.

Independent quality review additionally found acceptance of an unsupported
negotiated protocol and unterminated trailing output. Both regressions failed
before the fixes and passed afterward. Qualification now requires the requested
2025-03-26 protocol and rejects residual frames after confirmed close. The quality
re-review found no remaining actionable issues; all15 transport tests passed.

Final verification:

- Main checkout `npm test`:244/244 passed, zero failures/cancellations/skips.
- Main checkout `npm run test:legacy`:all7 Windows PowerShell5.1 suites passed.
- Source-owned `npm run test:python-runtime`:passed with no downloads or production
  activation, copied CPython/pip and two synthetic wheels; this is separate from
  the vendor result.
- Final real vendor smoke passed in both worktree and main checkout:35 installed
  distributions,30 advertised tools, protocol2025-03-26, exact child close, zero
  install-time downloads, unchanged sealed inventory, zero target queries.
- `git diff --check` and whitespace checks for all new files passed.
- Exactly21 owned source/test/docs paths were integrated. Original bytes were
  backed up first; all other tracked files, including scripts/retk-core.ps1,
  remain byte-identical to the pre-task baseline. Unrelated untracked files were
  excluded. The feature worktree and artifact cache remain available; no commit
  or push was made in this continuation.

## Still separate

Live GUI/plugin activation, exact Program identity/querying, .NET/PyGhidra GUI
reproducibility, hosted CI and authorized real IL2CPP/game acceptance are not
established by this transport/static qualification. No engine comparison service
or GUI migration was introduced, and no live Jev call was sent.
