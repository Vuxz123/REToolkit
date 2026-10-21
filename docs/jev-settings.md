# Jev setup

Open `retk gui` → **Settings · Jev**. Save the model (default `jev-latest`)
and authentication environment-variable name (default `TYPESAFE_API_KEY`).
The API endpoint is fixed to the supported Typesafe endpoint to prevent keys
being forwarded to an arbitrary URL.

Enter an API key in the password field to use it for this GUI session. It is
passed directly to the trusted main process, kept in memory and inherited only
through the environment. It is never saved in the settings JSON or job history.
Restarting the GUI requires entering it again, unless its environment already
contains the configured variable. Clearing the password field leaves the existing
session/environment key in place. There is no automatic connectivity request.

**Kiểm tra kết nối** sends one small synthetic typed question. It sends no game
content, performs no automatic retry and reports authentication/typed-response
verification separately. Saving settings does not establish a working API key.

The fixed local file is `config/jev.json`, excluded from Git. A checked example is
`config/jev.example.json`. CLI setup from CMD:

```cmd
retk jev-settings save --request config/jev.example.json
set TYPESAFE_API_KEY=<your key>
retk jev-settings show --json
retk jev-settings test --json
```

`set` affects the current CMD session; launch `retk gui` from that session to
inherit it. `show` returns presence/validity booleans, never the key. Supported
variable names start with `TYPESAFE_` or `JEV_`. Invalid configuration blocks
execution rather than falling back to another credential.

`retk jev request` uses the configured model unless explicitly selected. A saved
request is immutable evidence: `retk jev run` refuses a configured model mismatch;
build a fresh request after changing the model. Only explicitly selected handoff
content enters a game request. A successful connection test does not verify a
real reconstruction comparison.

API contract: [Typesafe System One](https://docs.typesafe.ai/api/system-one),
[quickstart](https://docs.typesafe.ai/introduction/quickstart).
