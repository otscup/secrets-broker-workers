# Secrets Broker — Cloudflare Workers

Cloudflare Workers-native implementation of Secrets Broker. It reads a
Bitwarden-compatible vault from **NodeWarden's D1 database**, decrypts items in
the Worker only while a browser/CLI unlock session is active, and exposes a
narrow agent API.

The Docker/Node broker remains the reference implementation; this project is a
separate, Workers-only port so NodeWarden upgrades don't affect it.

## Current status (working PoC)

- ✅ 1 Worker + 1 Durable Object; **0 new D1 databases**
- ✅ Read-only D1 access to NodeWarden (`ciphers`, `users`)
- ✅ Browser-side PBKDF2/HKDF/AES unlock (master password never sent to the Worker)
- ✅ Durable Object session storage (wrapped with `SESSION_KEK`)
- ✅ Permanent / 7d / 24h / 1h unlock TTL
- ✅ Item list + `/secret` read, using per-agent Bearer tokens
- ✅ Agents: create / rename / rotate / delete, per-agent allowlist and write flag
- ✅ Approval flow: once / 1h / 24h / 7d / permanent; pending requests in the UI
- ✅ Per-item no-approval policy (reads are still audited)
- ✅ Audit log and dashboard: KPIs, bar trend, agent share, top items, recent activity
- ✅ Headless `unlock.mjs`
- ⬜ MCP HTTP/OAuth, notifications, DSH plugin

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
| D1 | **0 new** | read-only binding to existing `nodewarden-db` |
| KV/R2 | optional | not required |

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
The item's **免审批** toggle in the **密钥** tab makes reads immediate while still
recording audit events.

## Security notes

- `SESSION_KEK` wraps session keys inside Durable Object storage; rotate it by
  re-unlocking after changing the secret.
- The Worker never receives the master password; only derived symmetric keys.
- Admin cookie is HMAC-signed with a key derived from `SESSION_KEK`, HttpOnly,
  Secure, SameSite=Lax.
- Use a custom domain / Cloudflare Access in production; the `*.workers.dev`
  URL may be blocked in some networks.
