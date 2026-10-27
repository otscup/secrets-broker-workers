# Secrets Broker — Cloudflare Workers

[English](README.md) | [简体中文](README.zh-CN.md)

**Try it without setting anything up:** <https://demo.otscup.com> — the real UI
against a virtual vault. No NodeWarden, no real credentials, and its own OIDC
provider, so the whole flow is clickable in a minute.

Cloudflare Workers-native implementation of Secrets Broker. It reads a
Bitwarden-compatible vault from **NodeWarden's D1 database**, decrypts items in
the Worker only while a browser/CLI unlock session is active, and exposes a
narrow agent API.

## Built on NodeWarden

This project does not ship its own vault. It runs on top of
[**NodeWarden**](https://github.com/shuaiplus/NodeWarden), a self-hosted
Bitwarden-compatible server for Cloudflare Workers. NodeWarden stores and syncs
the encrypted vault; Secrets Broker reads that same D1 database and adds the
agent-facing layer: per-agent tokens, approvals, short-lived grants, plaintext
read policies, classification and an audit log.

What that means in practice:

- install NodeWarden first, then point this Worker at its D1 database and Worker
  binding (see Setup below);
- create your credentials in NodeWarden's vault UI (or with a Bitwarden client);
  they appear here automatically;
- NodeWarden stays the source of truth, so a vault backed up or migrated there
  carries every credential with it.

- NodeWarden: <https://github.com/shuaiplus/NodeWarden>
- Bitwarden clients work against NodeWarden, so the same vault is usable from the
  desktop app, browser extension and mobile.

The Docker/Node broker remains the reference implementation; this project is a
separate, Workers-only port so NodeWarden upgrades don't affect it.

See [docs/parity.md](docs/parity.md) for the feature-by-feature comparison with
the Docker version.

DSH plugin (handles pending approvals inside the settings page):
[`dsh-plugin/`](dsh-plugin/).

## Current status (working PoC)

- ✅ 1 Worker + 1 Durable Object; **0 new D1 databases**
- ✅ Read access to NodeWarden (`ciphers`, `users`)
- ✅ Browser-side PBKDF2/HKDF/AES unlock (master password never sent to the Worker)
- ✅ Durable Object session storage (wrapped with `SESSION_KEK`)
- ✅ Permanent / 7d / 24h / 1h unlock TTL
- ✅ Item list + `/secret` read, using per-agent Bearer tokens
- ✅ Item actions: edit name/url/notes/value, group, share, delete (writes to NodeWarden D1)
- ✅ Create item, JSON import/export, Bitwarden folder filter
- ✅ Agent write API (`/agent/items/save`, requires per-agent write flag)
- ✅ Telegram inline approvals via webhook; ntfy/Gotify/wxpush signed one-click approval links
- ✅ Account switch between NodeWarden users; OIDC unbind; notification test button
- ✅ Agents: create / rename / rotate / delete / copy token; per-agent allowlist, group scope and write flag
- ✅ Approval flow: once / 1h / 24h / 7d / permanent; pending requests in the UI
- ✅ Grant actions: extend duration, set max reads, revoke, delete; direct share to an agent
- ✅ Per-item no-approval policy (reads are still audited)
- ✅ Per-item classification (api / web) with exact-origin fill policies
- ✅ Audit log and dashboard: KPIs, bar trend, agent share, top items, recent activity
- ✅ Profile page + OIDC (xid) login/binding with PKCE
- ✅ Account menu from avatar, dark mode, password change, TOTP 2FA
- ✅ HTTP MCP endpoint (`/mcp`) with tools: `list_secrets`, `explain_access`, `request_access`, `get_secret`, `request_fill`, `materialize`
- ✅ Notification settings: Telegram / ntfy / Gotify / wxpush (sent on pending request)
- ✅ Headless `unlock.mjs`
- ⬜ DSH plugin / OAuth MCP discovery

## MCP

The Worker exposes a JSON-RPC MCP endpoint:

```
POST https://your-worker.example/mcp
Authorization: Bearer <agent token>
```

The Worker also exposes an MCP OAuth 2.1 authorization server:

- `/.well-known/oauth-authorization-server`
- `/oauth/register` (dynamic client registration)
- `/oauth/authorize` (PKCE S256 + consent)
- `/oauth/token` (authorization_code)

MCP clients that support OAuth can discover and use it; the old static Bearer
token still works.

### Clients that only speak stdio

Agents like Codex, or anything without HTTP transport, can run the bundled
bridge instead:

```bash
node cli/index.mjs          # from a checkout, which is the supported way today
```

The package is still `private`, so there is no published name to `npx` yet: both
`secrets-broker-workers` and `@otscup/secrets-broker` answer 404 on npm. To get a
tarball you can install elsewhere, run `npm pack` and use
`npx -y ./secrets-broker-workers-0.0.1.tgz`.

It logs in once through your browser (OAuth 2.1 with PKCE and a loopback
redirect), keeps the token in the operating system's own store — Keychain on
macOS, libsecret on Linux, DPAPI on Windows, and only a `0600` file when none of
those exist — and opens a pending approval link in your browser instead of
leaving it in the agent's context.

| Command | What it does |
|---|---|
| `secrets-broker` | speak MCP over stdio, for a client config |
| `secrets-broker login` | log in now |
| `secrets-broker status` | which broker, which store, is the token still valid |
| `secrets-broker logout` | forget the stored token |
| `secrets-broker sync --remote URL` | preview what differs from another broker (read-only) |
| `secrets-broker agents detect` | list the MCP clients installed for this user, and whether each already points at a broker |
| `secrets-broker agents connect --apply` | add this broker to those client configs (dry run without `--apply`) |

| Variable | Meaning |
|---|---|
| `BROKER_URL` | broker base URL, default `https://sb.otscup.com` |
| `BROKER_TOKEN` | static agent token; skips login and token storage |
| `BROKER_TOKEN_FILE` | file fallback for the token cache |
| `BROKER_TOKEN_STORE` | `file` or `keychain`, to force a backend |
| `BROKER_NO_BROWSER=1` | print URLs instead of opening a browser |
| `BROKER_REMOTE_URL` / `BROKER_REMOTE_TOKEN` | the other broker for `sync`, and its token |

### Point an agent at this broker automatically

The client configs are the annoying part: every agent wants its own file, in its
own format, in a different directory. Two commands handle that.

```bash
secrets-broker agents detect            # what is installed, and what already points here
secrets-broker agents connect           # show the exact snippet each file would get
secrets-broker agents connect --apply   # write it
```

What it looks at: `~/.codex/config.toml`, `~/.claude.json`,
`claude_desktop_config.json` (Claude Desktop), `Code/User/mcp.json` (VS Code),
`Cursor/User/mcp.json`, `Windsurf/User/mcp.json`, `~/.gemini/settings.json`.

What it will not do:

- **No credentials.** The entry holds no token: it runs `node` on this
  checkout's `cli/index.mjs` and passes `BROKER_URL`; the bridge logs itself in
  through the browser and keeps the token in the OS keychain. Nothing secret is
  written into an agent config.
- **No rewriting.** JSON is spliced as text so comments and key order survive;
  TOML gets one `[mcp_servers.secrets-broker]` block wrapped in
  `# >>> secrets-broker` / `# <<< secrets-broker` comments so a human can find
  and remove it later.
- **No guessing.** A file that does not parse is reported, not appended to. An
  agent that already points at any broker is left alone, even if the entry has
  another name.
- **No silent writes.** Without `--apply` nothing is written; with it, the
  original is copied to `<file>.secrets-broker.bak` first.

Restart the client afterwards — these files are read once at startup.

### Comparing two brokers

Sync moves the vault between two deployments (for example this worker and a
broker you run locally). It moves **ciphertext**: `ciphers.name` and
`ciphers.data` are the same Bitwarden blobs that sit in D1, so neither broker
needs the master key to hand them over, and a stolen sync token leaks ids and
timestamps, not credentials.

The credential is a **sync device**, not an agent: create one in the panel under
**Settings → Security → Sync devices**, copy the token it shows you once, and hand
it to the other broker. An agent token is refused with `403 this token is not a
sync device` — an agent's scope is curated item by item, and letting it enumerate
the vault would undo exactly that promise. A device is revoked on its own, and
revoking it breaks the other side's next pull immediately.

Stage 1 only previews. Nothing is written to either side.

**From the panel** (no terminal needed): Settings → Security → Remote sync, paste
the other broker's URL and one of its sync-device tokens, hit 比对. The token is
stored wrapped with `SESSION_KEK` on this side, never echoed back, and used only
to call that broker's `/sync/pull`. The card then shows push/pull/delete/conflict
counts and the first rows.

**From the CLI**, when there is no browser in reach:

```bash
export BROKER_REMOTE_TOKEN=<device token from the other broker>
secrets-broker sync --remote https://sb.otscup.com      # needs SYNC_ENABLED=1 there
```

It prints how many items only exist locally, how many only exist remotely, what
is newer on each side, and which rows are tombstones. `--json` prints the counts
alone, `--verbose` lists every row instead of the first twenty. `--apply` is
refused on purpose until the merge rules are agreed.

The endpoint it uses (`GET /sync/pull`) is off unless the deployment sets
`SYNC_ENABLED=1`, and it accepts only a sync-device token or an admin session.
Both see ciphertext and nothing else; an agent token is refused.

### Three ways to connect an agent

Pick by what the client can do, not by what is easiest to paste:

| The client… | Hand it | What happens |
|---|---|---|
| speaks MCP over HTTP **and** OAuth | just the URL: `{"url": "https://your-worker.example/mcp"}` | the client registers itself, you approve once in the browser, it stores its own token (24h) |
| speaks MCP over HTTP, **no** OAuth | `{"url": "…/mcp", "headers": {"Authorization": "Bearer <agent token>"}}` | token created in the panel under **Agents**; revocable there, expires when you say |
| only speaks stdio (Codex, older Hermes, most CLIs) | `{"command": "node", "args": ["<checkout>/cli/index.mjs"], "env": {"BROKER_URL": "https://your-worker.example"}}` — or let `secrets-broker agents connect --apply` write it for you | the bridge logs in through your browser once, keeps the token in the OS store, and opens approval links itself |

The three end at the same place: one agent identity, one set of scopes, the same
audit trail. What differs is only who stores the token.

Rules that apply to all three:

- an agent only sees the items you put in scope for it; everything else is a 403
  and an audit line, not a hint that the item exists;
- `get_secret` needs a read grant; an approval for it is one read, not a
  standing right, unless the item is marked no-approval;
- website logins are fill-only. Neither `get_secret` nor `materialize` will hand
  one over, because writing it to disk is a plaintext read;
- revoking the agent (or the grant) takes effect on the next call; there is no
  cached permission.

## Agent skill

A portable skill is included at [`skills/secrets-broker`](skills/secrets-broker).
It teaches agents to use the MCP tools automatically, never ask for the secret,
handle approval URLs, and avoid printing credentials. It also includes Codex and
Hermes configuration examples.

Tools:

- `list_secrets` — item names/URLs, no values;
- `explain_access` — says, without reading anything, why this agent can or
  cannot use a credential and what to do about it (`allow` / `needs-approval` /
  `deny`, the kind, the grant, the rule that decided). It is the answer to a
  bare `not allowed` for both an agent and the operator on the other end;
- `request_access` — creates an approval request and returns the approval URL;
- `get_secret` — returns the value once approved (set `MCP_ALLOW_READ=1`);
- `request_fill` — asks a registered browser executor to fill a stored website
  login into an allowed origin; the agent gets a task id, never the value;
- `materialize` — asks to write one credential into a file the operator has
  allowlisted (`设置 → 安全 → 本地写入白名单`); an approval records a one-shot job,
  not a standing read grant;
- `materialize_redeem` — redeems that job once; the local bridge writes the
  `KEY=value` line (0600) and the broker only records `secret.materialize`. It
  hands the value over MCP, so it also needs `MCP_ALLOW_READ=1`; with reads off,
  this path cannot hand plaintext out.

`materialize` refuses a path that is not on the allowlist, and re-checks the
list at redemption, so removing a path also revokes approvals made while it was
listed. Both checks compare the path after collapsing `.` and `..`, because the
bridge writes with `path.resolve()` — a raw prefix test would let
`/srv/app/../../etc/passwd` keep an allowlisted `/srv/app/` prefix. A website
login stays fill-only and cannot be materialised.

Example Codex/HTTP MCP config:

```toml
[mcp_servers.secrets]
url = "https://your-worker.example/mcp"
headers = { Authorization = "Bearer <agent token>" }
```

For agents that need a human approval first, call `request_access`, approve in the
browser, then call `get_secret`. Set an item to **no-approval** to skip the approval step.

## Why browser KDF

Bitwarden's default KDF is PBKDF2 600,000 iterations. A free-plan Worker cannot
run that (verified: `/api/kdf` fails at 200k+ iterations with error 1101).
The browser/CLI performs the KDF once; the Worker only does the cheap item
decryption (AES-CBC/HMAC, ~1ms). Free plan CPU is then sufficient per read.

## Resources

| Resource | Count | Notes |
|---|---|---|
| Worker | 1 | this project |
| Durable Object | 1 namespace | SQLite storage, separate from D1 quota |
| D1 | **0 new** | binding to the existing `nodewarden-db` (read, plus item create/edit/delete) |
| KV/R2 | optional | not required |

### Which NodeWarden version

Tested against **NodeWarden v1.8.1**. The integration is limited to three tables
— `ciphers`, `users`, `folders` — and this project only ever adds or updates
rows; it never alters the schema and never runs a migration. That is what makes
a NodeWarden upgrade safe: v1.7.x through v1.8.1 all keep those columns, and the
release notes for that range contain no schema change.

Two things to know when upgrading NodeWarden:

- **Upgrade NodeWarden in its own repo, not from here.** Run its migrations and
  deploy it first, then deploy this Worker if its source changed.
- NodeWarden v1.8.1 added revision tracking for vault edits made *through its own
  API*. This project writes D1 directly, so those revisions are not bumped by a
  change made here. Nothing breaks: the next client sync reads the new row. The
  only visible effect is that a concurrently open Bitwarden client may not be
  told to refresh the instant this Worker edits an item.

## Credentials

There are three different secrets; do not mix them:

| Secret | Where | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | browser login form | manage the broker UI; not an agent token |
| `AGENT_TOKEN` | `Authorization: Bearer ...` | machine/agent `/secret` calls; never used in the browser |
| Bitwarden master password | browser unlock form | derives keys locally; never sent to the Worker |

The local PoC stores them as `workers-admin-login-password.txt`,
`workers-agent-bearer-token.txt`, and the Bitwarden master password in
`nas-master-password.txt` (outside this repo).

## Setup

1. Install dependencies and log in to Wrangler:

```bash
npm install
npx wrangler login
```

2. Copy `wrangler.example.jsonc` to `wrangler.jsonc` and fill in:

- account-specific `database_id` for your NodeWarden D1
- the NodeWarden Worker name for `services[0].service`
- `VAULT_EMAIL` (the Bitwarden account email)

3. Set secrets:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put AGENT_TOKEN
openssl rand -base64 32 | npx wrangler secret put SESSION_KEK
```

4. Deploy:

```bash
npx wrangler deploy
```

5. Open the Worker URL, log in with `ADMIN_PASSWORD`, then unlock with the
   Bitwarden master password. The browser derives the keys locally.

### Environment

Everything below is optional except `VAULT_EMAIL`; a missing variable means the
feature it guards is off, never that it silently allows something.

| Variable | What it does |
| --- | --- |
| `ADMIN_PASSWORD` | Console password when no custom password has been saved in the Durable Object. |
| `AGENT_TOKEN` | Seeds the first agent (`dsh`) on a fresh deployment. Tokens are stored hashed afterwards. |
| `SESSION_KEK` | base64 of 32 bytes. Wraps the vault session and signs the admin cookie. **Changing it logs everybody out and makes stored TOTP secrets unreadable.** |
| `VAULT_EMAIL` | The NodeWarden account this broker reads. |
| `PUBLIC_ORIGIN` | Absolute origin used when building approval links (default `https://sb.otscup.com`). |
| `MCP_ALLOW_READ` | `1` exposes `get_secret` and `materialize_redeem` over MCP. Off, an agent can still ask for a fill but never receives a value. |
| `OAUTH_ALLOW_REGISTER` | `0` / `false` / `off` refuses `POST /oauth/register`, so only pre-existing clients can connect. |
| `HTTP_ALLOWED_HOSTS` | Comma-separated extra hosts `http_request` may reach. Without it, the built-in private/loopback blocklist is the only filter. |
| `POLICY_SHADOW` | `1` turns policy decisions into audit-only (shadow) records. |
| `FILL_EXECUTION_TOKEN` | Shared secret the legacy execute endpoint accepts. |
| `FILL_LEGACY_EXECUTE_ENABLED` | `1` re-enables that legacy execute path (off by default). |
| `FILL_TASK_SIGNING_KEY` | base64 key for task credentials. Generated per Durable Object when absent, so set it to survive a state reset. |
| `FILL_AUTH_TTL_MS` | Lifetime of a fill authorization (default 10 min, capped at 15). |
| `DSH_PLUGIN_TOKEN` | Bearer token for the plugin endpoints (`/api/plugin/*`). |
| `AI_API_KEY` | Default key for the assistant's OpenAI-compatible endpoint; a key saved in 设置 → AI wins. |
| `OIDC_ISSUER` | Issuer URL; discovery fills the four endpoints below when they are unset. |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Client credentials for the xid login. No secret means public client + PKCE. |
| `OIDC_REDIRECT_URI` | Must be registered with the provider, e.g. `https://<host>/oidc/callback`. |
| `OIDC_SCOPE` | Requested scopes (default `openid email profile`). |
| `OIDC_AUTHORIZATION_ENDPOINT` / `OIDC_TOKEN_ENDPOINT` / `OIDC_USERINFO_ENDPOINT` / `OIDC_JWKS_URI` | Override discovery. |
| `OIDC_ALLOWED_SUB` / `OIDC_ALLOWED_EMAIL` | Optional allowlist; when set, only these identities may log in. |
| `GEO_ENABLED` | `1` records the operator's location per request and renders the globe. |

### Deploy it against D1 alone

The broker only ever reads `NODEWARDEN_DB`. The `NODEWARDEN` service binding that
older examples carried is not called anywhere, so a deployment that owns its own
D1 needs nothing else:

```sh
npx wrangler secret put SESSION_KEK      # base64, 32 bytes
npx wrangler secret put ADMIN_PASSWORD
# then edit wrangler.jsonc: drop the "services" block, point d1_databases at your
# own database id, and create the three tables the panel reads (users, ciphers,
# folders) — see "Run the panel locally" for the schema that `scripts/` seeds.
npx wrangler deploy
```

What you lose without NodeWarden: cross-account transfers stay inside this D1
(they copy ciphers between two `user_id`s in the same database), and there is no
second vault to reconcile against. Everything else — agents, approvals, grants,
capabilities, fill tasks, materialize, audit — is local to the broker's own state.

### Run the panel locally

Two scripts cover it. Both keep their state on this machine only.

```bash
node scripts/dev.mjs                 # http://127.0.0.1:8787, panel password printed on start
node scripts/seed.mjs --password local-master --demo   # once: the users row, a profile key, three items
```

`scripts/dev.mjs` generates `SESSION_KEK` and `ADMIN_PASSWORD` once into
`.dev-keys.json` (gitignored) and reuses them, so restarting does not log you out
or orphan the tokens the broker has wrapped with that key. The vault itself lives
in `.wrangler-dev/` (also gitignored): a local SQLite file under `v3/d1/`.
`--port` and `--persist` pick another instance, and each pair of values is its
own vault — that is how two brokers were compared before sync existed.

`scripts/seed.mjs` is needed because a fresh D1 has no tables: it creates the
three NodeWarden tables, writes the user row, derives the profile key from the
master password you pass (PBKDF2 600k, HKDF, encrypted the same way a Bitwarden
client does), and with `--demo` unlocks the vault and creates three credentials.
Stop `dev.mjs` before running it if SQLite is locked; the script says so.

If the port answers but hangs, an older `wrangler dev` is still holding it:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*wrangler*dev*' -or $_.Name -eq 'workerd.exe' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

### Run the panel locally (by hand)

`npx wrangler dev` serves the same Worker on `http://127.0.0.1:8787`, which is
enough to work on the panel without touching the deployed vault:

```bash
npx wrangler dev --port 8787 \
  --var SESSION_KEK:"$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" \
  --var ADMIN_PASSWORD:local-dev
```

- `SESSION_KEK` has to be base64 for 32 bytes, or the first cookie write throws
  `SESSION_KEK must be a base64-encoded 32-byte key`. Any key works locally; use
  the deployed one only if you want old cookies to keep working.
- `ADMIN_PASSWORD` is the password you type on the login page.
- The local D1 starts empty and the `NODEWARDEN` service binding shows as
  `[not connected]`, so the panel renders and you can log in, but the item list
  is empty and no real credential can be read. Point `BROKER_URL` at the
  deployed Worker for that.

### Headless unlock

```bash
BROKER_URL=https://your-worker.example \
ADMIN_PASSWORD=... \
MASTER_PASSWORD=... \
TTL=permanent \
node unlock.mjs
```

### Agent API

```bash
# first read: returns 202 with a pending request (unless no-approval)
curl -H "Authorization: Bearer $AGENT_TOKEN" \
  "https://your-worker.example/secret?name=tavily-api-key"

# after approving in the UI (or setting the item to no-approval)
curl -H "Authorization: Bearer $AGENT_TOKEN" \
  "https://your-worker.example/secret?name=tavily-api-key"
```

Agents are created in the **Agents** tab; the token is shown only once.
The item's **no-approval** toggle in the **Items** tab makes reads immediate while still
recording audit events.

### Publishing the CLI

`npm pack` is what a user installs, so the tarball is what the check looks at:

```bash
node scripts/check-pack.mjs     # the CLI, everything it imports, nothing secret
npm publish
```

`prepublishOnly` runs that check plus the CLI, exec, daemon and v2-CLI suites, so
a broken file list or a failing line stops the publish instead of shipping it.
The `files` list must keep `cli/`, `src/envelope.js`, `src/vaultdiff.js` and
`mcp-stdio/`: an import outside those paths resolves to nothing once installed.

### Build the desktop release

`npm run release:desktop` builds the UI, stages the sidecar, builds the MSI and
then checks that the Tauri and Cargo versions match the MSI filename. The same
steps run on `windows-latest` in `.github/workflows/desktop.yml`; it is
`workflow_dispatch`/`desktop-v*` only, and uploads the MSI and executable as an
artifact. Builds are unsigned until a code-signing certificate is configured.

### Keep the vault open on this machine

Every agent that starts `secrets-broker serve` decrypts the vault again. Running
one daemon instead keeps it in memory and answers MCP over HTTP:

```bash
secrets-broker up --port 4319 --every 15
# vault daemon on http://127.0.0.1:4319
#   493 item(s), refreshing every 15 min
```

The MCP endpoint is per-agent: `agents connect --local` creates that agent's
token and writes the tokenized URL into its config.

```bash
secrets-broker agents connect --local --apply
# POST /mcp?agent=codex&token=...
```

| Route | What it gives |
|---|---|
| `POST /mcp?agent=…&token=…` | The same tools as the stdio server, without a per-agent start cost |
| `GET /healthz` | Item count, when it was last pulled, and whether the last refresh failed |
| `GET /local/pending` | Reads waiting for a human decision |
| `GET /approve/:id` | The local approval page |

A read waits for that agent's policy: `allow` for named items, a 15-minute
`window`, or `ask` (the default), which opens the approval page. Tokens and
policies live in `~/.secrets-broker/local-agents.dpapi` on Windows (DPAPI,
current user); other platforms keep `local-agents.json` at mode 0600.

Two guards, because a loopback port is still reachable by your browser:

- any request carrying an `Origin` header is refused, as is `OPTIONS` — a web
  page cannot use your browser to read the daemon; the approval page is exempt
  so its own fetch works;
- a `Host` header that is not `127.0.0.1`, `localhost` or `::1` is refused, which
  blocks a DNS-rebinding page.

If a refresh fails the daemon keeps answering with what it already holds and
`/healthz` reports `stale: true` with the error.

### Run a command with the key in its environment

A `.env` file is a plaintext copy of your vault that any process on the machine
can read. `exec` puts the value in one child process's environment instead:

```bash
secrets-broker exec --env OPENAI_API_KEY=openai-prod -- npm run dev
secrets-broker exec --env GH_USER=GitHub@username --env GH_TOKEN=GitHub@password -- gh auth login
```

- `KEY=item` gives the item's secret; `KEY=item@field` gives one field
  (`username`, `password`, `url` or `totp`) of a web login.
- A misspelled item name stops the command and offers the closest name; it never
  runs the child with a wrong or empty value.
- The value exists only while that child runs. Nothing is written to disk, and
  the broker's own log never sees it. The child inherits your normal environment.

### Work from the local copy when offline

`pull` saves a ciphertext copy the daemon and the commit guard can use without a
network:

```bash
secrets-broker pull                 # once while online
secrets-broker pull --offline       # answer from that copy, no network
secrets-broker pull --offline --to ./vault.json
```

`--offline` fails if no copy exists; a revoked device still gets `401/403`
instead of reading the old copy. `--to` writes decrypted values to disk (mode
0600) — treat that file as a secret and delete it when done.

### Back up the local state

`backup` copies the encrypted local state directory (device key, ciphertext
cache, agent token store) so a disk failure does not force a new pairing:

```bash
secrets-broker backup --out D:\backups\secrets-broker
secrets-broker restore --from D:\backups\secrets-broker --force
```

The device key and agent tokens are DPAPI/Keychain protected, so a backup is
restorable only by the same OS user on the same machine profile. It is not a
portable vault export; use the console export when you need one.

For a daily backup, run `node cli/backup-scheduler.mjs` from Task Scheduler.
`BROKER_BACKUP_DIR` changes the destination and `BROKER_BACKUP_KEEP` (default
14) controls how many snapshots are retained. The Windows task
`SecretsBrokerLocalBackup` runs it at 03:30 and reports failure through its
last result code.

### Stop a commit that carries a vault value

An agent that reads a key and then writes a test file is one `git add` away from
publishing it. The guard compares what you are about to commit against the values
this vault holds, so it can only fire on a real secret:

```bash
secrets-broker guard --install      # writes .git/hooks/pre-commit in this repo
secrets-broker guard                # what the hook runs; exits 1 on a hit
```

It matches the vault's own `value`/`password` strings (8 characters or longer),
never a "looks like a key" pattern, so a normal commit passes. With no local copy
of the vault it says so and lets the commit through rather than pretending it
checked; run `pull` once online to give it something to compare against. Bypass a
false alarm with `git commit --no-verify`, and replace a hook you already have
with `--force`.

## Classifying a credential

Every credential is labelled **api**, **web** or unclassified, shown next to its
name. The label decides what an Agent may do with it:

- **api** — an API key. An Agent may read it, but only after you explicitly allow
  plaintext reads for that item (30-day expiry).
- **web** — a website login. It is only ever filled into the origins you list;
  an Agent never receives the plaintext.
- **unclassified** — refused by default, so nothing is readable until you choose.

The same three colours are used in the picker and beside the name. You can set
the label in the item's ⋮ menu, in bulk from the selection bar, or when storing
a key from the DSH plugin.

Origins are matched exactly: a subdomain, another port or `example.com.evil.test`
will not match `example.com`. `https` is required, except for a host that cannot
leave the local network (`localhost`, `127.x`, `10.x`, `192.168.x`,
`172.16-31.x`, `*.lan`, `*.local`), which may use `http` because a homelab
console usually has no certificate. A bare `host:port` is read as `https`.

## OIDC (xid) login

Set these vars/secrets (or change `wrangler.jsonc`):

```jsonc
"OIDC_ISSUER": "https://auth.example.com",
"OIDC_CLIENT_ID": "your-client-id",
"OIDC_REDIRECT_URI": "https://your-worker.example/oidc/callback"
```

The Worker uses authorization code + PKCE. Register the callback URL at the
identity provider (xid supports dynamic client registration; a public client with
`token_endpoint_auth_method=none` works). After login, the profile stores the
OIDC subject/email/name; admin login can use either the password or OIDC.

After one password unlock, the Worker also stores a `SESSION_KEK`-wrapped copy
of that vault account's keys for each OIDC binding on the same account. The next
OIDC login restores them automatically. `锁定` clears the copies, and a binding
made for a different vault account never receives them.

## Security notes

- `SESSION_KEK` wraps session keys inside Durable Object storage; rotate it by
  re-unlocking after changing the secret.
- The Worker never receives the master password; only derived symmetric keys.
- Admin cookie is HMAC-signed with a key derived from `SESSION_KEK`, HttpOnly,
  Secure, SameSite=Lax.
- Use a custom domain / Cloudflare Access in production; the `*.workers.dev`
  URL may be blocked in some networks.
