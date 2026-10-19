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
- ✅ Item list + `/secret` read, using an agent Bearer token
- ✅ Headless `unlock.mjs`
- ⬜ Per-agent tokens, approvals / no-approval policy, audit dashboard
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
curl -H "Authorization: Bearer $AGENT_TOKEN" \
  "https://your-worker.example/secret?name=tavily-api-key"
```

The current agent token is a single shared demo token; per-agent tokens and
approval policies are the next milestone.

## Security notes

- `SESSION_KEK` wraps session keys inside Durable Object storage; rotate it by
  re-unlocking after changing the secret.
- The Worker never receives the master password; only derived symmetric keys.
- Admin cookie is HMAC-signed with a key derived from `SESSION_KEK`, HttpOnly,
  Secure, SameSite=Lax.
- Use a custom domain / Cloudflare Access in production; the `*.workers.dev`
  URL may be blocked in some networks.
