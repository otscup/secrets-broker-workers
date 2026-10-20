# Security review — baseline 7cb19ca (+ http_request policy work)

Date: 2026-10-20. Baseline: `7cb19ca` (= `b78e0db` + HANDOFF.md only; `git diff b78e0db..7cb19ca --stat` = HANDOFF.md only).
Working tree at review time: uncommitted `src/index.js` http_request policy hardening (method/header/body/URL policy, see below).

> Note: the repo advertises `get_secret` in MCP instructions/tools-list copy (src/index.js L1907/L1913), but no
> `get_secret` handler exists in `tools/call`. The real value-reading tool is `get_credential` (L1941).
> Treat any "get_secret gate" claim as copy drift; audit the actual handlers.

## What was verified in code (with line refs)

- Grant consume is atomic in the DO: `src/index.js` L34-46 checks revoked/expiry/maxReads, increments reads,
  deletes on exhaustion, single `storage.put`. MCP side (L810-813) re-resolves after consume; expired/exhausted
  grants are rejected post-consume. TOCTOU between `activeGrant` check (L798) and consume is closed by the
  post-consume `consumed?.ok` check.
- Agent scope gate (L789-796): allow/groups non-empty → must match; empty scope requires `allowAll===true`.
  New agents/clients default deny (L1892: allowAll:false). Legacy migration (L173-179) sets allowAll=true for
  empty-scope agents/profiles — intended, but expands old agents; review after deploy.
- noApproval bypass (L797-799): `policy.noApproval` skips grant entirely; audit logs mode=no-approval (L816).
  Any item marked noApproval is readable by any in-scope agent without approval — keep sensitive items out.
- OAuth PKCE S256 enforced both legs (L1845 authorize, L1876-1881 token), code 5-min expiry, single-use delete
  (L1889), redirect must exactly match registered (L1844), DCR redirects https/loopback only (L1827-1828),
  client cap 100 (L1822). Token 24h (L1885), no refresh rotation.
- Admin cookies: v2 HMAC + server-side record (L95-134); v1 rejected unless ALLOW_LEGACY_ADMIN_COOKIE=1 (L128).
  POST Origin check (L391-396) only when Origin header present; login rate limit 8/15min per IP (L290-293,
  enforced L989) — key is cf-connecting-ip/x-forwarded-for, spoofable behind non-CF deploys.
- OIDC (L1145-1197): state cookie verified (L1149-1151), token+userinfo fetched, sub required (L1165),
  issuer+sub binding (L1170-1173), first-login allowlist gate (L1174-1180). No id_token signature/aud check —
  relies on TLS userinfo + sub; a compromised/mis-issued userinfo endpoint is trusted (see R1).
- get_credential (L1941-1951): requires MCP_ALLOW_READ=1, agentAccess (approval/grant), full vault unlock.
  Returns username+password+totp in one call.
- http_request (L1961-2030, as hardened in working tree): agentAccess first, then method/header/body/URL policy,
  host allowlist (item URL host + HTTP_ALLOWED_HOSTS), redirect manual, 15s timeout, audit without secret.

## http_request policy implemented (working tree, uncommitted, node --check exit 0)

- Method allowlist: default GET/POST, extend via HTTP_ALLOW_METHODS; max 16 chars (L1967-1970).
- headerName allowlist (case-insensitive): Authorization, X-Api-Key, Api-Key, X-Auth-Token (L1971-1974).
- authPrefix max 32 chars, no CR/LF (L1975-1976).
- Custom headers: null-prototype object, max 20, name /^[A-Za-z0-9-]+$/, value \u22644KB strict 400;
  host/content-length/connection/cookie/set-cookie/authorization/proxy-*/te/trailer/transfer-encoding/upgrade/
  keep-alive/expect filtered (L1977-1989).
- Body: stringified, \u226464KB, GET/HEAD must not carry body (L1990-1995).
- URL: https only, no userinfo, port 443 or HTTP_ALLOWED_PORTS (L1996-2004).
- HTTP_ALLOW_PATHS prefix allowlist with boundary (/api \u2260 /apix) (L2005-2007).
- Host: trailing-dot normalized, numeric-IP forms + mapped/link-local v6 rejected, private ranges + localhost/
  .local blocked, then allowlist check (L2008-2021).
- Fetch: redirect manual, AbortSignal.timeout(15000), timeout \u2192 'upstream request timed out (15s)' (L2023-2026).
- Response capped 8KB (L2027); audit logs method/host/path/status, never the secret (L2028).
- tools/list description+schema updated to document the policy (L1916).

## Findings (baseline 7cb19ca + policy delta)

### R1 (High): OIDC trusts userinfo without id_token iss/aud/signature verification — FIXED in worktree
- Where: L1155-1166. Only \u201cissuer config + userinfo sub\u201d is checked; no id_token驗签/exp/aud.
- Condition: IdP userinfo endpoint compromised or malicious OIDC discovery; attacker with a valid userinfo sub
  can bind/login. First-login allowlist (L1174-1180) mitigates open registration, not a rogue userinfo.
- Action: verify id_token (JWKS, iss, aud=clientId, exp) and require sub match between id_token and userinfo.

### R2 (High): http_request is a credentialed SSRF/action proxy bounded only by operator config — HARDENED, residual
- Fixed in working tree: method/header/body/path/port/userinfo/timeout Auburn described above closes the
  HANDOFF item 1 gaps (arbitrary DELETE/PATCH, header smuggling, oversized bodies, userinfo/port abuse,
  /apix prefix bypass, silent header drops, hanging upstream).
- Residual: (a) HTTP_ALLOW_PATHS empty = no path restriction — operator must set it for state-changing APIs;
  (b) DNS-rebinding/redirect-manual only blocks redirect responses, response body 8KB can still carry data;
  (c) allowlist is host-string, not per-item path/method binding. Recommend per-item http policy object
  (allowedMethods/allowedPaths/allowedHeaders) next.

### R3 (Medium): noApproval items readable without grant — BY DESIGN, needs hygiene
- Where: L797-799 + L816. Any allowAll/legacy-migrated agent in scope reads noApproval items silently (audit only).
- Action: keep sensitive items approval-required; periodic audit of policies; consider separate scope for noApproval.

### R4 (Medium): legacy allowAll migration widens old agents — KNOWN
- Where: L173-179. Agents/profiles with empty allow+groups get allowAll=true on load.
- Action: one-time review of agents list after deploy; explicitly scope service agents.

### R5 (Medium): login rate-limit key spoofable; no global throttle on MCP/OAuth — OPEN
- Where: L988-989, L290-293. IP from cf-connecting-ip/x-forwarded-for; only /api/login is throttled.
- Action: prefer CF-only trust or socket IP; add throttle to /oauth/token + /mcp auth failures.

### R6 (Low): Origin check skips headerless POSTs; cookie is Lax — ACCEPTABLE with note
- Where: L391-396. Same-origin fetch from admin UI sends no Origin; CSRF relies on SameSite=Lax + cookie.
- Note: keep Lax; consider CSRF token for state-changing admin POSTs if cookies ever become SameSite=None.

### R7 (Low): OAuth tokens 24h no refresh/rotation cap; client secret unused (public clients) — KNOWN
- Where: L1882-1896. Fine for local MCP use; rotate via /api/oauth/revoke; cap active tokens per client.

### R8 (Info): get_secret copy drift — CLARIFY
- tools/list + initialize advertise get_secret (L1907/L1913) but handler absent; request_access (L1932) even
  replies \u201cuse get_secret\u201d. Either implement get_secret as scoped alias or fix copy to get_credential.

## Test status

- Static: `node --check src/index.js` exit 0 (after policy change).
- Policy self-tests (teammate-reported, rerun after 3 follow-up fixes): path boundary 7/7, header strict +
  null-prototype 4/4, timeout mapping 3/3.
- Still missing (HANDOFF items 2-3): automated suite for permission matrix, grant expiry/concurrency, PKCE,
  cookie revocation, rate limits, XSS; OIDC negative tests.

## Deploy/ops notes

- New env knobs (all optional, deny-by-default): HTTP_ALLOW_METHODS, HTTP_ALLOW_PATHS, HTTP_ALLOWED_PORTS;
  existing HTTP_ALLOWED_HOSTS unchanged. Set HTTP_ALLOW_PATHS (e.g. \u201c/v1/,/api/\u201d) for any credential whose
  host exposes state-changing routes.
- No wrangler.jsonc changes made; no commit made; no secrets exposed in this review.
