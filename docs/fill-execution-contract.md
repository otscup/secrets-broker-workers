# Web fill - execution layer contract (P2)

Status: **contract only. No browser is deployed by this repository.**

P1 shipped the decision layer: classification, exact-origin policy, approval,
one-shot authorization, atomic consumption and audit. This document defines the
interface an execution layer must implement, and the isolation rules it has to
follow. A real browser service is a separate, separately reviewed deployment.

## 1. What the execution layer is

The execution layer is a separate process that holds the plaintext credential
for the duration of one task and puts it into a page. It is the only component
that ever sees a credential value.

It is NOT part of the Worker. A Cloudflare Worker cannot run a browser: it has
no DOM, no `eval`, no cookie jar, no screenshot, no CDP. The Worker can only
speak HTTP.

## 2. The only endpoint that returns a credential

```
POST /api/fill/execute
Headers:
  x-fill-execution-token: <FILL_EXECUTION_TOKEN>
  content-type: application/json
Body:
  { "nonce": "<taskId>", "itemId": "<cipher id>", "agent": "<agent name>",
    "origin": "https://example.com" }

Response (200):
  { "username": "...", "password": "...", "totp": "...",
    "origin": "https://example.com", "action": "login" }
```

Rules the broker enforces, and which the execution layer must not weaken:

1. `x-fill-execution-token` must equal `FILL_EXECUTION_TOKEN`. That token is
   **never** given to an Agent, never appears in an MCP response, and never
   appears in the audit log.
2. The `nonce` is a one-shot authorization, bound to agent, item, account,
   origin and action. It is redeemed atomically: a replay or a concurrent
   second call fails.
3. The `origin` must equal the authorized origin exactly. A mismatch is
   refused.
4. The vault must be unlocked. A locked vault returns 423 and the task dies.
5. A missing or expired authorization returns 403.

## 3. What the execution layer must NOT do

- Must not expose CDP, `Runtime.evaluate`, arbitrary JavaScript execution, or
  a full DOM dump to the Agent or to any caller.
- Must not export cookies, `localStorage`, or the page HTML.
- Must not take screenshots that leave the task, and must not OCR a captcha.
  A captcha is escalated to a human.
- Must not follow a redirect or a cross-origin navigation to another site. The
  origin is re-checked before every navigation and before every form submit.
- Must not run a login against more than one origin, and must not reuse a
  page that was already loaded for a different origin.
- Must not keep a browser profile, a cookie jar or a cache after the task
  ends. A fresh profile per task.
- Must not talk to the Agent directly. The Agent talks to the Worker; the
  Worker talks to the execution layer.

## 4. Task lifecycle and invalidation

```
Agent            Worker                     Execution layer
  |  secret.fill  |                            |
  |--------------->| authorize, mint nonce      |
  |<---------------| taskId, origin             |
  |                |                            |
  |                |<-- redeem nonce (token) ---|  (the layer pulls)
  |                |--- credential ------------>|
  |                |                            | fill + submit
  |                |                            | report outcome
  |                |<-- outcome (no secret) ----|
  |<---------------| status only                |
```

Invalidation contract:

- The nonce expires after 10 minutes (`FILL_AUTH_TTL_MS`, capped at 15).
- The redemption checks the vault session again, so a lock or an expiry
  between issuing and redeeming stops the task.
- **Not yet implemented, and stated as a limit:** a task that is already
  running inside the execution layer is not interrupted when the vault is
  locked or the capability is revoked. The broker only blocks new
  redemptions. Stopping a live task needs a cancel channel from the broker
  to the execution layer, which is part of P2 implementation, not P1.

## 5. Isolation requirements for a real deployment

- One throwaway browser profile per task, destroyed afterwards.
- No outbound network access except to the authorized origin.
- The CDP port must never be reachable from the public internet. The
  execution layer is reached only through the broker, with the shared token.
- A dedicated, low-privilege account with no access to the NodeWarden D1.
- Rate limits per agent and per origin, and an audit of every navigation.

## 6. Mock execution layer (P2, in this repository)

The mock exists to prove the contract end to end without a browser. It
performs the redemption over HTTP exactly as a real layer would, asserts that
the value arrives, and then discards it. It never renders a page.

## 7. Open questions for the browser review

- Which runtime: a self-hosted container with CDP, a third-party browser API,
  or a hardened headless build. Each has a different blast radius.
- How a captcha is escalated to a human without exposing the session.
- Whether a session may be reused for a second task on the same origin, and
  if so, how the cookie jar is scoped and destroyed.
- The cancel channel: how a live task is stopped when the vault is locked.
