# Readable desktop results and evidence

User request: replace the GUI's raw JSON output with an understandable UI.
Retain the current desktop styling and use the same presenter for every job and
Jev connection checks. A successful CLI exit never establishes recovered-game
compilation, bindings or gameplay.

Use a status summary, selected metrics, labelled facts, actual HTML tables for
record arrays, expandable record details and a separate log section. Preserve
unknown fields with a bounded recursive inspector; never silently treat an
unverified result as a pass. Keep the original JSON behind a collapsed technical
details control. Artifact paths and identifiers can be copied without executing
paths or adding shell/file-opening IPC. Large stored results retain their path
and an explicit preview notice.

Copy uses one trusted-sender IPC operation accepting only text up to 64 KiB,
without NUL. Browser permissions stay denied. Only scalar bookkeeping values
move into collapsed technical metadata; nested unknown values remain in the
ordinary bounded inspector, with omission notices.

Separate a pure result model from a DOM presenter. The model has a title,
status {tone,label,description}, metadata [{label,value}], metrics, sections
[{title,node}], logs and raw JSON. Nodes are value/text/path/object/list/table.
Tables expose labelled columns and expandable details for fields outside columns.
Target content is always DOM text, never HTML. Bound depth, rows, fields and
text; indicate omitted previews and retain the original JSON or stored-result
path. No new dependencies, API requests, game operations or backend mutations.

Acceptance: graph coverage, doctor-like tool rows, Jev missing-auth, running and
failed jobs, incomplete Unity validation, plain text and large stored previews
all have readable presentations. A real sandboxed Electron fixture proves
tables, statuses, raw-detail toggles, preserved hostile strings and unchanged
typed IPC. Visual screenshots cover normal and error results. No Screwdom tests.
