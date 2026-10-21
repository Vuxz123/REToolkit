# Global retk command on Windows

The user explicitly requests a Node-installed command usable directly in CMD,
like REA. Use the existing npm `bin.retk = ./re.js` mapping and npm's standard
global symlink/shims. Avoid a custom PATH editor or unrelated runtime migration.

After Node24 installation, run `npm ci` and `npm run cli:install` from the cloned
toolkit. The script runs `npm link --offline --ignore-scripts --no-audit --no-fund`.
This registers `retk`, `retk.cmd`, and `retk.ps1` in the npm global prefix, without
publishing a package or installing vendor engines. The checkout stays the toolkit
root even when commands run from other working directories. Keep the checkout at
its installed path; rerun registration after moving it. Document `npm unlink
--global retoolkit` and the standard npm-prefix PATH troubleshooting procedure.

Alternatives: a copied global package would separate existing engines/workspaces
from the live checkout; a hand-written wrapper/PATH editor duplicates npm's shim
management. Choose the source link to preserve this user's existing toolkit.
Do not advertise `npm install -g retoolkit` from the public registry: no release
has been published by this task. Keep `private: true` and lock/dependencies intact.

Add `retk --version`/`-v` and make main help recommend `retk` syntax. Existing
`node re.js`/`re.cmd` entrypoints remain valid. Version flags accept no extra
operands. Documentation and repo install skill lead with the global-command flow.

Verification uses an isolated npm prefix and caller directory, exercising actual
npm-generated CMD shims, help/version, root resolution, JSON and forwarded exit
codes. No registry download, vendor execution or user-engine replacement. Then
hash-guarded delivery and complete JS/PS suites. Register the user's real global
command only after review/tests and checking no existing retk command is occupied.
Global registration is authorized by the explicit install-command request; no
publication, commit, global skill change or custom PATH edit is included.
