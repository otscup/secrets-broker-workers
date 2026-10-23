# Running the fill executor

The execution layer is the only component that ever holds a credential value in
the clear. This document covers deploying it; the interface it must implement is
in [fill-execution-contract.md](fill-execution-contract.md).

## Why it is not a Worker

A Cloudflare Worker cannot run a browser: no DOM, no cookie jar, no CDP, no
screenshot. It can only speak HTTP. So the Worker decides *whether* a login may
happen and mints a one-shot task; a separate process opens the page and types.

That is a deliberate split, not a gap:

| | Worker | Executor |
|---|---|---|
| decides | ✅ policy, approval, scope | ❌ |
| holds the value | ❌ never | ✅ for one task |
| opens a page | ❌ cannot | ✅ |
| can reach your LAN | ❌ | ✅ if you run it there |

## 1. Register the executor

The broker stores only a hash of the secret, so it is shown once.

```bash
# From a logged-in browser session (the cookie jar is yours):
curl -X POST https://sb.example.com/api/fill/executors/register \
  -b cookies.txt -H 'content-type: application/json' \
  -d '{"executorId":"home"}'
# -> {"ok":true,"executorId":"home","secret":"..."}
```

`executorId` must be 3–64 characters of `A-Za-z0-9._-`.

## 2. Start it

```bash
export BROKER_URL=https://sb.example.com
export EXECUTOR_ID=home
export EXECUTOR_SECRET=...        # from step 1
docker compose -f deploy/executor-compose.yml up -d
docker logs -f secrets-fill-executor
```

It polls `/api/fill/tasks/claim` every 3 seconds. Idle is the normal state.

## 3. Make an item fillable

In the console, the credential must be:

1. classified **web** (a website login — an api credential is read, not filled);
2. given the origins it may be filled into, e.g. `https://nas.example.com`;
3. granted to the Agent with the `secret.fill` action.

Then an Agent calling `secret.fill` gets a task id, and the executor types it.

## What happens, step by step

```
Agent ──secret.fill──▶ Worker
                       ├─ policy: origin must match exactly
                       ├─ vault must be unlocked
                       └─ mint one-shot task + task credential
Agent ◀──taskId────────┘
                       Executor ──claim──▶ Worker  (polls)
                       Executor ◀──taskId origin credential
                       Executor ──redeem─▶ Worker
                       Executor ◀──username password totp   (this task only)
                       Executor: launch browser, fresh profile
                       Executor: navigate to the exact origin
                       Executor: type into the form, submit
                       Executor ──report──▶ Worker  (completed / failed)
                       Executor: destroy the browser profile
Agent ◀──status only───┘
```

At no point does the Agent receive the value, and at no point does the Worker
hold a page. The task credential is bound to this task, this executor, this
origin and this policy revision, and is redeemed once.

## What it refuses, on purpose

- **A redirect to another host.** Navigation and submit are both re-checked
  against the authorised origin; leaving it fails the task.
- **Requests to anything but the authorised origin.** The browser context has a
  route rule that aborts them, including analytics and CDNs.
- **A reused session.** A fresh browser context per task, destroyed afterwards.
  No cookie jar carries into the next login.
- **TOTP.** A 30-second code cannot be carried across an unknown login page
  reliably, and guessing which field takes it is how a login gets submitted with
  the code in the password box. The task reports `filled-without-totp`.
- **A captcha.** It reports `captcha` and stops. Escalating a captcha without
  exposing the session is still an open question in the contract.

## What you must accept

This container can type your passwords into websites. Treat it like a password
manager binary:

- run it on a host you control, on the network that holds the target sites;
- give it no access to the NodeWarden D1 database;
- keep `read_only: true` and the `tmpfs` from the compose file;
- revoke it with `POST /api/fill/executors/revoke` if the host is compromised —
  the secret stops working immediately and existing tasks die at the next check.

The broker can stop *new* work at once. It cannot interrupt a task already
running inside the executor; that cancel channel is not implemented yet, and is
stated as a limit in the contract.
