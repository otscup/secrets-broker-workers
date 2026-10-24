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
- ✅ HTTP MCP endpoint (`/mcp`) with tools: `list_secrets`, `request_access`, `get_secret`, `request_fill`, `materialize`
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
npx -y @otscup/secrets-broker          # same as: node cli/index.mjs
```

While the package is still `private`, run it from a checkout (`node cli/index.mjs`)
or pack it locally: `npm pack` then `npx -y ./secrets-broker-workers-0.0.1.tgz`.

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

| Variable | Meaning |
|---|---|
| `BROKER_URL` | broker base URL, default `https://sb.otscup.com` |
| `BROKER_TOKEN` | static agent token; skips login and token storage |
| `BROKER_TOKEN_FILE` | file fallback for the token cache |
| `BROKER_TOKEN_STORE` | `file` or `keychain`, to force a backend |
| `BROKER_NO_BROWSER=1` | print URLs instead of opening a browser |

### Three ways to connect an agent

Pick by what the client can do, not by what is easiest to paste:

| The client… | Hand it | What happens |
|---|---|---|
| speaks MCP over HTTP **and** OAuth | just the URL: `{"url": "https://your-worker.example/mcp"}` | the client registers itself, you approve once in the browser, it stores its own token (24h) |
| speaks MCP over HTTP, **no** OAuth | `{"url": "…/mcp", "headers": {"Authorization": "Bearer <agent token>"}}` | token created in the panel under **Agents**; revocable there, expires when you say |
| only speaks stdio (Codex, older Hermes, most CLIs) | `{"command": "npx", "args": ["-y", "@otscup/secrets-broker"], "env": {"BROKER_URL": "https://your-worker.example"}}` | the bridge logs in through your browser once, keeps the token in the OS store, and opens approval links itself |

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

## Security notes

- `SESSION_KEK` wraps session keys inside Durable Object storage; rotate it by
  re-unlocking after changing the secret.
- The Worker never receives the master password; only derived symmetric keys.
- Admin cookie is HMAC-signed with a key derived from `SESSION_KEK`, HttpOnly,
  Secure, SameSite=Lax.
- Use a custom domain / Cloudflare Access in production; the `*.workers.dev`
  URL may be blocked in some networks.
