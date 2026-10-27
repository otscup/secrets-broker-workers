# Security model and hardening

Secrets Broker is a **trusted decrypting client**, not a zero-knowledge vault.
The Worker decrypts a credential only after a browser unlock session exists and
returns it only through the paths below.

## Trust boundaries

- NodeWarden D1 is the encrypted source of truth.
- The browser derives the vault key; the master password never reaches the Worker.
- The session key is wrapped with `SESSION_KEK` in the Durable Object.
- Admin cookies are HttpOnly, Secure, SameSite=Lax and server-side revocable.
- MCP OAuth tokens and static Agent tokens are hashed at rest.
- Every read/approval/configuration change should be audited.

## Controls now enforced

- OAuth 2.1 authorization-code + **PKCE S256 only**; DCR redirects are limited to
  HTTPS or loopback HTTP.
- OIDC requires a JWKS-verified ID Token: exact `iss`, `aud` containing the client
  ID, `exp`/`nbf` within 60s leeway, exact `nonce`, `azp` on multi-audience;
  userinfo `sub` must equal the verified `sub`, state/nonce is single-use, and
  the `oidc_state` cookie is cleared on every callback; any failure is a hard
  reject with no userinfo-only fallback. Binding + first-login allowlist unchanged.
- Legacy v1 admin cookies are rejected unless `ALLOW_LEGACY_ADMIN_COOKIE=1`.
- Admin login/TOTP failures are limited to 8 attempts per 15 minutes per IP.
- Grants are consumed atomically in the Durable Object (`/grant/consume`), so
  concurrent reads cannot all pass a `maxReads` check.
- New Agents and OAuth clients have no default access; access must be explicitly
  granted by item/group or `allowAll`.
- `http_request` only targets the item's configured URL host or
  `HTTP_ALLOWED_HOSTS`; private/local targets and redirects are blocked.
- HTML responses carry CSP, `X-Frame-Options: DENY`, `nosniff`, and
  `Referrer-Policy: no-referrer`; admin POSTs reject cross-origin `Origin`.
- `/approve` output is HTML-escaped; OAuth registration has a client cap, field
  length limits, and redirect validation.

## Local gateway (desktop loopback, port 4319)

- The desktop app exposes `/mcp` on `127.0.0.1:4319` only. Each local agent gets a
  random token and its own policy (`ask`, `allow` items, or a 15-minute window).
- The token file is DPAPI-encrypted (`local-agents.dpapi`); plaintext
  `local-agents.json` is migrated once and removed.
- The token still has to live in the agent MCP config (URL query), because the
  supported clients configure a URL rather than a custom auth header. **Any
  process running under the same Windows account can read that config and use
  that agent's token.** Loopback binding and per-agent tokens limit blast radius
  between agents; they are not a defense against same-user malware.
- Keep local policies on `ask` for sensitive items; do not use a long-lived
  `allow` policy for them.
- The sidecar must be running and the desktop app open for local access. Stop the
  app to close 4319.

## Known limits / next work

- Worker/Bitwarden crypto code needs an independent audit and test vectors.
- The broker can read plaintext after unlock; only `http_request` keeps values
  out of model context. A full action-proxy policy is future work.
- Cloudflare account/WAF/Access compromise is outside the broker boundary.
- OIDC ID-token verification is implemented in the worktree (`src/oidc.js` +
  `/oidc/callback`, 26/26 unit cases); still needs a live login against the
  real IdP plus JWKS rotation/Discovery-outage tests.
- Add automated tests for permission matrices, concurrency, expiry, rate limits,
  PKCE, cookie revocation, and XSS.
- Add Vault Provider abstraction for non-NodeWarden deployments.

## Recommended deployment

1. Put the admin UI behind Cloudflare Access or a private network.
2. Use a dedicated NodeWarden account/vault for broker credentials.
3. Keep `MCP_ALLOW_READ=1` only when `get_secret` is genuinely required; prefer
   `http_request` and explicit item URLs.
4. Do not mark sensitive items no-approval; review grants regularly.
5. Rotate admin password, TOTP, Agent tokens, OAuth clients, and `SESSION_KEK`
   after any suspected exposure.
