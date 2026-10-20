# Handoff — Secrets Broker Workers

Last updated: 2026-10-20

## Repository / deployment

- Local repo: `E:\DeepSeek workers\secrets-broker-workers`
- GitHub: `https://github.com/otscup/secrets-broker-workers`
- Branch: `main`
- **Git commit to audit: `b78e0db`** (`Consume grant atomically before decrypting credential`)
- Cloudflare Worker: `secrets-broker-poc`
- Custom domain: `https://sb.otscup.com`
- Deployment version ID at handoff: `a94fc38a` (Cloudflare version ID, **not** a Git commit)

The earlier audit looked for `a94fc38a` as a Git commit; use `b78e0db` instead.

## Current state

- Worker: admin UI, OAuth 2.1 MCP, Agent tokens, grants, approvals, notifications, connector flow.
- DSH plugin: installed at `E:\dsh-home\profiles\desktop\node_modules\dsh-secrets-broker`; host routes work. Client popup needs a DSH Web restart to load latest code.
- Docker reference: `https://github.com/otscup/secrets-broker` (AGPL-3.0).
- Skill: `https://github.com/otscup/secrets-broker-skill`.
- Notifications configured on sb: ntfy / Gotify / wxpush / Telegram.
- `http_request` host allowlist: item URL host + `HTTP_ALLOWED_HOSTS`; private/local targets blocked; redirects disabled.
- Legacy v1 admin cookie rejected: current browser sessions must log in again.

## Security changes implemented (not yet independently verified/tested)

- OAuth PKCE S256 required; DCR redirects restricted to HTTPS/loopback; client cap 100.
- OIDC issuer + sub binding; first unbound login requires admin session or allowlist.
- Admin sessions v2 with server-side records/revocation.
- Login/TOTP rate limit: 8 failures / 15 minutes per IP.
- DO atomic `/grant/consume`; checks revoked/expiry/max/agent+item before decrypt.
- New Agents/OAuth clients default no access; existing agents migrated to allowAll.
- CSP, X-Frame-Options, nosniff, no-referrer; admin POST Origin check.
- `/approve` output escaped.

## Known remaining work

1. `http_request` method/path/header policy; host allowlist alone does not prevent DELETE/PATCH on the allowed host.
2. OIDC ID-token signature / `aud` validation — DONE in worktree (uncommitted):
   `src/oidc.js` (JWKS verify, iss/aud/exp/nonce/azp, userinfo sub match,
   replay registry) + `/oidc/callback` strict flow; 26/26 cases in
   `test-oidc.mjs` / `docs/oidc-test-results.md`. Needs live-IdP login test.
3. Automated security tests: permission matrix, expiration/concurrency, PKCE, cookie revocation, rate limits, XSS.
4. Vault Provider abstraction (currently NodeWarden D1 coupled).
5. DSH popup input stability after restart; verify visually.
6. English i18n and install wizard remain.

## Starting a new session

Open a new DSH window/session in `E:\DeepSeek workers` and say:

> 读取 `secrets-broker-workers/HANDOFF.md`，以 `b78e0db` 为基准继续做安全复核和 `http_request` 策略。

Do not expose `.env`, `SESSION_KEK`, admin password, TOTP seeds, Agent tokens, or OAuth tokens in chat.
