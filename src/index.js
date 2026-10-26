import { DurableObject } from 'cloudflare:workers'
import { uiHtml } from './ui.js'
import { aiSnapshot, askAi, aiInsights, aiModelCatalog } from './ai.js'
import { parseCommand, TELEGRAM_HELP, formatPendingList, formatGrants, formatStatus, resolvePending, autoRuleActive, describeAutoRule } from './telegram.js'
import { LOGO_PNG_B64, FAVICON_ICO_B64 } from './logo.js'
import {
  b64ToBytes, cipherKeys, constantTimeEqual, decryptCipherRow, decryptStr, encryptStr, extractSecret, extractUsername, extractTotp,
  hmacSha256, hmacToken, pbkdf2, rowReadable, sha256Base64, unwrapWithKek, wrapWithKek, bytesToB64,
} from './crypto.js'
import { parseJwt, verifyJwtSignature, validateIdTokenClaims, checkUserinfoSub, ALLOWED_ALGS } from './oidc.js'
import { pullRemote, diffVaults, diffSummary } from './vaultdiff.js'
import { vault2Status, vault2Init, vault2Unlock, vault2List, vault2ListPlain, vault2Create, vault2Update, vault2Delete, vault2Read, vault2Pair, vault2Devices, vault2RevokeDevice, vault2SetDeviceWrite, vault2PurgeDevice, vault2DeviceByToken, vault2Rekey, vault2RekeyPending, vault2DeviceSelf, vault2Push } from './vault2.js'
import { publicKeyFingerprint } from './envelope.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const SESSION_COOKIE = 'broker_admin'
const jsonBase = (data, status = 200, headers = {}) => Response.json(data, { status, headers })
const json = jsonBase
const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
}
const htmlResponse = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders } })
const fail = (message, status = 400) => json({ error: message }, status)
const failBase = fail
const nowIso = () => new Date().toISOString()

const emptyState = () => ({ agents: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {} } })

// Every write to the state document must bump the version that /state/cas
// compares against. Only the CAS route used to do it, so a change committed by
// a DO-side transaction (a capability use, a legacy grant migration) left the
// version untouched: a Worker that had already read version V could then CAS its
// stale snapshot over the change, reverting the counter it just incremented.
// That is how 20 concurrent reads of an unlimited capability ended with
// usedCount=19, and the same window can undo a maxUses increment.
async function putStateVersioned(txn, store) {
  await txn.put('state', store)
  await txn.put('stateVersion', ((await txn.get('stateVersion')) ?? 0) + 1)
}

export class BrokerState extends DurableObject {
  // The v2 data key for the current unlock, in memory only.
  v2Key = null

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/state') {
      if (request.method === 'GET') return json({ state: (await this.ctx.storage.get('state')) ?? null })
      if (request.method === 'PUT') {
        await this.ctx.storage.put('state', await request.json())
        return json({ ok: true })
      }
    }
    // Versioned read: the version lives beside the state so a caller can detect
    // that another writer committed in between.
    if (url.pathname === '/state/versioned' && request.method === 'GET') {
      const version = (await this.ctx.storage.get('stateVersion')) ?? 0
      return json({ state: (await this.ctx.storage.get('state')) ?? null, version })
    }
    // Compare-and-swap write. The version check and the write happen in one
    // transaction, so exactly one of several racing writers can win.
    if (url.pathname === '/state/cas' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const expected = Number(body.expectedVersion ?? -1)
      const result = await this.ctx.storage.transaction(async (txn) => {
        const current = (await txn.get('stateVersion')) ?? 0
        if (Number(current) !== expected) return { ok: false, reason: 'version-mismatch', version: Number(current) }
        await txn.put('state', body.state ?? {})
        await txn.put('stateVersion', Number(current) + 1)
        return { ok: true, version: Number(current) + 1 }
      })
      return json(result)
    }
    // The v2 data key, cached in memory only. Unlocking again after the object is
    // evicted costs one PBKDF2 run; a key that never reaches storage cannot leak
    // out of it. Transported as 32 plain numbers so no encoder can disagree.
    if (url.pathname === '/v2-key') {
      if (request.method === 'GET') {
        const entry = this.v2Key
        if (!entry || entry.expiresAt <= Date.now()) {
          this.v2Key = null
          return json({ ok: false, reason: 'locked' }, 401)
        }
        return json({ ok: true, dek: [...entry.dek], expiresAt: entry.expiresAt })
      }
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => ({}))
        const dek = Uint8Array.from(Array.isArray(body.dek) ? body.dek : [])
        if (dek.length !== 32) return json({ ok: false, reason: 'bad-key' }, 400)
        const ttl = Math.min(12 * 3600 * 1000, Math.max(60 * 1000, Number(body.ttlMs) || 3600 * 1000))
        this.v2Key = { dek, expiresAt: Date.now() + ttl }
        return json({ ok: true, expiresAt: this.v2Key.expiresAt })
      }
      if (request.method === 'DELETE') {
        this.v2Key = null
        return json({ ok: true })
      }
    }
    if (url.pathname === '/pair' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      this.pairing ??= new Map()
      const now = Date.now()
      for (const [code, entry] of this.pairing) if (entry.expiresAt <= now) this.pairing.delete(code)
      if (body.op === 'request') {
        this.pairing.set(String(body.code), {
          name: String(body.name || ''),
          jwk: body.jwk ?? null,
          fingerprint: String(body.fingerprint || ''),
          pollHash: String(body.pollHash || ''),
          expiresAt: Number(body.expiresAt || 0),
          approved: null,
        })
        return json({ ok: true })
      }
      if (body.op === 'lookup') {
        const entry = this.pairing.get(String(body.code))
        if (!entry) return json({ ok: false, reason: 'unknown' })
        return json({ ok: true, entry: { name: entry.name, jwk: entry.jwk, fingerprint: entry.fingerprint, expiresAt: entry.expiresAt, approved: Boolean(entry.approved), deviceId: entry.approved?.deviceId ?? null } })
      }
      if (body.op === 'approve') {
        const entry = this.pairing.get(String(body.code))
        if (!entry) return json({ ok: false, reason: 'unknown' })
        if (entry.approved) return json({ ok: false, reason: 'already' })
        entry.approved = { deviceId: String(body.deviceId || ''), token: String(body.token || ''), envelope: body.envelope ?? null, keygen: String(body.keygen || ''), fingerprint: String(body.fingerprint || '') }
        return json({ ok: true })
      }
      if (body.op === 'poll') {
        for (const [code, entry] of this.pairing) {
          if (!entry.pollHash || entry.pollHash !== String(body.pollHash || '')) continue
          if (!entry.approved) return json({ ok: true, status: 'pending' })
          // One-time redeem: the second poll cannot find the entry at all.
          this.pairing.delete(code)
          return json({ ok: true, status: 'approved', approved: entry.approved })
        }
        return json({ ok: false, reason: 'unknown' })
      }
      return json({ ok: false, reason: 'bad-op' }, 400)
    }
    if (url.pathname === '/grant/consume' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const key = `${String(body.agent ?? '')}\u0000${String(body.name ?? '')}`
      // Consuming a legacy grant is a read-modify-write of the whole document:
      // without the transaction two callers can both see reads < maxReads and
      // both get the plaintext.
      const result = await this.ctx.storage.transaction(async (txn) => {
        const state = (await txn.get('state')) ?? null
        const grant = state?.grants?.[key]
        if (!grant || grant.revokedAt) return { ok: false, reason: 'no-grant' }
        if (grant.expiresAt && grant.expiresAt < Date.now()) return { ok: false, reason: 'expired' }
        if (grant.maxReads != null && (grant.reads ?? 0) >= grant.maxReads) return { ok: false, reason: 'exhausted' }
        grant.reads = (grant.reads ?? 0) + 1
        if (grant.maxReads != null && grant.reads >= grant.maxReads) delete state.grants[key]
        await putStateVersioned(txn, state)
        return { ok: true, reads: grant.reads }
      })
      return json(result)
    }
    // Atomic capability check-and-consume. The counter mutation runs inside
    // storage.transaction() with exclusive access per Durable Object, so
    // concurrent callers cannot both observe usedCount < maxUses. The
    // transaction is short: pure checks + counter write only, never held
    // across external HTTP. A consumed use counts even if the upstream call
    // later fails (prevents infinite failure-retry bypass); safe retry needs
    // a separate idempotency key (future work). Revocation takes effect for
    // all NEW requests; a request already past this gate keeps its slot.
    if (url.pathname === '/capability/consume' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const key = String(body.key ?? '')
      const accountId = String(body.accountId ?? '')
      const action = String(body.action ?? '')
      const result = await this.ctx.storage.transaction(async (txn) => {
        const store = (await txn.get('state')) ?? {}
        const cap = store.capabilities?.[key] ?? null
        if (!cap) return { ok: false, reason: 'no-capability' }
        if (!cap.subjectId || !cap.itemId || cap.action !== action) return { ok: false, reason: 'mismatch' }
        if (accountId && cap.accountId && cap.accountId.toLowerCase() !== accountId.toLowerCase()) return { ok: false, reason: 'cross-account' }
        if (cap.revokedAt) return { ok: false, reason: 'revoked' }
        if (cap.expiresAt != null && cap.expiresAt <= Date.now()) return { ok: false, reason: 'expired' }
        if (cap.maxUses != null && (cap.usedCount ?? 0) >= cap.maxUses) return { ok: false, reason: 'exhausted' }
        cap.usedCount = (cap.usedCount ?? 0) + 1
        // Tombstone on exhaustion: keep the record so capabilityStatus stays
        // 'exhausted' and lazy migration can never resurrect it with a reset
        // counter. Only an admin-issued grant may replace it.
        if (cap.maxUses != null && cap.usedCount >= cap.maxUses) {
          cap.exhaustedAt = new Date().toISOString()
          store.capabilities[key] = cap
        } else store.capabilities[key] = cap
        await putStateVersioned(txn, store)
        return { ok: true, usedCount: cap.usedCount, capabilityId: cap.id ?? key }
      })
      return json(result)
    }
    // Atomic read-modify-write for the whole broker state. The Worker's
    // updateState() does load -> mutate -> save across three round trips, so two
    // concurrent requests can each read the same snapshot and the later write
    // silently discards the other's change (e.g. a freshly registered OAuth
    // client vanishing). This endpoint performs the mutation inside a single
    // serialized storage transaction instead.
    //
    // The mutator is not executable on the DO side, so the Worker sends a list
    // of declarative ops. Unknown ops are rejected; nothing is written unless
    // every op applies.
    // ── Geo events (Agent Live Globe) ────────────────────────────────────
    // Deliberately stored under its OWN storage key, never inside `state`: the
    // main state is CAS-versioned and rewritten wholesale, and mixing a
    // high-frequency append log into it would amplify every write.
    // Appends are serialized per Durable Object, so concurrent requests cannot
    // clobber each other, and the ring buffer enforces both caps.
    const GEO_MAX_EVENTS = 2000
    const GEO_MAX_AGE_MS = 7 * 86400e3
    if (url.pathname === '/geo/append' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const event = body && typeof body.event === 'object' ? body.event : null
      if (!event) return json({ ok: false, reason: 'invalid' })
      const result = await this.ctx.storage.transaction(async (txn) => {
        const store = (await txn.get('geoEvents')) ?? { seq: 0, events: [] }
        const now = Date.now()
        const seq = Number(store.seq ?? 0) + 1
        // Monotonic sequence makes ordering stable even when timestamps collide.
        const record = { ...event, seq, id: 'evt_' + seq }
        let events = Array.isArray(store.events) ? store.events.slice() : []
        events.push(record)
        // Enforce both retention caps inside the same transaction.
        if (events.length > GEO_MAX_EVENTS) events = events.slice(events.length - GEO_MAX_EVENTS)
        events = events.filter((entry) => {
          const at = Date.parse(entry && entry.at)
          return !Number.isFinite(at) || now - at <= GEO_MAX_AGE_MS
        })
        await txn.put('geoEvents', { seq, events })
        return { ok: true, id: record.id, seq, total: events.length }
      })
      return json(result)
    }
    // Operator location: captured when an admin successfully authenticates, so
    // the globe can draw "me -> agent -> node". Kept out of the event log.
    if (url.pathname === '/geo/operator' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const geo = body && typeof body.geo === 'object' ? body.geo : null
      if (!geo) return json({ ok: false })
      await this.ctx.storage.put('geoOperator', { ...geo, at: nowIso() })
      return json({ ok: true })
    }
    if (url.pathname === '/geo/operator' && request.method === 'GET') {
      return json({ operator: (await this.ctx.storage.get('geoOperator')) ?? null })
    }
    // Internal-only reset used by tests and by an operator clearing the globe.
    // Reachable solely through the Durable Object binding, never from the edge.
    if (url.pathname === '/geo/reset' && request.method === 'POST') {
      await this.ctx.storage.put('geoEvents', { seq: 0, events: [] })
      return json({ ok: true })
    }
    if (url.pathname === '/geo/query' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const windowMs = Math.max(60000, Math.min(GEO_MAX_AGE_MS, Number(body.windowMs) || 3600e3))
      const sinceSeq = Number(body.sinceSeq ?? 0)
      const limit = Math.max(1, Math.min(500, Number(body.limit) || 200))
      const store = (await this.ctx.storage.get('geoEvents')) ?? { seq: 0, events: [] }
      const now = Date.now()
      const all = Array.isArray(store.events) ? store.events : []
      const inWindow = all.filter((entry) => {
        const at = Date.parse(entry && entry.at)
        return Number.isFinite(at) && now - at <= windowMs
      })
      // Incremental fetch: everything newer than the client's cursor.
      const fresh = sinceSeq > 0 ? inWindow.filter((entry) => Number(entry.seq ?? 0) > sinceSeq) : inWindow
      const page = fresh.slice(0, limit)
      const cursor = page.length ? Number(page[page.length - 1].seq ?? 0) : sinceSeq
      return json({ ok: true, events: page, cursor, hasMore: fresh.length > page.length, total: inWindow.length })
    }
    // Fill authorization ledger. Kept in a separate storage key so the main
    // state shape is untouched, and every mutation runs inside a transaction.
    if (url.pathname === '/fill/issue' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const record = body && typeof body.record === 'object' ? body.record : null
      if (!record || !record.nonce || !record.agent || !record.itemId || !record.origin || !record.action) {
        return json({ ok: false, reason: 'invalid' })
      }
      const stored = await this.ctx.storage.transaction(async (txn) => {
        const ledger = (await txn.get('fillAuthorizations')) ?? {}
        // The policy revision is checked in the same transaction that stores
        // the authorization, so a nonce is never minted under a policy that
        // has already been changed.
        const store = (await txn.get('state')) ?? {}
        const current = store.fillPolicies?.[record.itemId] ?? null
        if (!current) return { ok: false, reason: 'policy-missing' }
        if (record.policyRevision && record.policyRevision !== current.policyRevision) {
          return { ok: false, reason: 'policy-revised' }
        }
        if (!String(current.origins ?? []).includes(record.origin)) return { ok: false, reason: 'origin-not-allowed' }
        if (!String(current.actions ?? []).includes(record.action)) return { ok: false, reason: 'action-not-allowed' }
        if (ledger[record.nonce]) return { ok: false, reason: 'nonce-exists' }
        ledger[record.nonce] = record
        // Keep the ledger bounded; expired entries are pruned on write.
        const now = Date.now()
        for (const [key, entry] of Object.entries(ledger)) {
          if (!entry || (entry.expiresAt && entry.expiresAt < now)) delete ledger[key]
        }
        await txn.put('fillAuthorizations', ledger)
        return { ok: true }
      })
      return json(stored)
    }
    if (url.pathname === '/fill/consume' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const { nonce, agent, itemId, accountId, origin } = body ?? {}
      if (!nonce) return json({ ok: false, reason: 'nonce-missing' })
      const result = await this.ctx.storage.transaction(async (txn) => {
        const ledger = (await txn.get('fillAuthorizations')) ?? {}
        const record = ledger[nonce]
        if (!record) return { ok: false, reason: 'unknown-nonce' }
        if (record.consumedAt) return { ok: false, reason: 'already-consumed' }
        if (record.expiresAt && record.expiresAt < Date.now()) return { ok: false, reason: 'expired' }
        if (record.agent !== agent) return { ok: false, reason: 'agent-mismatch' }
        if (record.itemId !== itemId) return { ok: false, reason: 'item-mismatch' }
        if (record.accountId && accountId && String(record.accountId).toLowerCase() !== String(accountId).toLowerCase()) {
          return { ok: false, reason: 'account-mismatch' }
        }
        if (record.origin && origin && record.origin !== origin) return { ok: false, reason: 'origin-mismatch' }
        // The authoritative policy is read here, inside the same transaction
        // that consumes the nonce. The Worker cannot supply a snapshot, so a
        // policy that was narrowed or deleted after the authorization was
        // issued is refused. A policy that was deleted and recreated carries a
        // new revision, so the old authorization does not match it either.
        const store = (await txn.get('state')) ?? {}
        const current = store.fillPolicies?.[record.itemId] ?? null
        if (!current) return { ok: false, reason: 'policy-missing' }
        if (!record.policyRevision || record.policyRevision !== current.policyRevision) {
          return { ok: false, reason: 'policy-revised' }
        }
        if (current.accountId && accountId && String(current.accountId).toLowerCase() !== String(accountId).toLowerCase()) {
          return { ok: false, reason: 'policy-account-mismatch' }
        }
        if (!String(current.origins ?? []).includes(record.origin)) return { ok: false, reason: 'origin-not-allowed' }
        if (!String(current.actions ?? []).includes(record.action)) return { ok: false, reason: 'action-not-allowed' }
        record.consumedAt = Date.now()
        ledger[nonce] = record
        await txn.put('fillAuthorizations', ledger)
        return { ok: true, record }
      })
      return json(result)
    }
    // ── Fill task control plane ──────────────────────────────────────────
    // Every task transition runs inside one transaction, so exactly one
    // executor can claim a task and a task can never move backwards.
    // Store a new task. A task is created in the authorized state: the agent
    // already passed the broker's policy and approval checks.
    // List the tasks. The broker uses this to enforce the concurrency caps.
    // Burn the task credential's nonce. A task credential may be used once, and
    // the burn happens in the same transaction as the task state check.
    // The item name is needed to read the credential. It stays inside the
    // broker: the executor receives the value, never the name.
    if (url.pathname === '/fill/task/secret' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const taskId = String(body.taskId ?? '')
      if (!taskId) return json({ ok: false, reason: 'invalid' })
      const ledger = (await this.ctx.storage.get('fillTasks')) ?? {}
      const task = ledger[taskId]
      if (!task) return json({ ok: false, reason: 'unknown-task' })
      return json({ ok: true, itemName: task.itemName ?? '', cipherId: task.cipherId })
    }

    if (url.pathname === '/fill/task/burn' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const { taskId, nonce } = body ?? {}
      if (!taskId || !nonce) return json({ ok: false, reason: 'invalid' })
      const result = await this.ctx.storage.transaction(async (txn) => {
        const burned = (await txn.get('fillTaskNonces')) ?? {}
        if (burned[nonce]) return { ok: false, reason: 'already-consumed' }
        burned[nonce] = { taskId, at: Date.now() }
        // Keep the burn list bounded.
        const cutoff = Date.now() - 60 * 60 * 1000
        for (const [key, entry] of Object.entries(burned)) {
          if (entry && entry.at < cutoff) delete burned[key]
        }
        await txn.put('fillTaskNonces', burned)
        return { ok: true }
      })
      return json(result)
    }

    if (url.pathname === '/fill/task/list' && request.method === 'POST') {
      const ledger = (await this.ctx.storage.get('fillTasks')) ?? {}
      const tasks = Object.values(ledger).map((task) => ({
        taskId: task.taskId, state: task.state, agent: task.agent, accountId: task.accountId,
        cipherId: task.cipherId, executorId: task.executorId, origin: task.origin,
        action: task.action, updatedAt: task.updatedAt ?? 0, createdAt: task.createdAt ?? 0,
        cancelRequested: task.cancelRequested === true,
      }))
      return json({ ok: true, tasks })
    }

    if (url.pathname === '/fill/task/store' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const task = body && typeof body.task === 'object' ? body.task : null
      if (!task || !task.taskId || !task.executorId || !task.cipherId || !task.origin) {
        return json({ ok: false, reason: 'invalid' })
      }
      const result = await this.ctx.storage.transaction(async (txn) => {
        const ledger = (await txn.get('fillTasks')) ?? {}
        if (ledger[task.taskId]) return { ok: false, reason: 'task-exists' }
        // Bound the ledger: a terminal task older than an hour is dropped.
        const cutoff = Date.now() - 60 * 60 * 1000
        for (const [id, entry] of Object.entries(ledger)) {
          if (entry && entry.updatedAt && entry.updatedAt < cutoff && FILL_TASK_TERMINAL.has(entry.state)) delete ledger[id]
        }
        ledger[task.taskId] = task
        await txn.put('fillTasks', ledger)
        return { ok: true }
      })
      return json(result)
    }

    if (url.pathname === '/fill/task/transition' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const { taskId, to, executorId, nonce } = body ?? {}
      if (!taskId || !to) return json({ ok: false, reason: 'invalid' })
      if (!FILL_TASK_STATES.has(String(to))) return json({ ok: false, reason: 'unknown-state' })
      const result = await this.ctx.storage.transaction(async (txn) => {
        const ledger = (await txn.get('fillTasks')) ?? {}
        const task = ledger[taskId]
        if (!task) return { ok: false, reason: 'unknown-task' }
        const now = Date.now()
        // An expired task cannot be revived by any transition.
        if (task.state !== to && FILL_TASK_TERMINAL.has(task.state)) {
          return { ok: false, reason: 'task-terminal', state: task.state }
        }
        if (task.state === to) return { ok: true, state: to, task, unchanged: true }
        const allowed = FILL_TASK_TRANSITIONS[task.state] ?? []
        if (!allowed.includes(String(to))) {
          return { ok: false, reason: 'illegal-transition', state: task.state }
        }
        // A task may only be claimed by the executor it was issued to, and
        // only once: the first claim wins.
        if (to === 'claimed') {
          if (!executorId || task.executorId !== String(executorId)) {
            return { ok: false, reason: 'executor-mismatch' }
          }
          if (task.claimedBy) return { ok: false, reason: 'already-claimed', state: task.state }
          task.claimedBy = String(executorId)
          task.claimedAt = now
        }
        // Only the claimed executor may report progress or completion.
        if ((to === 'running' || to === 'completed' || to === 'failed') && task.claimedBy) {
          if (String(executorId ?? '') !== task.claimedBy) {
            return { ok: false, reason: 'executor-mismatch' }
          }
        }
        task.state = String(to)
        task.updatedAt = now
        if (to === 'completed') task.completedAt = now
        if (to === 'cancelled') task.cancelledAt = now
        ledger[taskId] = task
        await txn.put('fillTasks', ledger)
        return { ok: true, state: task.state, task }
      })
      return json(result)
    }
    // Claim the next task for an executor. The transition to 'claimed' and
    // the assignment happen in the same transaction, so two executors
    // polling at once never receive the same task.
    if (url.pathname === '/fill/task/claim' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const executorId = String(body.executorId ?? '')
      if (!executorId) return json({ ok: false, reason: 'invalid' })
      const result = await this.ctx.storage.transaction(async (txn) => {
        const ledger = (await txn.get('fillTasks')) ?? {}
        const now = Date.now()
        const candidate = Object.values(ledger)
          .filter((task) => task.state === 'authorized' && task.cancelRequested !== true)
          .filter((task) => !task.expiresAt || task.expiresAt > now)
          .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0]
        if (!candidate) return { ok: false, reason: 'no-task' }
        candidate.state = 'claimed'
        candidate.claimedBy = executorId
        candidate.claimedAt = now
        candidate.executorId = executorId
        candidate.updatedAt = now
        ledger[candidate.taskId] = candidate
        await txn.put('fillTasks', ledger)
        return { ok: true, task: candidate }
      })
      return json(result)
    }
    // Read one task. The scope is returned so the executor knows exactly
    // which origin and action it may perform.
    if (url.pathname === '/fill/task/get' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const taskId = String(body.taskId ?? '')
      if (!taskId) return json({ ok: false, reason: 'invalid' })
      const ledger = (await this.ctx.storage.get('fillTasks')) ?? {}
      const task = ledger[taskId]
      if (!task) return json({ ok: false, reason: 'unknown-task' })
      return json({ ok: true, task: {
        taskId: task.taskId, state: task.state, origin: task.origin, action: task.action,
        executorId: task.executorId ?? '', claimedBy: task.claimedBy ?? '',
        cipherId: task.cipherId, agent: task.agent, accountId: task.accountId,
        policyRevision: task.policyRevision, expiresAt: task.expiresAt ?? 0,
        cancelRequested: task.cancelRequested === true,
      } })
    }
    // Expire the tasks that have been idle too long. Called by the Worker on
    // a schedule; expiry is a normal terminal state, not an error.
    if (url.pathname === '/fill/task/expire' && request.method === 'POST') {
      const result = await this.ctx.storage.transaction(async (txn) => {
        const ledger = (await txn.get('fillTasks')) ?? {}
        const now = Date.now()
        const expired = []
        for (const [taskId, task] of Object.entries(ledger)) {
          if (FILL_TASK_TERMINAL.has(task.state)) continue
          const limit = FILL_TASK_TIMEOUT_MS[task.state] ?? 0
          const deadline = (task.updatedAt ?? task.createdAt ?? now) + limit
          if (now > deadline) {
            task.state = 'expired'
            task.updatedAt = now
            task.expiredAt = now
            ledger[taskId] = task
            expired.push(taskId)
          }
        }
        await txn.put('fillTasks', ledger)
        return { ok: true, expired }
      })
      return json(result)
    }
    // Mark a task as cancel-requested. The executor confirms separately, so
// the broker never claims a task is cancelled before the executor agrees.
    if (url.pathname === '/fill/task/request-cancel' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const taskId = String(body.taskId ?? '')
      if (!taskId) return json({ ok: false, reason: 'invalid' })
      const result = await this.ctx.storage.transaction(async (txn) => {
        const ledger = (await txn.get('fillTasks')) ?? {}
        const task = ledger[taskId]
        if (!task) return { ok: false, reason: 'unknown-task' }
        if (FILL_TASK_TERMINAL.has(task.state)) {
          return { ok: false, reason: 'task-terminal', state: task.state }
        }
        task.cancelRequested = true
        task.updatedAt = Date.now()
        ledger[taskId] = task
        await txn.put('fillTasks', ledger)
        return { ok: true, state: task.state, cancelRequested: true }
      })
      return json(result)
    }

    if (url.pathname === '/state/mutate' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const ops = Array.isArray(body.ops) ? body.ops : null
      if (!ops) return json({ ok: false, reason: 'invalid' })
      const result = await this.ctx.storage.transaction(async (txn) => {
        const store = (await txn.get('state')) ?? {}
        for (const op of ops) {
          const kind = String(op?.op ?? '')
          const path = Array.isArray(op?.path) ? op.path.map(String) : null
          if (!path || !path.length) return { ok: false, reason: 'bad-path' }
          // Walk to the parent container, creating plain objects as needed.
          let cursor = store
          for (let i = 0; i < path.length - 1; i += 1) {
            const key = path[i]
            if (cursor[key] === undefined) cursor[key] = {}
            if (cursor[key] === null || typeof cursor[key] !== 'object') return { ok: false, reason: 'not-an-object' }
            cursor = cursor[key]
          }
          const leaf = path[path.length - 1]
          if (kind === 'set') cursor[leaf] = op.value
          else if (kind === 'delete') delete cursor[leaf]
          else if (kind === 'merge' && op.value && typeof op.value === 'object') cursor[leaf] = { ...(cursor[leaf] ?? {}), ...op.value }
          else return { ok: false, reason: 'bad-op' }
        }
        await putStateVersioned(txn, store)
        return { ok: true }
      })
      return json(result)
    }
    // Atomic lazy migration: materialise a legacy grant into a capability
    // exactly once, inside the same serialized storage boundary that later
    // consumes it. Workers never mutate capabilities in memory and then
    // consume, which would allow lost updates between migration and consume.
    if (url.pathname === '/capability/ensure' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      // The DO trusts only IDENTIFIERS from the caller. It derives every
      // authority-bearing field (expiresAt/maxUses/usedCount/accountId/mode)
      // from persisted state, so a caller cannot widen a grant by submitting a
      // hand-built capability object.
      const subjectId = String(body.subjectId ?? '')
      const itemId = String(body.itemId ?? '')
      const action = String(body.action ?? '')
      const accountId = String(body.accountId ?? '')
      const legacyName = String(body.legacyName ?? '')
      if (!subjectId || !itemId || !legacyName || !SECRET_ACTIONS.has(action)) return json({ ok: false, reason: 'invalid' })
      // Legacy grants only ever migrate to secret.read. secret.use requires an
      // explicit admin capability; it is never synthesised here.
      if (action !== 'secret.read') return json({ ok: false, reason: 'action-not-migratable' })
      const key = capabilityKey(subjectId, itemId, action)
      const result = await this.ctx.storage.transaction(async (txn) => {
        const store = (await txn.get('state')) ?? {}
        store.capabilities ??= {}
        const existing = store.capabilities[key]
        // Any existing record — valid, revoked, expired or exhausted — wins.
        // ensure must never overwrite or resurrect it.
        if (existing) return { ok: true, existed: true, usedCount: existing.usedCount ?? 0, status: capabilityStatus(existing) }

        const legacyKey = `${subjectId}\u0000${legacyName}`
        const legacy = store.grants?.[legacyKey] ?? null
        const grantEntry = store.actionGrants?.[actionGrantKey(subjectId, itemId)] ?? null
        const policyNoApproval = store.policies?.[legacyName]?.noApproval === true

        // ── Identity binding: name -> stable cipher id ────────────────────
        // store.itemIds is a MUTABLE cache (written on resolve, never updated
        // on rename/delete), so a name can point at a different cipher over
        // time. Migrating on a bare name match would let a renamed or
        // delete-then-recreated item inherit the old grant. We therefore
        // require a recorded binding and, when the grant itself carries an
        // itemId, that it agrees.
        store.legacyItemBindings ??= {}
        const bindingKey = `${subjectId}\u0000${legacyName}`
        const binding = store.legacyItemBindings[bindingKey] ?? null
        const cachedId = store.itemIds?.[legacyName] ?? ''
        const grantItemId = legacy && typeof legacy.itemId === 'string' ? legacy.itemId : ''
        if (grantItemId && grantItemId !== itemId) return { ok: false, reason: 'grant-item-id-mismatch' }
        if (binding && binding.itemId !== itemId) return { ok: false, reason: 'binding-item-id-mismatch' }
        // The binding requirement applies to GRANT-sourced migrations only.
        // Without it we cannot prove the name still denotes the cipher the
        // grant was issued for, so an unbound grant is refused. A noApproval
        // migration is authorised by its actionGrant, which carries itemId and
        // is validated separately below.
        if (legacy && !binding && !grantItemId) {
          return { ok: false, reason: 'unbound-legacy-identity' }
        }
        if (cachedId && cachedId !== itemId) return { ok: false, reason: 'cache-item-id-mismatch' }

        // ── Authority checks (all inside this transaction) ────────────────
        let source = null
        if (legacy) {
          if (legacy.agent !== subjectId || legacy.name !== legacyName) return { ok: false, reason: 'legacy-subject-mismatch' }
          if (legacy.revokedAt) return { ok: false, reason: 'legacy-revoked' }
          if (legacy.migratedToCapability) return { ok: false, reason: 'legacy-already-migrated' }
          if (legacy.expiresAt && legacy.expiresAt < Date.now()) return { ok: false, reason: 'legacy-expired' }
          if (legacy.maxReads != null && (legacy.reads ?? 0) >= legacy.maxReads) return { ok: false, reason: 'legacy-exhausted' }
          // Same rule for grant-sourced migrations: the grant must name an
          // account and it must match the caller's, otherwise the derived
          // capability would be account-agnostic.
          const legacyAccount = typeof legacy.account === 'string' ? legacy.account.trim() : ''
          if (!isWellFormedAccountId(legacyAccount)) return { ok: false, reason: 'legacy-account-missing' }
          if (!isWellFormedAccountId(accountId)) return { ok: false, reason: 'caller-account-missing' }
          if (legacyAccount.toLowerCase() !== accountId.toLowerCase()) return { ok: false, reason: 'legacy-cross-account' }
          source = 'legacy-grant'
        } else {
          // No legacy grant: a noApproval policy alone is NOT sufficient
          // authority (it would mint a permanent, unlimited capability from a
          // single boolean). It additionally requires a persisted actionGrant
          // covering secret.read for this exact subject/item/account.
          if (!policyNoApproval) return { ok: false, reason: 'no-legacy-source' }
          if (!grantEntry) return { ok: false, reason: 'no-action-grant' }
          if (!(grantEntry.actions ?? []).includes('secret.read')) return { ok: false, reason: 'action-grant-mismatch' }
          if (grantEntry.subjectId !== subjectId || grantEntry.itemId !== itemId) return { ok: false, reason: 'action-grant-subject-mismatch' }
          // The actionGrant must carry an explicit, well-formed accountId and
          // the caller's vault account must match it exactly. An absent/blank
          // account would otherwise mint an account-agnostic capability that
          // the consume gate treats as "no account restriction".
          const grantAccount = typeof grantEntry.accountId === 'string' ? grantEntry.accountId.trim() : ''
          if (!isWellFormedAccountId(grantAccount)) return { ok: false, reason: 'action-grant-account-missing' }
          if (!isWellFormedAccountId(accountId)) return { ok: false, reason: 'caller-account-missing' }
          if (grantAccount.toLowerCase() !== accountId.toLowerCase()) return { ok: false, reason: 'action-grant-cross-account' }
          source = 'no-approval-policy'
        }

        // ── Derive the capability strictly from the persisted source ──────
        const now = Date.now()
        const derived = {
          id: key,
          subjectId,
          itemId,
          itemName: legacy?.name ?? grantEntry?.itemName ?? legacyName,
          action,
          // A noApproval-only migration is bounded: 24h and a single use, so a
          // boolean cannot produce an unbounded grant. A legacy grant keeps its
          // own terms verbatim.
          mode: 'preapproved',
          createdAt: new Date(now).toISOString(),
          createdBy: 'do-migration:' + source,
          accountId: String((legacy?.account ?? grantEntry?.accountId ?? accountId) || ''),
          expiresAt: source === 'legacy-grant'
            ? (legacy.expiresAt ? legacy.expiresAt : null)
            : now + 86400e3,
          maxUses: source === 'legacy-grant'
            ? (legacy.maxReads ?? null)
            : 1,
          usedCount: source === 'legacy-grant' ? Number(legacy.reads ?? 0) : 0,
          revokedAt: null,
          revokedBy: null,
          approvalId: null,
          policyVersion: 1,
        }
        // Final guard: never persist a capability without a concrete account.
        if (!isWellFormedAccountId(derived.accountId)) return { ok: false, reason: 'derived-account-missing' }
        if (derived.accountId.toLowerCase() !== accountId.toLowerCase()) return { ok: false, reason: 'derived-cross-account' }
        if (source === 'legacy-grant') {
          legacy.migratedToCapability = key
          // Record the immutable identity binding the first time a migration is
          // authorised, so later renames/recreates cannot re-point this name.
          store.legacyItemBindings[bindingKey] = { itemId, boundAt: new Date(now).toISOString(), boundBy: source }
        }
        store.capabilities[key] = derived
        await putStateVersioned(txn, store)
        return { ok: true, existed: false, usedCount: derived.usedCount, source }
      })
      return json(result)
    }
    // Atomic OIDC state check-and-consume. The state mutation runs inside
    // storage.transaction(), which Cloudflare executes with exclusive access
    // against every other transaction on the same Durable Object (SQLite
    // storage: BEGIN IMMEDIATE-style; concurrent transactions serialize and
    // only one check-and-mark wins). Pure-crypto parsing/verification happens
    // before the transaction; the replay check + mark inside it is atomic.
    // Callers must treat any non-ok result as a hard reject.
    if (url.pathname === '/oidc/state/consume' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const cookieValue = String(body.cookie ?? '')
      const returned = String(body.state ?? '')
      const decoded = (() => { try { return decodeURIComponent(cookieValue) } catch { return '' } })()
      const parts = decoded ? decoded.split('|') : []
      if (parts.length < 7) return json({ ok: false, reason: 'invalid' })
      const signature = parts.pop()
      const expires = Number(parts.pop())
      const next = parts.pop()
      const nonce = parts.pop()
      const verifier = parts.pop()
      const state = parts.pop()
      const provider = parts.pop()
      if (!state || state !== returned) return json({ ok: false, reason: 'mismatch' })
      const payload = provider + '|' + state + '|' + verifier + '|' + nonce + '|' + next + '|' + expires
      const expected = await hmacToken(await cookieKey(this.env), payload)
      if (!constantTimeEqual(encoder.encode(expected), encoder.encode(signature ?? ''))) return json({ ok: false, reason: 'invalid' })
      if (!Number.isFinite(expires) || expires < Date.now()) return json({ ok: false, reason: 'expired' })
      const marked = await this.ctx.storage.transaction(async (txn) => {
        const store = (await txn.get('state')) ?? {}
        store.oidcUsedStates ??= {}
        const entry = store.oidcUsedStates[state]
        if (entry && typeof entry.at === 'number' && Date.now() - entry.at <= 15 * 60 * 1000) return false
        store.oidcUsedStates[state] = { at: Date.now() }
        const keys = Object.keys(store.oidcUsedStates)
        if (keys.length > 5000) {
          keys.sort((a, b) => ((store.oidcUsedStates[a]?.at ?? 0) - (store.oidcUsedStates[b]?.at ?? 0)))
          for (const k of keys.slice(0, keys.length - 5000)) delete store.oidcUsedStates[k]
        }
        await putStateVersioned(txn, store)
        return true
      })
      if (!marked) return json({ ok: false, reason: 'replay' })
      return json({ ok: true, state, verifier, nonce, next, expires, provider })
    }
    if (url.pathname === '/session') {
      if (request.method === 'GET') {
        const session = await this.ctx.storage.get('session')
        if (!session) return json({ ok: true, session: null })
        if (session.expiresAt && session.expiresAt < Date.now()) {
          await this.ctx.storage.delete('session')
          return json({ ok: true, session: null })
        }
        return json({ ok: true, session })
      }
      if (request.method === 'PUT') {
        await this.ctx.storage.put('session', await request.json())
        return json({ ok: true })
      }
      if (request.method === 'DELETE') {
        await this.ctx.storage.delete('session')
        return json({ ok: true })
      }
    }
    return json({ error: 'not found' }, 404)
  }
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return ''
}

async function cookieKey(env) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('cookie:' + String(env.SESSION_KEK ?? ''))))
}

async function makeCookie(env) {
  const expires = Date.now() + 7 * 86400 * 1000
  const signature = await hmacToken(await cookieKey(env), String(expires))
  return `v1.${expires}.${signature}`
}

function cookieSessionId(request) {
  const value = readCookie(request, SESSION_COOKIE)
  if (!value.startsWith('v2.')) return ''
  return value.split('.')[1] ?? ''
}

async function createAdminCookie(env, request) {
  const id = randomToken()
  const expires = Date.now() + 7 * 86400 * 1000
  const payload = `v2.${id}.${expires}`
  const signature = await hmacToken(await cookieKey(env), payload)
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? ''
  const ua = request.headers.get('user-agent') ?? ''
  // Write the session record atomically. A read-modify-write here races with any
  // concurrent state write: the login could land in a snapshot that a parallel
  // request then overwrites, leaving a signed cookie with no server-side record.
  // validCookie() would reject it and the user would bounce between /login and
  // /oauth/authorize forever.
  const written = await mutateState(env, [{
    op: 'set',
    path: ['adminSessions', id],
    value: { id, ip, ua, createdAt: nowIso(), lastSeen: nowIso(), expiresAt: expires },
  }])
  if (!written?.ok) throw new Error('could not persist admin session')
  return `${payload}.${signature}`
}

// Session cookie helpers. `clearable` reports whether the presented cookie is a
// stale/legacy form that must be deleted client-side, so it cannot survive a
// successful re-login and keep shadowing the fresh cookie.
const SESSION_COOKIE_ATTRS = 'Path=/; HttpOnly; Secure; SameSite=None'
const COOKIE_CLEAR_HEADER = `${SESSION_COOKIE}=; ${SESSION_COOKIE_ATTRS}; Max-Age=0`

async function validCookieDetailed(request, env) {
  const value = readCookie(request, SESSION_COOKIE)
  if (!value) return { ok: false, clearable: false }
  if (value.startsWith('v2.')) {
    const [version, id, expiresText, signature] = value.split('.')
    const expires = Number(expiresText)
    // A malformed v2 cookie can never become valid: drop it so the browser
    // stops presenting it on every subsequent request.
    if (!id || !Number.isFinite(expires) || expires < Date.now()) return { ok: false, clearable: true }
    const payload = `${version}.${id}.${expiresText}`
    const expected = await hmacToken(await cookieKey(env), payload)
    if (!constantTimeEqual(encoder.encode(expected), encoder.encode(signature ?? ''))) return { ok: false, clearable: true }
    const state = await loadState(env)
    const record = state.adminSessions?.[id]
    if (!record) return { ok: false, clearable: true }
    if (record.expiresAt && record.expiresAt < Date.now()) return { ok: false, clearable: true }
    if (!record.lastSeen || Date.now() - Date.parse(record.lastSeen) > 300000) {
      // Touch lastSeen atomically; a whole-state read-modify-write here would
      // clobber concurrent writes (including a just-created session).
      await mutateState(env, [{ op: 'set', path: ['adminSessions', id, 'lastSeen'], value: nowIso() }]).catch(() => {})
    }
    return { ok: true, clearable: false }
  }
  // Legacy v1 cookies are always rejected unless explicitly enabled, and must
  // always be cleared: leaving one in place makes every later request look
  // authenticated-or-poisoned while the server refuses it, which produces the
  // login <-> authorize ping-pong.
  return { ok: false, clearable: true }
}

async function validCookie(request, env) {
  return (await validCookieDetailed(request, env)).ok
}

async function kekBytes(env) {
  const bytes = b64ToBytes(env.SESSION_KEK ?? '')
  if (bytes.length !== 32) throw new Error('SESSION_KEK must be a base64-encoded 32-byte key')
  return bytes
}

function stateStub(env) {
  return env.BROKER_STATE.get(env.BROKER_STATE.idFromName('global'))
}

async function loadState(env) {
  const response = await stateStub(env).fetch('https://state/state/versioned')
  const payload = await response.json()
  const stateVersion = Number(payload.version ?? 0)
  let state = payload.state
  if (!state || !state.agents) state = emptyState()
  state.settings ??= { notifications: {} }
  state.settings.notifications ??= {}
  state.policies ??= {}
  state.itemGroups ??= {}
  state.profile ??= {}
  state.security ??= { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' }
  state.oauthClients ??= {}
  state.oauthCodes ??= {}
  state.oauthTokens ??= {}
  state.oauthAgentProfiles ??= {}
  state.adminSessions ??= {}
  state.grants ??= {}
  for (const grant of Object.values(state.grants)) {
    // Legacy share grants used to be promoted to permanent/no-approval. That
    // silently erased an operator-set expiry (and let an expired grant migrate
    // into a fresh capability), so only fill fields that were never set.
    if (grant.mode === 'share' && !grant.revokedAt && grant.noApproval === undefined) {
      grant.noApproval = true
      if (grant.expiresAt === undefined) grant.expiresAt = 0
      if (grant.maxReads === undefined) grant.maxReads = null
    }
  }
  state.transfers ??= []
  state.credentialRequests ??= {}
  // Phase-1 hybrid permission model. Additive only: nothing here is consulted
  // by the legacy path unless authorizeSecretAction() is called explicitly.
  state.actionGrants ??= {}
  state.usePolicies ??= {}
  const defaultAgentAccount = state.settings?.vaultEmail || env.VAULT_EMAIL || ''
  for (const agent of Object.values(state.agents ?? {})) {
    if (!agent.account && defaultAgentAccount) agent.account = defaultAgentAccount
    if (agent.allowAll === undefined) agent.allowAll = (agent.allow ?? []).length === 0 && (agent.groups ?? []).length === 0
    // Legacy agents predate the action model. Mark them so secret.read can
    // keep working via the old scope rules, while secret.use stays denied
    // until an explicit action grant exists.
    if (agent.legacy === undefined) agent.legacy = true
  }
  for (const profile of Object.values(state.oauthAgentProfiles ?? {})) {
    if (profile.allowAll === undefined) profile.allowAll = (profile.allow ?? []).length === 0 && (profile.groups ?? []).length === 0
    if (profile.legacy === undefined) profile.legacy = true
  }
  state.pending ??= {}
  state.audit ??= []
  // Bootstrap writes must not blindly overwrite the whole state: that would
  // discard concurrent changes (notably a just-created admin session). Use the
  // compare-and-swap writer and, on conflict, skip — the migration simply runs
  // again on the next read.
  if (!state.agents || Object.keys(state.agents).length === 0) {
    if (env.AGENT_TOKEN) {
      state.agents['dsh'] = { hash: await sha256Base64(env.AGENT_TOKEN), tokenWrapped: await wrapWithKek(encoder.encode(env.AGENT_TOKEN), await kekBytes(env)), alias: '', note: '', allow: [], groups: [], write: false, account: defaultAgentAccount, createdAt: nowIso() }
    }
    await saveStateCas(env, state, stateVersion).catch(() => {})
  } else if (env.AGENT_TOKEN && state.agents.dsh && !state.agents.dsh.tokenWrapped) {
    const hash = await sha256Base64(env.AGENT_TOKEN)
    if (state.agents.dsh.hash === hash) {
      state.agents.dsh.tokenWrapped = await wrapWithKek(encoder.encode(env.AGENT_TOKEN), await kekBytes(env))
      await saveStateCas(env, state, stateVersion).catch(() => {})
    }
  }
  return state
}

async function saveState(env, state) {
  await stateStub(env).fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
}

// Compare-and-swap save: only writes when the stored version still matches what
// the caller read. Returns false when another writer won the race.
async function saveStateCas(env, state, expectedVersion) {
  const response = await stateStub(env).fetch('https://state/state/cas', { method: 'POST', body: JSON.stringify({ state, expectedVersion }) })
  return response.json()
}

// Apply declarative ops atomically inside the Durable Object's storage
// transaction, avoiding lost updates from concurrent read-modify-write cycles.
async function mutateState(env, ops) {
  const response = await stateStub(env).fetch('https://state/state/mutate', { method: 'POST', body: JSON.stringify({ ops }) })
  return response.json()
}

// Read-modify-write over the whole state, made safe against concurrent writers.
//
// The previous implementation did load -> mutate -> save with no concurrency
// control: two overlapping requests each read the same snapshot and the later
// write silently discarded the other's change. That is how an admin session
// record could vanish immediately after login, which made validCookie reject a
// freshly issued cookie and bounced users between /login and /oauth/authorize.
//
// The mutation runs against a snapshot and is retried while the stored version
// keeps moving underneath it.
const STATE_WRITE_ATTEMPTS = 12
async function loadStateVersioned(env) {
  const response = await stateStub(env).fetch('https://state/state/versioned')
  const payload = await response.json()
  return { state: payload.state ?? {}, version: Number(payload.version ?? 0) }
}

async function updateState(env, mutate) {
  for (let attempt = 0; attempt < STATE_WRITE_ATTEMPTS; attempt += 1) {
    const loaded = await loadStateVersioned(env)
    const state = loaded.state
    const result = await mutate(state)
    const saved = await saveStateCas(env, state, loaded.version)
    if (saved?.ok) return result
    // Lost the race: back off and re-apply the mutation to fresh state. The
    // delay grows exponentially with jitter, because twenty simultaneous
    // readers all retrying at the same tick just collide again. Eight flat
    // attempts of 5+10n ms were not enough under load; twelve spread over
    // roughly a second are.
    const backoff = Math.min(250, 10 * 2 ** attempt) * (0.6 + Math.random() * 0.8)
    await new Promise((resolve) => setTimeout(resolve, Math.round(backoff)))
  }
  // Exhausted retries. Fail loudly rather than silently dropping a write.
  throw new Error('state write conflict: too many concurrent updates')
}

async function addAudit(env, entry) {
  return updateState(env, (state) => {
    state.audit.unshift({ time: nowIso(), ...entry })
    state.audit = state.audit.slice(0, 500)
  })
}

// The OIDC providers. The old single configuration is exposed as the
// default provider, so an existing installation keeps working.
function oidcProviders(state) {
  const legacy = state?.settings?.oidc ?? {}
  const hasLegacy = Boolean(legacy.issuer && legacy.clientId)
  const list = Object.values(state?.settings?.oidcProviders ?? {}).filter(Boolean)
  // The legacy entry wins the id 'default': a stored provider of that name
  // would otherwise appear twice, with the same id but a different config.
  const ids = hasLegacy ? new Set(['default']) : new Set()
  const unique = list.filter((entry) => (ids.has(entry.id) ? false : (ids.add(entry.id), true)))
  // The legacy slot carries its own label now, so renaming it sticks.
  return hasLegacy ? [{ ...legacy, id: 'default', legacy: true, label: legacy.label || '默认' }, ...unique] : unique
}

// The provider a request refers to. Without a name the enabled one is used.
function pickOidcProvider(state, wanted) {
  const providers = oidcProviders(state)
  if (!providers.length) return null
  if (wanted) {
    const found = providers.find((entry) => entry.id === String(wanted))
    if (found) return found
  }
  return providers.find((entry) => entry.enabled !== false) ?? providers[0]
}

// The identity bound to ONE provider. A binding is per provider, so a second
// identity can be added without touching the first. Before the provider list
// existed the install kept a single global identity (profile.oidcIssuer /
// profile.oidcSub); that one belongs to the legacy 'default' provider only, and
// treating it as that provider's binding is what keeps an existing installation
// signed in instead of asking it to bind again. Any other provider — even one
// with the same issuer — must bind on its own.
function oidcBindingFor(state, provider) {
  if (!provider) return null
  const bound = state?.profile?.oidcBindings?.[provider.id]
  if (bound) return bound
  if (provider.id !== 'default') return null
  const legacySub = String(state?.profile?.oidcSub ?? '')
  const legacyIssuer = String(state?.profile?.oidcIssuer ?? '')
  if (!legacySub || legacyIssuer !== provider.issuer) return null
  return { providerId: provider.id, issuer: legacyIssuer, sub: legacySub, email: String(state?.profile?.oidcEmail ?? '') }
}

// Every provider with the identity bound to it, for the profile page. A legacy
// identity is reported as its own provider's binding, so the page never offers
// "bind" for an identity that already works.
function oidcBindingMap(state) {
  const map = {}
  for (const provider of oidcProviders(state)) {
    const binding = oidcBindingFor(state, provider)
    if (binding) map[provider.id] = binding
  }
  return map
}

async function oidcConfig(env, request, state, provider) {
  const stored = provider ?? state?.settings?.oidc ?? {}
  const issuer = String(stored.issuer || env.OIDC_ISSUER || '').replace(/\/$/, '')
  const clientId = String(stored.clientId || env.OIDC_CLIENT_ID || '')
  const clientSecret = String(stored.clientSecret || env.OIDC_CLIENT_SECRET || '')
  const redirectUri = String(stored.redirectUri || env.OIDC_REDIRECT_URI || (new URL(request.url).origin) + '/oidc/callback')
  if (!issuer || !clientId) return null
  return {
    id: String(stored.id ?? 'default'),
    label: String(stored.label ?? ''),
    issuer, clientId, clientSecret, redirectUri, scope: stored.scope || env.OIDC_SCOPE || 'openid profile email',
    authorizationEndpoint: String(stored.authorizationEndpoint || env.OIDC_AUTHORIZATION_ENDPOINT || ''),
    tokenEndpoint: String(stored.tokenEndpoint || env.OIDC_TOKEN_ENDPOINT || ''),
    userinfoEndpoint: String(stored.userinfoEndpoint || env.OIDC_USERINFO_ENDPOINT || ''),
    jwksUri: String(stored.jwksUri || env.OIDC_JWKS_URI || ''),
  }
}

async function oidcEndpoints(oidc) {
  const needsDiscovery = !oidc.authorizationEndpoint || !oidc.tokenEndpoint || !oidc.userinfoEndpoint || !oidc.jwksUri
  const discovered = needsDiscovery ? await oidcDiscovery(oidc.issuer) : {}
  return {
    authorization: oidc.authorizationEndpoint || discovered.authorization_endpoint,
    token: oidc.tokenEndpoint || discovered.token_endpoint,
    userinfo: oidc.userinfoEndpoint || discovered.userinfo_endpoint,
    jwks: oidc.jwksUri || discovered.jwks_uri,
  }
}

async function oidcDiscovery(issuer) {
  const response = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
  if (!response.ok) throw new Error('OIDC discovery failed')
  const document = await response.json()
  if (!document || typeof document.issuer !== 'string' || document.issuer.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) throw new Error('OIDC discovery issuer mismatch')
  return document
}

async function oidcStateCookie(env, state, verifier, next = '', nonce = '', provider = '') {
  const expires = Date.now() + 10 * 60 * 1000
  const payload = provider + '|' + state + '|' + verifier + '|' + nonce + '|' + next + '|' + expires
  const signature = await hmacToken(await cookieKey(env), payload)
  return encodeURIComponent(payload + '|' + signature)
}

// NOTE: OIDC state verification moved into the Durable Object endpoint
// /oidc/state/consume above, so check-and-mark is atomic. Do not reintroduce
// a Worker-side read-then-write check here.

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hashAdminPassword(password, saltText) {
  const hash = await pbkdf2(password, saltText, 50000, 32)
  return bytesToB64(hash)
}

async function verifyAdminPassword(env, state, password) {
  const security = state.security ?? {}
  if (security.passwordHash && security.passwordSalt) {
    return constantTimeEqual(encoder.encode(await hashAdminPassword(String(password), security.passwordSalt)), encoder.encode(security.passwordHash))
  }
  if (!env.ADMIN_PASSWORD) return false
  return constantTimeEqual(encoder.encode(String(password)), encoder.encode(env.ADMIN_PASSWORD))
}

function loginBlocked(state, ip) {
  const attempt = state.security?.loginAttempts?.[ip]
  return Boolean(attempt && attempt.count >= 8 && Date.now() - attempt.first < 15 * 60 * 1000)
}

async function recordLoginFailure(env, ip) {
  await updateState(env, (state) => {
    state.security ??= {}
    state.security.loginAttempts ??= {}
    const now = Date.now()
    // Same reason as the fill counters: this map is keyed by address and would
    // otherwise keep a row per IP that ever guessed a password.
    for (const [oldIp, oldAttempt] of Object.entries(state.security.loginAttempts)) {
      if (now - (oldAttempt?.last ?? 0) > 15 * 60 * 1000) delete state.security.loginAttempts[oldIp]
    }
    const previous = state.security.loginAttempts[ip]
    state.security.loginAttempts[ip] = { first: previous && now - previous.first < 15 * 60 * 1000 ? previous.first : now, count: (previous?.count ?? 0) + 1, last: now }
    return state
  })
}

async function clearLoginFailures(env, ip) {
  await updateState(env, (state) => { if (state.security?.loginAttempts?.[ip]) delete state.security.loginAttempts[ip]; return state })
}

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const out = []
  for (const char of String(text).replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char)
    if (index < 0) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

function base32Encode(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31]
  return out
}

async function totpCode(secret, time = Date.now()) {
  const key = base32Decode(secret)
  const counter = Math.floor(time / 30000)
  const buffer = new Uint8Array(8)
  let value = counter
  for (let i = 7; i >= 0; i--) { buffer[i] = value & 0xff; value = Math.floor(value / 256) }
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, buffer))
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff)
  return String(binary % 1000000).padStart(6, '0')
}

async function verifyTotp(secret, code) {
  const normalized = String(code ?? '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  for (const drift of [-1, 0, 1]) {
    if (await totpCode(secret, Date.now() + drift * 30000) === normalized) return true
  }
  return false
}

async function totpSecret(env, state) {
  if (!state.security?.totpSecretWrapped) return ''
  return new TextDecoder().decode(await unwrapWithKek(state.security.totpSecretWrapped, await kekBytes(env)))
}

// The one place a browser session may hand out plaintext. Reading a stored
// password and dumping the whole vault in one file are the same risk, so they
// share a gate: a cookie proves who is asking, a code proves the account holder
// is present. Throttled through the login counters, so guessing is not free.
// Returns a Response when refused, or null when the caller may continue. The
// code is passed in because the caller has already parsed the body; reading the
// request twice locks the stream and turns a refusal into a 500.
async function secondFactorWall(request, env, event, code) {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown'
  const state = await loadState(env)
  if (loginBlocked(state, ip)) return fail('尝试次数过多，请 15 分钟后再试', 429)
  if (state.security?.totpEnabled !== true) return fail('totp not configured', 428)
  if (!(await verifyTotp(await totpSecret(env, state), code))) {
    await recordLoginFailure(env, ip)
    await addAudit(env, { event: event + '-deny', reason: 'bad-totp', via: 'web' })
    return fail('验证码错误', 401)
  }
  await clearLoginFailures(env, ip)
  return null
}

async function getSession(env) {
  const response = await stateStub(env).fetch('https://state/session')
  const payload = await response.json()
  if (!payload.session) return null
  try {
    const plain = await unwrapWithKek(payload.session.wrapped, await kekBytes(env))
    const session = JSON.parse(new TextDecoder().decode(plain))
    if (session.expiresAt && session.expiresAt < Date.now()) return null
    return session
  } catch { return null }
}

async function putSession(env, session) {
  const plain = encoder.encode(JSON.stringify(session))
  const wrapped = await wrapWithKek(plain, await kekBytes(env))
  await stateStub(env).fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: session.expiresAt ?? 0 }) })
}

async function adminAuthorized(request, env) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin')
    if (origin) {
      try {
        // Compare origins exactly. A page loaded from a different host than the
        // one it posts to (an alias domain, a reverse proxy, a preview URL) used
        // to fail here with a bare "unauthorized", which is indistinguishable
        // from an expired cookie. Name the actual reason instead.
        if (new URL(origin).origin !== new URL(request.url).origin) {
          await addAudit(env, { event: 'admin.origin-mismatch', origin: String(origin).slice(0, 120), expected: new URL(request.url).origin }).catch(() => {})
          return false
        }
      } catch { return false }
    }
  }
  const ok = await validCookie(request, env)
  // Refresh the operator's estimated location on each authenticated admin
  // request so the globe knows where "me" is. Best-effort only.
  if (ok) await recordOperatorLocation(env, request).catch(() => {})
  return ok
}

function pluginAuthorized(request, env) {
  const token = String(env.DSH_PLUGIN_TOKEN ?? '')
  if (!token) return false
  const provided = request.headers.get('x-broker-plugin-token') ?? ''
  return constantTimeEqual(encoder.encode(provided), encoder.encode(token))
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function resolveAgent(request, env) {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const token = match[1]
  const state = await loadState(env)
  const hash = await sha256Base64(token)
  for (const [name, agent] of Object.entries(state.agents)) {
    if (!constantTimeEqual(encoder.encode(agent.hash), encoder.encode(hash))) {
      // During a rotation's grace window the previous token still authenticates,
      // so a running MCP client is not cut off by a routine key change.
      const previous = agent.previous
      if (!previous || typeof previous.until !== 'number' || previous.until < Date.now()) continue
      if (!constantTimeEqual(encoder.encode(previous.hash), encoder.encode(hash))) continue
    }
    // Static agents may carry an authorization window (set via
    // /api/agents/extend). expiresAt null/undefined = permanent.
    if (typeof agent.expiresAt === 'number' && agent.expiresAt < Date.now()) return null
    return { name, agent, state }
  }
  for (const tokenEntry of Object.values(state.oauthTokens ?? {})) {
    if (tokenEntry.expiresAt && tokenEntry.expiresAt < Date.now()) continue
    if (constantTimeEqual(encoder.encode(tokenEntry.hash ?? ''), encoder.encode(hash))) {
      const profile = state.oauthAgentProfiles?.[tokenEntry.agent] ?? {}
      return { name: tokenEntry.agent, agent: { allow: profile.allow ?? [], groups: profile.groups ?? [], allowAll: profile.allowAll === true, write: profile.write === true, tools: Array.isArray(profile.tools) ? profile.tools : null, oauth: true, account: tokenEntry.account ?? '', alias: profile.alias ?? '', note: profile.note ?? '' }, state }
    }
  }
  return null
}

function grantKey(agent, name) { return `${agent}\u0000${name}` }

// Telegram has no vault session, so it can only resolve a name through the
// itemIds cache that unlocking fills. Accept the id itself too, and say plainly
// when the cache is cold instead of claiming the secret does not exist.
function telegramItemId(state, item) {
  const id = state?.itemIds?.[item]
  if (id) return id
  for (const candidate of Object.values(state?.itemIds ?? {})) {
    if (candidate === item) return candidate
  }
  return ''
}

function activeGrant(state, agent, name) {
  const grant = state.grants[grantKey(agent, name)]
  if (!grant || grant.revokedAt || grant.migratedToCapability) return null
  if (grant.expiresAt && grant.expiresAt < Date.now()) return null
  if (grant.maxReads != null && (grant.reads ?? 0) >= grant.maxReads) return null
  return grant
}

// Strict binding: a pending entry only matches when agent + name + action all
// agree. Legacy entries without an action are NOT reusable for a new request —
// approving them could silently mint the wrong action's capability.
function findPending(state, agent, name, action) {
  return Object.entries(state.pending).find(([, entry]) => entry.agent === agent && entry.name === name && entry.action === action)?.[0] ?? null
}

// Restore is revoke's inverse, and it has to undo the same two things: the
// grant row AND the capability minted from it. Un-revoking only the row left the
// capability revoked, so the console said 生效中 while the agent still got
// "capability revoked" — the restore looked like text and nothing else.
function restoreGrantState(state, { agent, name, seconds, now = nowIso() }) {
  const grant = state.grants?.[grantKey(agent, name)]
  if (!grant) return false
  const expiresAt = seconds > 0 ? Date.now() + seconds * 1000 : 0
  grant.revokedAt = null
  grant.reads = 0
  grant.expiresAt = expiresAt
  const account = String(grant.account ?? '').toLowerCase()
  for (const cap of Object.values(state.capabilities ?? {})) {
    if (!cap || cap.subjectId !== agent || cap.itemName !== name) continue
    // Only the read capability belongs to a read grant. A fill or use
    // capability was approved on its own and must not come back with it.
    if (cap.action !== 'secret.read') continue
    // Leave revocations that were not ours alone (Telegram, agent delete, a
    // narrower admin revoke); restoring one of those would undo a decision the
    // operator made elsewhere.
    if (cap.revokedBy && cap.revokedBy !== 'admin:grant-revoke') continue
    if (account && String(cap.accountId ?? '').toLowerCase() !== account) continue
    cap.revokedAt = null
    cap.revokedBy = null
    cap.usedCount = 0
    cap.expiresAt = expiresAt
    cap.restoredAt = now
  }
  grant.restoredAt = now
  return true
}

async function vaultEmail(env, db, state) {
  if (state?.settings?.vaultEmail) return state.settings.vaultEmail
  if (env.VAULT_EMAIL) return env.VAULT_EMAIL
  const row = await db.prepare('SELECT email FROM users ORDER BY created_at LIMIT 1').first()
  return row?.email ?? ''
}

async function bootstrap(env, db) {
  const state = await loadState(env)
  const email = await vaultEmail(env, db, state)
  const user = await db.prepare('SELECT id, email, key, kdf_type, kdf_iterations FROM users WHERE lower(email) = lower(?)').bind(email).first()
  if (!user) throw new Error('vault user not found')
  return { email: user.email, kdfType: Number(user.kdf_type) || 0, kdfIterations: Number(user.kdf_iterations) || 600000, profileKey: user.key }
}

function cipherUrl(data) {
  if (!data || typeof data !== 'object') return ''
  const fromLogin = Array.isArray(data.login?.uris) ? data.login.uris.map((entry) => entry?.uri).find(Boolean) : ''
  return fromLogin || data.url || data.uri || ''
}

async function vaultUser(env, db, session) {
  const user = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(session.email).first()
  if (!user) throw new Error('vault user not found')
  return user
}

// The item names that actually exist in the currently unlocked vault. Used to
// bound the AI snapshot: state.itemIds is an append-only cache that keeps names
// from accounts you have since switched away from, so an unfiltered snapshot
// reports another vault's items and looks like a privilege leak. An empty set
// (vault locked) means "no item list", never "everything".
// A grant is bound to a cipher id. If that id belongs to a vault other than the
// one unlocked now, the grant cannot be used for this account — but it is not
// harmless: it goes live again the next time that other account is unlocked,
// and until then it sits in the Agent dialog looking like an authorisation the
// operator made for this vault. Drop the ones this account cannot own.
async function pruneForeignGrants(env, session) {
  if (!session?.email) return 0
  let ids
  try {
    const user = await vaultUser(env, env.NODEWARDEN_DB, session)
    const rows = await env.NODEWARDEN_DB.prepare('SELECT id FROM ciphers WHERE user_id = ?').bind(user.id).all()
    ids = new Set((rows.results ?? []).map((row) => row.id))
  } catch { return 0 }
  const state = await loadState(env)
  const account = String(session.email).toLowerCase()
  const isForeign = (entry) => Boolean(entry && entry.itemId && !ids.has(entry.itemId))
  const ownsAccount = (entry) => String(entry?.accountId ?? '').toLowerCase() === account ||
    String(entry?.createdBy ?? '').toLowerCase().endsWith(':' + account)
  const victims = (next) => {
    const out = []
    for (const [key, cap] of Object.entries(next.capabilities ?? {})) if (isForeign(cap) && ownsAccount(cap)) out.push(['capabilities', key, cap.itemName || cap.itemId])
    for (const [itemId, policy] of Object.entries(next.plaintextReadPolicies ?? {})) {
      if (!ids.has(itemId) && String(policy?.accountId ?? '').toLowerCase() === account) out.push(['plaintextReadPolicies', itemId, itemId])
    }
    for (const [key, grant] of Object.entries(next.actionGrants ?? {})) if (isForeign(grant) && ownsAccount(grant)) out.push(['actionGrants', key, grant.itemName || grant.itemId])
    return out
  }
  const found = victims(state)
  if (!found.length) return 0
  await updateState(env, (next) => {
    for (const [bucket, key] of victims(next)) delete next[bucket][key]
    return next
  })
  const names = found.map((row) => row[2])
  await addAudit(env, { event: 'grant.prune-foreign', account: session.email, count: names.length, items: names.slice(0, 20) })
  return names.length
}

async function vaultItemNames(env, db) {
  const session = await getSession(env)
  if (!session) return new Set()
  try {
    const items = await listCiphers(env, db, session)
    return new Set(items.map((item) => item.name))
  } catch { return new Set() }
}

// A return target may only be a same-site absolute path. `new URL(next, base)`
// happily turns //evil.com or https://evil.com into an off-site redirect, which
// turns a successful login into a phishing landing page.
function safeNext(value, fallback = '/') {
  const text = String(value ?? '')
  if (!text.startsWith('/') || text.startsWith('//') || text.startsWith('/\\')) return fallback
  return text
}

async function listCiphers(env, db, session) {
  const v2 = await vault2Context(env)
  if (v2?.dek) {
    const items = await listVault2Items(env, session, v2.dek)
    return items ?? []
  }
  const user = await vaultUser(env, db, session)
  const result = await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key, created_at, updated_at FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC').bind(user.id).all()
  const state = await loadState(env)
  const folderName = state.settings?.vaultFolder ?? ''
  let folderId = null
  if (folderName) folderId = (await listFolders(env, db, session)).find((entry) => entry.name === folderName)?.id ?? null
  if (folderName && !folderId) return []
  const items = []
  for (const row of result.results ?? []) {
    if (folderId && row.folder_id !== folderId) continue
    try {
      const decrypted = await decryptCipherRow(row, session)
      const name = decrypted.name || '(未命名)'
      items.push({
        id: row.id, type: decrypted.type, name, url: cipherUrl(decrypted.data), folderId: row.folder_id ?? null,
        createdAt: row.created_at ?? '', creator: session.email,
        username: extractUsername(decrypted),
        // The TOTP seed is not listed. It is the very factor that guards the
        // plaintext read, so handing it to whoever holds the cookie defeats
        // that gate. The editor treats the field as "leave blank to keep".
        group: state.itemGroups?.[name] ?? '',
 expiresAt: state.secretExpiry?.[name]?.expiresAt ?? 0,
        noApproval: state.policies[name]?.noApproval === true,
      })
    } catch {}
  }
  return items
}

// NodeWarden's ciphers table is the old home. Once Vault 2.0 has live rows it is
// the stale copy, so every item read and write goes to v2 instead. The old table
// stays readable while v2 is locked (a rekey or a DO eviction must not blank the
// console), but it is never written again after the switch.
async function vault2Context(env) {
  const status = await vault2Status(env).catch(() => null)
  if (!status?.initialized) return null
  // Once a row has ever been written through v2, deleting the last one must not
  // put the old table back in charge: that would silently resume stale writes.
  if (!status.items) {
    const cutover = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'source'").first().catch(() => null)
    if (cutover?.value !== 'v2') return null
  }
  const cached = await (await stateStub(env).fetch('https://state/v2-key')).json().catch(() => ({}))
  return { status, dek: cached.ok ? Uint8Array.from(cached.dek) : null }
}

async function vault2WriteKey(env) {
  const context = await vault2Context(env)
  if (!context) return null
  if (context.dek) return context.dek
  const error = new Error('vault is locked')
  error.status = 423
  throw error
}

function vault2Payload(row) {
  const payload = row?.payload || {}
  return {
    name: String(payload.name || row?.id || ''),
    username: String(payload.username || ''),
    password: String(payload.password ?? payload.secret ?? ''),
    totp: String(payload.totp || ''),
    url: String(payload.url || ''),
    notes: String(payload.notes || ''),
  }
}

// Give v2 rows the shape the rest of this file already understands, so MCP,
// console and fill all read one model instead of each growing a v2 branch.
function vault2Decrypted(row) {
  const payload = vault2Payload(row)
  return {
    id: row.id,
    type: row.kind === 'web' ? 1 : 2,
    name: payload.name,
    notes: payload.notes,
    data: { login: { username: payload.username, password: payload.password, totp: payload.totp, uris: payload.url ? [{ uri: payload.url }] : [] } },
    dataText: '',
  }
}

async function vault2FindItem(env, dek, name, { itemId } = {}) {
  let rows = []
  if (itemId) {
    const row = await vault2Read(env, dek, itemId).catch(() => null)
    if (row) rows = [row]
  } else {
    const listed = await vault2ListPlain(env, dek, 0)
    rows = listed.items.filter((row) => !row.deletedAt && vault2Payload(row).name === name)
  }
  if (!itemId) {
    if (rows.length > 1) {
      const error = new Error('ambiguous item name: ' + name + ' (' + rows.map((row) => row.id).join(', ') + ')')
      error.code = 'ambiguous_item_name'
      error.ids = rows.map((row) => row.id)
      throw error
    }
    rows = rows.slice(0, 1)
  }
  const row = rows[0]
  if (!row) return null
  const values = vault2Payload(row)
  if (values.name !== name) return null
  // Keep the stored object intact for writes: an update must not drop payload
  // fields this console does not know about.
  return { row: { ...row, source: 'v2', payload: row.payload || {} }, fields: values, decrypted: vault2Decrypted(row) }
  return result
}

async function listVault2Items(env, session, dek) {
  const listed = await vault2ListPlain(env, dek, 0)
  const live = listed.items.filter((row) => !row.deletedAt)
  if (!live.length) return null
  const state = await loadState(env)
  return live.map((row) => {
    const payload = vault2Payload(row)
    const name = payload.name || row.id
    const kind = state.credentialKinds?.[row.id]
    return {
      id: row.id,
      type: kind === 'web' || (!kind && row.kind === 'web') ? 1 : 2,
      name,
      url: payload.url,
      folderId: null,
      createdAt: row.updatedAt ?? '',
      creator: session.email,
      username: payload.username,
      group: state.itemGroups?.[name] ?? '',
      expiresAt: state.secretExpiry?.[name]?.expiresAt ?? 0,
      noApproval: state.policies?.[name]?.noApproval === true,
      revision: row.revision,
      source: 'v2',
      // Decryption can fail on a row still sealed under the previous key after a
      // rekey; show it as unreadable instead of pretending it is not there.
      broken: !row.payload,
    }
  })
}

async function readSecretFromRows(env, db, session, name, { itemId } = {}) {
  const v2 = await vault2Context(env)
  if (v2?.dek) {
    let found = null
    try {
      found = await vault2FindItem(env, v2.dek, name, { itemId })
    } catch (error) {
      if (error.code !== 'ambiguous_item_name') throw error
      await addAudit(env, { event: 'secret.read-ambiguous', name, count: error.ids?.length ?? 0, reason: 'duplicate item name; rename one of them' })
      return null
    }
    if (!found) return null
    const payload = found.fields
    return {
      value: payload.password,
      username: payload.username,
      totp: payload.totp,
      type: found.decrypted.type,
      url: payload.url,
      id: found.row.id,
    }
  }
  const user = await vaultUser(env, db, session)
  const state = await loadState(env)
  let folderId = null
  if (state.settings?.vaultFolder) folderId = (await listFolders(env, db, session)).find((entry) => entry.name === state.settings.vaultFolder)?.id ?? null
  if (state.settings?.vaultFolder && !folderId) return null
  // The id is unique, the name is not: Bitwarden lets two folders hold the same
  // name, so a name-only lookup is a guess. With an id, read one row.
  const rows = itemId
    ? await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(itemId, user.id).all()
    : await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(user.id).all()
  const matches = []
  for (const candidate of rows.results ?? []) {
    if (folderId && candidate.folder_id !== folderId) continue
    const decrypted = await decryptCipherRow(candidate, session)
    if (decrypted.name !== name) continue
    matches.push({ value: extractSecret(decrypted), username: extractUsername(decrypted), totp: extractTotp(decrypted), type: decrypted.type, url: cipherUrl(decrypted.data), id: candidate.id })
  }
  // Two items with one name: reading "the first" would hand out whichever row
  // D1 returned first. Refuse and say why.
  if (matches.length > 1) {
    await addAudit(env, { event: 'secret.read-ambiguous', name, count: matches.length, reason: 'duplicate item name; rename one of them' })
    return null
  }
  return matches[0] ?? null
}

async function findCipherRow(env, db, session, name, { itemId } = {}) {
  const v2 = await vault2Context(env)
  if (v2?.dek) return vault2FindItem(env, v2.dek, name, { itemId })
  const user = await vaultUser(env, db, session)
  const state = await loadState(env)
  let folderId = null
  if (state.settings?.vaultFolder) folderId = (await listFolders(env, db, session)).find((entry) => entry.name === state.settings.vaultFolder)?.id ?? null
  if (state.settings?.vaultFolder && !folderId) return null
  const rows = itemId
    ? await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(itemId, user.id).all()
    : await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(user.id).all()
  const matches = []
  for (const candidate of rows.results ?? []) {
    if (folderId && candidate.folder_id !== folderId) continue
    const decrypted = await decryptCipherRow(candidate, session)
    if (decrypted.name === name) matches.push({ row: candidate, decrypted })
  }
  // Editing or deleting "the first match" is how the other same-named item gets
  // silently overwritten. Refuse instead, and name the ids involved.
  if (matches.length > 1) {
    const error = new Error('ambiguous item name: ' + name + ' (' + matches.map((entry) => entry.row.id).join(', ') + ')')
    error.code = 'ambiguous_item_name'
    error.ids = matches.map((entry) => entry.row.id)
    throw error
  }
  return matches[0] ?? null
}

async function queueTransfer(env, db, sourceSession, agentName, agent, name, folder, options = {}) {
  const found = await findCipherRow(env, db, sourceSession, name)
  if (!found) throw new Error('source item not found')
  const payload = { name, value: extractSecret(found.decrypted), url: cipherUrl(found.decrypted.data), notes: found.decrypted.notes }
  const wrapped = await wrapWithKek(encoder.encode(JSON.stringify(payload)), await kekBytes(env))
  const targetAccount = String(agent.account ?? '')
  if (!targetAccount) throw new Error('agent has no bound account')
  const transfer = { id: crypto.randomUUID(), agent: agentName, name, sourceAccount: sourceSession.email, targetAccount, folder: String(folder ?? ''), seconds: Number(options.seconds) || 0, maxReads: options.maxReads ?? null, payloadWrapped: wrapped, createdAt: nowIso() }
  await updateState(env, (state) => { state.transfers ??= []; state.transfers.push(transfer); return state })
  await addAudit(env, { event: 'transfer.queue', agent: agentName, name, sourceAccount: sourceSession.email, targetAccount })
  return transfer
}

async function processTransfers(env, session) {
  if (!session?.email) return []
  const state = await loadState(env)
  const completed = []
  for (const transfer of [...(state.transfers ?? [])]) {
    if (String(transfer.targetAccount).toLowerCase() !== String(session.email).toLowerCase()) continue
    try {
      const payload = JSON.parse(new TextDecoder().decode(await unwrapWithKek(transfer.payloadWrapped, await kekBytes(env))))
      await createCipher(env, env.NODEWARDEN_DB, session, { name: transfer.name, value: payload.value, url: payload.url, notes: payload.notes, group: '' }, transfer.folder)
      await updateState(env, (next) => {
        next.transfers = (next.transfers ?? []).filter((entry) => entry.id !== transfer.id)
        const key = grantKey(transfer.agent, transfer.name)
        next.grants[key] = { agent: transfer.agent, name: transfer.name, mode: 'transfer', createdAt: nowIso(), expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, noApproval: true, account: transfer.targetAccount }
        return next
      })
      await addAudit(env, { event: 'transfer.complete', agent: transfer.agent, name: transfer.name, sourceAccount: transfer.sourceAccount, targetAccount: transfer.targetAccount })
      completed.push(transfer.name)
    } catch (error) {
      await updateState(env, (next) => {
        const current = (next.transfers ?? []).find((entry) => entry.id === transfer.id)
        if (current) current.error = String(error.message ?? error)
        return next
      })
    }
  }
  return completed
}

function forgetItemState(state, name) {
  delete state.policies?.[name]
  delete state.itemGroups?.[name]
  for (const key of Object.keys(state.grants ?? {})) if (state.grants[key].name === name) delete state.grants[key]
  for (const [id, entry] of Object.entries(state.pending ?? {})) if (entry.name === name) delete state.pending[id]
  // A deleted credential must not leave a classification or a fill policy
  // behind: the id is gone from the vault, so anything keyed by it is dead
  // weight, and a recreated item with the same name must start unclassified.
  const gone = Object.keys(state.itemIds ?? {}).filter((key) => key === name).map((key) => state.itemIds[key])
  for (const id of gone) {
    delete state.credentialKinds?.[id]
    delete state.fillPolicies?.[id]
    delete state.plaintextReadPolicies?.[id]
    delete state.usePolicies?.[id]
  }
  delete state.itemIds?.[name]
  return state
}

async function updateVault2Item(env, dek, currentName, changes) {
  const found = await vault2FindItem(env, dek, currentName, { itemId: changes.itemId })
  if (!found) return null
  const nextName = typeof changes.newName === 'string' && changes.newName.trim() ? changes.newName.trim() : currentName
  const payload = { ...found.row.payload }
  // Blank means "keep" for the secret and the TOTP seed, exactly like the old
  // editor: a field the UI never received must not wipe what is stored.
  if (typeof changes.notes === 'string') payload.notes = changes.notes
  if (typeof changes.value === 'string' && changes.value.length > 0) { payload.password = changes.value; delete payload.secret }
  if (typeof changes.username === 'string') payload.username = changes.username
  if (typeof changes.totp === 'string' && changes.totp.length > 0) payload.totp = changes.totp
  if (typeof changes.url === 'string') payload.url = changes.url
  payload.name = nextName
  const kind = changes.kind === 'web' ? 'web' : changes.kind === 'api' ? 'api' : found.row.kind
  await vault2Update(env, dek, found.row.id, { kind, payload })
  await updateState(env, (state) => {
    state.itemGroups ??= {}
    if (nextName !== currentName) {
      if (state.itemGroups[currentName] !== undefined) state.itemGroups[nextName] = state.itemGroups[currentName]
      delete state.itemGroups[currentName]
      if (state.policies?.[currentName]) { state.policies[nextName] = state.policies[currentName]; delete state.policies[currentName] }
    }
    if (typeof changes.group === 'string') {
      if (changes.group.trim()) state.itemGroups[nextName] = changes.group.trim()
      else delete state.itemGroups[nextName]
    }
    return state
  })
  await addAudit(env, { event: 'item.update', name: nextName, oldName: currentName === nextName ? undefined : currentName })
  return nextName
}

async function deleteVault2Item(env, dek, name, { itemId } = {}) {
  const found = await vault2FindItem(env, dek, name, { itemId })
  if (!found) return false
  await vault2Delete(env, found.row.id)
  await updateState(env, (state) => forgetItemState(state, name))
  await addAudit(env, { event: 'item.delete', name })
  return true
}

async function createVault2Item(env, dek, fields) {
  const name = String(fields.name ?? '').trim()
  if (!name) throw new Error('name required')
  if (await vault2FindItem(env, dek, name)) throw new Error('item already exists')
  const id = crypto.randomUUID()
  const kind = fields.kind === 'web' ? 'web' : 'api'
  const payload = {
    name,
    username: String(fields.username ?? ''),
    password: String(fields.value ?? fields.password ?? ''),
    totp: String(fields.totp ?? ''),
    url: String(fields.url ?? ''),
    notes: String(fields.notes ?? ''),
  }
  await vault2Create(env, dek, { id, kind, payload })
  await updateState(env, (next) => {
    next.itemGroups ??= {}
    if (fields.group && String(fields.group).trim()) next.itemGroups[name] = String(fields.group).trim()
    // The new cipher's id is known here, so record it before anything can
    // share the item. A share that cannot find an id writes an unbound grant.
    next.itemIds ??= {}
    next.itemIds[name] = id
    next.policies ??= {}
    // NOTE: /agent/items/save passes an explicit field allowlist without
    // noApproval, so Agents cannot self-grant it. Admin create flows here
    // keep their previous behavior (noApproval honored when provided).
    if (fields.noApproval === true) next.policies[name] = { noApproval: true }
    return next
  })
  await addAudit(env, { event: 'item.create', name })
  return { name, id }
}

async function updateCipher(env, db, session, currentName, changes) {
  const dek = await vault2WriteKey(env)
  if (dek) return updateVault2Item(env, dek, currentName, changes)
  const found = await findCipherRow(env, db, session, currentName, { itemId: changes.itemId })
  if (!found) return null
  const { row } = found
  const keys = await cipherKeys(row, session)
  let data = null
  try { data = JSON.parse(row.data) } catch {}
  const nextName = typeof changes.newName === 'string' && changes.newName.trim() ? changes.newName.trim() : currentName
  const nextNameEnc = nextName !== currentName ? await encryptStr(nextName, keys.itemEnc, keys.itemMac) : row.name
  let nextNotes = row.notes
  if (typeof changes.notes === 'string') nextNotes = changes.notes ? await encryptStr(changes.notes, keys.itemEnc, keys.itemMac) : ''
  if (typeof changes.value === 'string' && changes.value.length > 0) {
    if (!data || typeof data !== 'object') data = {}
    data.login = data.login && typeof data.login === 'object' ? data.login : {}
    data.login.password = await encryptStr(changes.value, keys.itemEnc, keys.itemMac)
  }
  if (typeof changes.username === 'string') {
    if (!data || typeof data !== 'object') data = {}
    data.login = data.login && typeof data.login === 'object' ? data.login : {}
    data.login.username = changes.username ? await encryptStr(changes.username, keys.itemEnc, keys.itemMac) : ''
  }
  // Blank means "keep", like the value field: the editor no longer receives the
  // stored seed (the list hides it), so a blank field must not wipe it.
  if (typeof changes.totp === 'string' && changes.totp.length > 0) {
    if (!data || typeof data !== 'object') data = {}
    data.login = data.login && typeof data.login === 'object' ? data.login : {}
    data.login.totp = await encryptStr(changes.totp, keys.itemEnc, keys.itemMac)
  }
  if (typeof changes.url === 'string') {
    if (!data || typeof data !== 'object') data = {}
    data.login = data.login && typeof data.login === 'object' ? data.login : {}
    const uris = Array.isArray(data.login.uris) ? data.login.uris : []
    const encryptedUrl = changes.url ? await encryptStr(changes.url, keys.itemEnc, keys.itemMac) : ''
    if (uris.length > 0) uris[0] = { ...uris[0], uri: encryptedUrl }
    else if (encryptedUrl) uris.push({ uri: encryptedUrl })
    data.login.uris = uris
  }
  await db.prepare('UPDATE ciphers SET name = ?, notes = ?, data = ?, updated_at = ? WHERE id = ?').bind(nextNameEnc, nextNotes, data ? JSON.stringify(data) : row.data, nowIso(), row.id).run()
  await updateState(env, (state) => {
    state.itemGroups ??= {}
    if (nextName !== currentName) {
      if (state.itemGroups[currentName] !== undefined) state.itemGroups[nextName] = state.itemGroups[currentName]
      delete state.itemGroups[currentName]
      if (state.policies?.[currentName]) { state.policies[nextName] = state.policies[currentName]; delete state.policies[currentName] }
    }
    if (typeof changes.group === 'string') {
      if (changes.group.trim()) state.itemGroups[nextName] = changes.group.trim()
      else delete state.itemGroups[nextName]
    }
    return state
  })
  await addAudit(env, { event: 'item.update', name: nextName, oldName: currentName === nextName ? undefined : currentName })
  return nextName
}

async function deleteCipher(env, db, session, name, { itemId } = {}) {
  const dek = await vault2WriteKey(env)
  if (dek) return deleteVault2Item(env, dek, name, { itemId })
  const found = await findCipherRow(env, db, session, name, { itemId })
  if (!found) return false
  await db.prepare('UPDATE ciphers SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(nowIso(), nowIso(), found.row.id).run()
  await updateState(env, (state) => forgetItemState(state, name))
  await addAudit(env, { event: 'item.delete', name })
  return true
}

async function listFolders(env, db, session) {
  const user = await vaultUser(env, db, session)
  const rows = await db.prepare('SELECT id, name FROM folders WHERE user_id = ? ORDER BY name').bind(user.id).all()
  const out = []
  for (const row of rows.results ?? []) {
    try { out.push({ id: row.id, name: await decryptStr(row.name, b64ToBytes(session.symEncKey), b64ToBytes(session.symMacKey)) }) } catch {}
  }
  return out
}

async function createCipher(env, db, session, fields, folderNameOverride) {
  const name = String(fields.name ?? '').trim()
  if (!name) throw new Error('name required')
  const dek = await vault2WriteKey(env)
  if (dek) return createVault2Item(env, dek, { ...fields, name })
  if (await findCipherRow(env, db, session, name)) throw new Error('item already exists')
  const user = await vaultUser(env, db, session)
  const state = await loadState(env)
  const folderName = folderNameOverride !== undefined ? folderNameOverride : (state.settings?.vaultFolder ?? '')
  let folderId = null
  if (folderName) {
    const folder = (await listFolders(env, db, session)).find((entry) => entry.name === folderName)
    folderId = folder?.id ?? null
  }
  if (folderName && !folderId) throw new Error('target folder not found: ' + folderName)
  const enc = b64ToBytes(session.symEncKey)
  const mac = b64ToBytes(session.symMacKey)
  const data = { login: { username: fields.username ? await encryptStr(String(fields.username), enc, mac) : '', password: fields.value ? await encryptStr(String(fields.value), enc, mac) : '', totp: fields.totp ? await encryptStr(String(fields.totp), enc, mac) : '', uris: [] }, fields: [] }
  if (fields.url) data.login.uris.push({ uri: await encryptStr(String(fields.url), enc, mac) })
  const id = crypto.randomUUID()
  const time = nowIso()
  await db.prepare('INSERT INTO ciphers (id,user_id,type,folder_id,name,notes,favorite,data,reprompt,key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(
    id, user.id, 1, folderId, await encryptStr(name, enc, mac), fields.notes ? await encryptStr(String(fields.notes), enc, mac) : '', 0, JSON.stringify(data), 0, null, time, time,
  ).run()
  await updateState(env, (next) => {
    next.itemGroups ??= {}
    if (fields.group && String(fields.group).trim()) next.itemGroups[name] = String(fields.group).trim()
    // The new cipher's id is known here, so record it before anything can
    // share the item. A share that cannot find an id writes an unbound grant.
    next.itemIds ??= {}
    next.itemIds[name] = id
    next.policies ??= {}
    // NOTE: /agent/items/save passes an explicit field allowlist without
    // noApproval, so Agents cannot self-grant it. Admin create flows here
    // keep their previous behavior (noApproval honored when provided).
    if (fields.noApproval === true) next.policies[name] = { noApproval: true }
    return next
  })
  await addAudit(env, { event: 'item.create', name })
  return { name, id }
}

// Answering a credential request has to leave the agent able to read what it
// just asked for: a legacy grant alone is refused by the capability model, and a
// non-['*'] allowlist would still hide the new name. One helper so the console
// and the plugin cannot drift apart.
async function saveCredentialRequest(env, session, item, body, via) {
  const name = String(body.name ?? item.name).trim()
  if (!name || !body.value) return { error: 'name and value required', status: 400 }
  const created = await createCipher(env, env.NODEWARDEN_DB, session, { name, username: String(body.username ?? ''), value: String(body.value), url: '', notes: item.description ?? '', group: String(body.group ?? '') }, (await loadState(env)).settings?.vaultFolder ?? '')
  await updateState(env, (next) => {
    delete next.credentialRequests[String(body.id)]
    next.grants[grantKey(item.agent, name)] = { agent: item.agent, name, itemId: created.id, mode: 'credential-request', createdAt: nowIso(), expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: session.email }
    const key = capabilityKey(item.agent, created.id, 'secret.read')
    next.capabilities ??= {}
    next.capabilities[key] = {
      id: key, subjectId: item.agent, accountId: String(session.email ?? ''), itemId: created.id, itemName: name,
      action: 'secret.read', mode: 'preapproved', createdAt: nowIso(), createdBy: 'admin:' + (via || 'connect-page'),
      expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1,
    }
    if (next.agents?.[item.agent]) {
      const agent = next.agents[item.agent]
      agent.allow = Array.isArray(agent.allow) ? agent.allow : ['*']
      if (!agent.allow.includes('*') && !agent.allow.includes(name)) agent.allow.push(name)
    }
    next.itemGroups ??= {}
    if (String(body.group ?? '').trim()) next.itemGroups[name] = String(body.group).trim()
    return next
  })
  await addAudit(env, { event: 'credential.connect', agent: item.agent, name, itemId: created.id, via: via || 'connect-page' })
  return { name, itemId: created.id }
}

// A sync device is another broker instance, not an agent. The local broker
// authenticates to this one and asks for the encrypted rows; the token belongs
// to that installation, is revoked on its own, and never appears in the Agents
// list, because the only thing it can do is pull ciphertext. Keeping it out of
// `state.agents` is the point: an agent token is a thing whose scope you curate
// item by item, and it must not double as a full-vault reader.
function syncDeviceList(state) {
  return Object.values(state.syncDevices ?? {})
    .map((device) => ({
      id: device.id,
      name: device.name,
      createdAt: device.createdAt ?? '',
      lastUsedAt: device.lastUsedAt ?? null,
      revokedAt: device.revokedAt ?? null,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

async function vaultCipherRows(env, account) {
  // ciphers.user_id is the vault user id, not the email: resolve it the same way
  // every other read path does, or a comparison would silently find nothing.
  const owner = await env.NODEWARDEN_DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(account).first().catch(() => null)
  if (!owner) return null
  const rows = await env.NODEWARDEN_DB.prepare(
    'SELECT id, type, folder_id, name, notes, data, key, created_at, updated_at, deleted_at, archived_at FROM ciphers WHERE user_id = ?',
  ).bind(owner.id).all()
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    folderId: row.folder_id ?? null,
    name: row.name,
    notes: row.notes ?? null,
    data: row.data,
    key: row.key ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    deletedAt: row.deleted_at ?? null,
    archivedAt: row.archived_at ?? null,
  }))
}

async function resolveSyncDevice(request, env, state) {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(new RegExp('^Bearer\\s+(.+)$', 'i'))
  if (!match) return null
  const hash = await sha256Base64(match[1])
  for (const device of Object.values(state.syncDevices ?? {})) {
    if (device.revokedAt) continue
    if (!constantTimeEqual(encoder.encode(device.hash ?? ''), encoder.encode(hash))) continue
    return device
  }
  return null
}

// "Are these two vaults the same vault?" A broker cannot hand over its key, so
// the peer reports a fingerprint of its wrapped account key and we hash ours the
// same way. Equal fingerprints mean the same account data, which is the only
// condition under which ciphertext travels. null means the peer is too old to
// answer, which is reported honestly rather than guessed at.
async function syncKeyMatch(env, account, peer) {
  const check = String(peer?.keyCheck ?? '')
  if (!check) return null
  const user = await env.NODEWARDEN_DB.prepare('SELECT key FROM users WHERE lower(email) = lower(?)').bind(account).first().catch(() => null)
  if (!user?.key) return null
  return constantTimeEqual(encoder.encode(await sha256Base64(String(user.key))), encoder.encode(check))
}

function publicState(state) {
  const agents = Object.entries(state.agents).map(([name, agent]) => ({ name, alias: agent.alias ?? '', note: agent.note ?? '', allow: agent.allow ?? [], groups: agent.groups ?? [], allowAll: agent.allowAll === true, write: agent.write === true, tools: Array.isArray(agent.tools) ? agent.tools : null, account: agent.account ?? '', oauth: false, createdAt: agent.createdAt ?? '', expiresAt: typeof agent.expiresAt === 'number' ? agent.expiresAt : null }))
  const seen = new Set(agents.map((agent) => agent.name))
  const now = Date.now()
  for (const token of Object.values(state.oauthTokens ?? {})) {
    if (!token.agent || seen.has(token.agent)) continue
    if (token.expiresAt && token.expiresAt <= now) continue
    seen.add(token.agent)
    const profile = state.oauthAgentProfiles?.[token.agent] ?? {}
    agents.push({ name: token.agent, alias: profile.alias ?? '', note: profile.note ?? '', allow: profile.allow ?? [], groups: profile.groups ?? [], allowAll: profile.allowAll === true, write: profile.write === true, tools: Array.isArray(profile.tools) ? profile.tools : null, account: token.account ?? '', oauth: true, createdAt: token.createdAt ?? '', expiresAt: typeof token.expiresAt === 'number' ? token.expiresAt : null })
  }
  return {
    agents,
    policies: state.policies ?? {},
    itemGroups: state.itemGroups ?? {},
    profile: state.profile ?? {},
    // The UI labels an unclassified credential differently depending on this.
    requireClassification: requireClassification(state),
    grants: Object.values(state.grants ?? {}),
    pending: Object.values(state.pending ?? {}),
    // Legacy grants that have no recorded identity binding cannot be migrated
    // safely, so the admin has to re-grant them against a concrete item.
    // Metadata only: agent, item name and the reason.
    legacyUnbound: Object.entries(state.grants ?? {})
      .filter(([, grant]) => grant && !grant.revokedAt && !grant.migratedToCapability)
      .filter(([grantKeyName, grant]) => {
        const subject = String(grantKeyName).split('\u0000')[0]
        const name = String(grantKeyName).split('\u0000')[1]
        if (state.legacyItemBindings?.[subject + '\u0000' + name]) return false
        if (typeof grant.itemId === 'string' && grant.itemId) return false
        return true
      })
      .map(([grantKeyName, grant]) => ({
        agent: grant.agent ?? String(grantKeyName).split('\u0000')[0],
        name: grant.name ?? String(grantKeyName).split('\u0000')[1],
        mode: grant.mode ?? '',
        expiresAt: grant.expiresAt ?? 0,
        reason: 'identity-unbound',
      })),
    // Web fill policies for the admin UI: which credential is a website
    // login, which origins it may be filled into, and whether plaintext reads
    // are allowed. Metadata only, never a credential value.
    fillPolicies: {
      items: Object.entries(state.credentialKinds ?? {}).map(([itemId, kind]) => ({
        itemId, kind,
        itemName: Object.keys(state.itemIds ?? {}).find((name) => state.itemIds[name] === itemId) ?? '',
        origins: state.fillPolicies?.[itemId]?.origins ?? [],
        actions: state.fillPolicies?.[itemId]?.actions ?? [],
        plaintextRead: Boolean(state.plaintextReadPolicies?.[itemId]),
        plaintextReadExpiresAt: state.plaintextReadPolicies?.[itemId]?.expiresAt ?? 0,
      })),
    },
    // Refusals the operator was not present for. Each carries the reason, so the
    // console can explain what an Agent wanted and offer a one-click grant
    // instead of leaving a bare "access denied" that nobody ever sees.
    deniedAttempts: Object.values(state.deniedAttempts ?? {})
      .sort((a, b) => String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')))
      .slice(0, 50),
    // Per-item target rules for secret.use (the http_request action), so the
    // console can show what is reachable and let the operator change it.
    usePolicies: Object.values(state.usePolicies ?? {}).map((policy) => ({
      itemId: policy.itemId,
      itemName: Object.keys(state.itemIds ?? {}).find((name) => state.itemIds[name] === policy.itemId) ?? '',
      hosts: policy.hosts ?? [], methods: policy.methods ?? [],
      ports: policy.ports ?? ['443'], pathPrefixes: policy.pathPrefixes ?? [],
    })),
    // Which actions each Agent holds, per item: read, use and fill are separate
    // grants and the console shows them separately instead of one allowlist.
    agentActions: Object.values(state.capabilities ?? {})
      .filter((cap) => !cap.revokedAt)
      .map((cap) => ({
        agent: cap.subjectId ?? '', itemName: cap.itemName ?? '', itemId: cap.itemId ?? '',
        action: cap.action ?? '', expiresAt: cap.expiresAt ?? null,
        usesLeft: cap.maxUses == null ? null : Math.max(0, cap.maxUses - (cap.usedCount ?? 0)),
      })),
    // OAuth client registrations + their live token counts, so the admin UI can
    // show and prune them. Full client IDs are safe here (admin-only view) but
    // tokens are never exposed, only counts.
    oauthClients: Object.values(state.oauthClients ?? {}).map((c) => {
      const tokens = Object.values(state.oauthTokens ?? {}).filter((t) => t.clientId === c.clientId)
      const live = tokens.filter((t) => !t.expiresAt || t.expiresAt > now)
      return {
        clientId: c.clientId ?? '',
        clientName: String(c.clientName ?? '').slice(0, 80),
        redirectUris: (c.redirectUris ?? []).slice(0, 5),
        createdAt: c.createdAt ?? '',
        tokens: tokens.length,
        liveTokens: live.length,
        expiresAt: live.length ? Math.min(...live.map((t) => (typeof t.expiresAt === 'number' ? t.expiresAt : Infinity))) : null,
      }
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    transfers: (state.transfers ?? []).map((entry) => ({ id: entry.id, agent: entry.agent, name: entry.name, sourceAccount: entry.sourceAccount, targetAccount: entry.targetAccount, folder: entry.folder, createdAt: entry.createdAt, error: entry.error ?? '' })),
    audit: state.audit ?? [],
    syncDevices: syncDeviceList(state),
  }
}

// Approval durations for temporary capabilities. 'always' maps to a
// permanent capability (expiresAt null); the legacy grant mirror keeps its
// old expiresAt: 0 convention for backward compatibility.
const APPROVAL_DURATIONS = { once: 0, '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, always: null }

// ── Materialise: write a credential into a file the operator pre-approved ──
// The target path must already be listed in settings.materializePaths. An
// approval records a one-shot job instead of minting a read capability, so
// "write this into /srv/app/.env" can never be replayed as "hand me the
// plaintext". A path that is not on the list is refused, never widened.
const MATERIALIZE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const MATERIALIZE_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\/)/

// Collapse "." and ".." before the allowlist is consulted, so the path that is
// checked is the path that gets written. The bridge calls path.resolve(), which
// collapses too; comparing the raw string let "/srv/app/../../etc/passwd" keep
// an allowlisted "/srv/app/" prefix and land outside it. Climbing above the root
// yields null and is refused, never clamped.
function normalizeMaterializePath(raw) {
  const text = String(raw).split('\\').join('/')
  // A UNC path ("//server/share/file") cannot be collapsed into one canonical
  // form here: this function drops the empty first segment, so the checked path
  // would read "/server/share/file" while the bridge resolves it to
  // "C:/server/share/file". Refusing keeps the checked path and the written
  // path identical, which is the whole point of normalising first.
  if (text.startsWith('//')) return null
  const drive = /^[A-Za-z]:/.exec(text)?.[0] ?? ''
  const rest = text.slice(drive.length)
  const parts = []
  for (const segment of rest.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!parts.length) return null
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  if (!parts.length) return null
  return drive.toLowerCase() + (rest.startsWith('/') ? '/' : '') + parts.join('/')
}

function materializeTarget(state, raw) {
  const targetPath = typeof raw?.path === 'string' ? raw.path.trim() : ''
  const key = typeof raw?.key === 'string' ? raw.key.trim() : ''
  if (!targetPath || targetPath.length > 512 || targetPath.includes('\u0000')) return null
  if (!MATERIALIZE_ABSOLUTE.test(targetPath)) return null
  if (!MATERIALIZE_KEY.test(key)) return null
  const normalized = normalizeMaterializePath(targetPath)
  if (!normalized) return null
  const allowed = Array.isArray(state?.settings?.materializePaths) ? state.settings.materializePaths : []
  const hit = allowed.some((entry) => {
    const prefix = typeof entry === 'string' ? entry : entry?.path
    if (typeof prefix !== 'string' || !prefix) return false
    // A trailing separator means "anything under this directory"; otherwise the
    // entry names one exact file. The prefix is normalised the same way, so
    // "/srv/app/../private/" compares as "/srv/private" in both places.
    const isDirectory = /[\\/]$/.test(prefix)
    const normalizedPrefix = normalizeMaterializePath(prefix)
    if (!normalizedPrefix) return false
    return isDirectory ? normalized === normalizedPrefix || normalized.startsWith(normalizedPrefix + '/') : normalized === normalizedPrefix
  })
  // The job stores the normalised path, so the file the bridge writes is exactly
  // the path that was checked here.
  return hit ? { path: normalized, key } : null
}

async function decidePending(env, id, decision, source = 'web') {
  let outcome = null
  await updateState(env, (state) => {
    const entry = state.pending[id]
    if (!entry) return state
    delete state.pending[id]
    if (decision === 'deny') {
      outcome = { denied: true, agent: entry.agent, name: entry.name }
      return state
    }
    // A write approval is not a standing permission, not a read grant and not a
    // capability: it unlocks one write of one name for ten minutes. The value is
    // never stored here — the agent sends it again on the retry — so approving a
    // write can no longer park a secret in the state the console exposes.
    if (String(entry.action ?? '') === 'secret.write') {
      const writeAccount = typeof entry.account === 'string' ? entry.account.trim() : ''
      if (!isWellFormedAccountId(writeAccount)) {
        outcome = { agent: entry.agent, name: entry.name, action: 'secret.write', denied: true, error: 'account-missing' }
        return state
      }
      state.writeTickets ??= {}
      for (const [tkey, ticket] of Object.entries(state.writeTickets)) if (Number(ticket?.expiresAt ?? 0) < Date.now()) delete state.writeTickets[tkey]
      state.writeTickets[grantKey(entry.agent, entry.name)] = { agent: entry.agent, name: entry.name, account: writeAccount, createdAt: nowIso(), expiresAt: Date.now() + 10 * 60 * 1000 }
      outcome = { agent: entry.agent, name: entry.name, action: 'secret.write', approved: true }
      return state
    }
    // Legacy entries created before action binding have no action (and often
    // no account/itemId). Approving one would mint a capability whose action
    // is a guess, so refuse and require a fresh request.
    if (!SECRET_ACTIONS.has(String(entry.action ?? ''))) {
      outcome = { agent: entry.agent, name: entry.name, denied: true, error: 'legacy-pending-without-action' }
      return state
    }
    const requestedAction = String(entry.action ?? '')
    // Materialise never mints a read capability. It records a single job whose
    // target the operator saw on the approval page, which is what keeps one
    // click from becoming a standing plaintext grant.
    if (requestedAction === 'secret.materialize') {
      const dest = materializeTarget(state, entry.target)
      const materializeItemId = entry.itemId || state.itemIds?.[entry.name] || ''
      const materializeAccount = typeof entry.account === 'string' ? entry.account.trim() : ''
      if (!dest) {
        outcome = { agent: entry.agent, name: entry.name, action: requestedAction, denied: true, error: 'materialize-target-not-allowed' }
        return state
      }
      if (!materializeItemId || !isWellFormedAccountId(materializeAccount)) {
        outcome = { agent: entry.agent, name: entry.name, action: requestedAction, denied: true, error: 'materialize-incomplete' }
        return state
      }
      state.materializeJobs ??= {}
      // Drop jobs that expired long ago; the map is small but it is also the
      // only thing here that grows without an upper bound.
      for (const [jobId, job] of Object.entries(state.materializeJobs)) {
        if (Number(job?.expiresAt ?? 0) < Date.now() - 3600e3) delete state.materializeJobs[jobId]
      }
      state.materializeJobs[id] = {
        id, agent: entry.agent, name: entry.name, itemId: materializeItemId, account: materializeAccount,
        target: dest, createdAt: nowIso(), expiresAt: Date.now() + 10 * 60 * 1000, redeemedAt: null,
      }
      outcome = { agent: entry.agent, name: entry.name, action: requestedAction, path: dest.path, key: dest.key }
      return state
    }
    const mode = ['once', '1h', '24h', '7d', 'always'].includes(decision) ? decision : 'once'
    const expiresAt = mode === '1h' ? Date.now() + 3600e3 : mode === '24h' ? Date.now() + 86400e3 : mode === '7d' ? Date.now() + 7 * 86400e3 : 0
    state.grants[grantKey(entry.agent, entry.name)] = { agent: entry.agent, name: entry.name, mode, createdAt: nowIso(), expiresAt, reads: 0, maxReads: mode === 'once' ? 1 : null, revokedAt: null, account: entry.account ?? '' }
    // Temporary capability bound to the pending entry's action. Approving
    // secret.use never mints secret.read and vice versa.
    // Approving a fill must never mint a plaintext-read capability. Each
    // action maps to itself; anything unknown is refused above.
    // An unknown action is refused outright. It must never fall back to a
    // weaker action, otherwise a future action could silently become a
    // plaintext read.
    const entryAction = String(entry.action ?? '')
    if (!SECRET_ACTIONS.has(entryAction)) {
      outcome = { agent: entry.agent, name: entry.name, denied: true, error: 'unsupported-action' }
      return state
    }
    const itemId = entry.itemId || state.itemIds?.[entry.name] || ''
    // A capability must never be issued without a concrete account: the consume
    // gate treats a blank accountId as "no account restriction". Refuse instead
    // of minting an account-agnostic grant.
    const entryAccount = typeof entry.account === 'string' ? entry.account.trim() : ''
    if (!isWellFormedAccountId(entryAccount)) {
      outcome = { agent: entry.agent, name: entry.name, mode, action: entryAction, error: 'account-missing' }
      return state
    }
    // A fill approval is only meaningful with a concrete target origin, and
    // the origin must still satisfy the fill policy. A missing or malformed
    // target is refused rather than guessed.
    // A fill or use approval names a site. The capability carries that site so
    // the approval buys exactly what the operator saw, not every host the
    // item's policy happens to list.
    const boundOrigin = entryAction === 'secret.fill' || entryAction === 'secret.use'
      ? normalizeOrigin(entry.targetOrigin)?.origin ?? ''
      : ''
    if (entryAction === 'secret.use' && !boundOrigin) {
      // Without an origin this approval would be a blank cheque; the agent asks
      // again and the next pending names its target.
      outcome = { agent: entry.agent, name: entry.name, mode, action: entryAction, denied: true, error: 'use-target-missing' }
      return state
    }
    if (entryAction === 'secret.fill') {
      const target = normalizeOrigin(entry.targetOrigin)
      if (!target) {
        outcome = { agent: entry.agent, name: entry.name, mode, action: entryAction, denied: true, error: 'fill-target-missing' }
        return state
      }
      const fill = fillPolicyFor(state, itemId || state.itemIds?.[entry.name] || '', target.origin)
      if (!fill.ok) {
        outcome = { agent: entry.agent, name: entry.name, mode, action: entryAction, denied: true, error: 'fill-target-not-allowed' }
        return state
      }
    }
    if (itemId) {
      const key = capabilityKey(entry.agent, itemId, entryAction)
      const ttl = APPROVAL_DURATIONS[mode]
      state.capabilities ??= {}
      const existing = state.capabilities[key]
      // Never silently overwrite a live capability (one approval must not
      // reset counters a previous approval established). Re-granting over a
      // revoked/expired/exhausted record is allowed but recorded distinctly.
      if (existing) {
        const status = capabilityStatus(existing)
        if (status === 'valid' || status === 'expiring') {
          // One record per (agent, item, action), so approving a second site
          // appends to the target list instead of being skipped until the
          // first approval expires. A record with no list predates target
          // binding: leave it alone rather than narrow access it already had.
          if (Array.isArray(existing.targets) && boundOrigin && !existing.targets.includes(boundOrigin)) {
            existing.targets = [...existing.targets, boundOrigin]
            outcome = { agent: entry.agent, name: entry.name, mode, action: entryAction, target: boundOrigin, appended: true }
            return state
          }
          outcome = { agent: entry.agent, name: entry.name, mode, action: entryAction, skipped: 'live-capability' }
          return state
        }
      }
      state.capabilities[key] = {
        id: key, subjectId: entry.agent, accountId: entryAccount, itemId,
        itemName: entry.name, action: entryAction, mode: 'temporary',
        createdAt: nowIso(), createdBy: 'approval:' + id,
        expiresAt: ttl == null || ttl === 0 ? null : Date.now() + ttl,
        maxUses: mode === 'once' ? 1 : null, usedCount: 0,
        revokedAt: null, revokedBy: null, approvalId: id, policyVersion: 1,
        ...(boundOrigin ? { targets: [boundOrigin] } : {}),
        regrantedFrom: existing ? (existing.revokedAt ? 'revoked' : (existing.exhaustedAt ? 'exhausted' : 'expired')) : null,
      }
    } else {
      // Missing itemId: refuse to mint a capability rather than create an
      // unusable grant that could later be revived by name.
      outcome = { agent: entry.agent, name: entry.name, mode, action: entryAction, error: 'no-item-id' }
      return state
    }
    outcome = { agent: entry.agent, name: entry.name, mode, action: entryAction }
    return state
  })
  if (!outcome) return null
  await addAudit(env, { event: outcome.denied ? 'request.deny' : 'request.approve', ...outcome, source })
  return outcome
}

async function signedApprovalLinks(env, id, origin, source = 'notification') {
  const exp = Date.now() + 24 * 3600 * 1000
  const links = {}
  for (const decision of ['once', '24h', 'always', 'deny']) {
    const signature = await hmacToken(await cookieKey(env), `${id}:${decision}:${exp}`)
    links[decision] = `${origin}/approve?id=${encodeURIComponent(id)}&d=${decision}&exp=${exp}&sig=${encodeURIComponent(signature)}&ch=${encodeURIComponent(source)}`
  }
  return links
}

// ── Notification templates ───────────────────────────────────────────────
// One approval template shared by all channels, editable in Settings →
// 通知模板 (stored at settings.notifications.templates) so copy changes do
// not need a redeploy. Missing/empty fields fall back to the defaults below,
// which reproduce the previously hardcoded wording. Placeholders: {agent},
// {name}, {time}, {origin} for approvals; {lines}, {origin} for reminders.
// Channels differ only in rendering: Telegram/ntfy/Gotify turn the labels
// into buttons/actions, wxpush has no buttons so it appends the signed links.
const DEFAULT_APPROVAL_TEMPLATE = {
  title: 'Secrets Broker 授权请求',
  body: 'Secrets Broker 授权请求\nAgent: {agent}\n条目: {name}\n时间: {time}\n\n请在 Secrets Broker 页面处理: {origin}/',
  labels: { once: '仅本次', '24h': '24 小时', deny: '拒绝', always: '永久' },
}
const DEFAULT_REMINDER_TEMPLATE = {
  title: 'Secrets Broker 授权提醒',
  body: 'Secrets Broker 授权提醒\n\n{lines}\n\n前往延长：{origin}/#/agents',
}
function notificationTemplates(notifications) {
  const t = notifications?.templates ?? {}
  const a = t.approval ?? {}
  const r = t.reminder ?? {}
  const labels = a.labels ?? {}
  const pick = (value, fallback) => (typeof value === 'string' && value !== '' ? value : fallback)
  return {
    approval: {
      title: pick(a.title, DEFAULT_APPROVAL_TEMPLATE.title),
      body: pick(a.body, DEFAULT_APPROVAL_TEMPLATE.body),
      labels: {
        once: pick(labels.once, DEFAULT_APPROVAL_TEMPLATE.labels.once),
        '24h': pick(labels['24h'], DEFAULT_APPROVAL_TEMPLATE.labels['24h']),
        deny: pick(labels.deny, DEFAULT_APPROVAL_TEMPLATE.labels.deny),
        always: pick(labels.always, DEFAULT_APPROVAL_TEMPLATE.labels.always),
      },
    },
    reminder: {
      title: pick(r.title, DEFAULT_REMINDER_TEMPLATE.title),
      body: pick(r.body, DEFAULT_REMINDER_TEMPLATE.body),
    },
  }
}
function renderTemplate(text, vars) {
  return String(text).replace(/\{(agent|name|time|origin|lines)\}/g, (match, key) => (vars[key] ?? match))
}

// A refusal notification: one line of text and a link to the console page that
// fixes it. No approve/deny buttons, because there is nothing to approve.
// Reply on the bot the notifications already use.
async function telegramSay(telegram, chatId, text) {
  const token = String(telegram?.botToken ?? '')
  if (!token || !chatId) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 3800), disable_web_page_preview: true }),
  }).catch(() => {})
}

// Handle one text message. Commands mutate; anything else goes to the assistant,
// which is read-only, so an ambiguous message can never change a permission.
async function handleTelegramMessage(env, message, telegram) {
  const chatId = message.chat?.id
  const text = String(message.text ?? '')
  const parsed = parseCommand(text)
  const state = await loadState(env)
  const reply = (body) => telegramSay(telegram, chatId, body)

  if (!parsed) return reply(TELEGRAM_HELP)
  const { verb, args } = parsed

  if (verb === 'help' || verb === 'start') return reply(TELEGRAM_HELP)

  if (verb === 'pending') return reply(formatPendingList(state))

  if (verb === 'status') return reply(formatStatus(state) + '\n' + describeAutoRule(state))

  if (verb === 'grants') return reply(formatGrants(state))

  if (verb === 'asksettings') return reply(describeAutoRule(state) + '\n\n用 /auto <agent|*> <时长> <分钟> 设置；/auto off 关闭。')

  if (verb === 'auto') {
    if (args[0] === 'off' || args[0] === 'cancel') {
      await updateState(env, (next) => { delete next.settings.telegramAuto; return next })
      await addAudit(env, { event: 'telegram.auto-off', source: 'telegram' })
      return reply('自动审批已关闭。')
    }
    const agent = String(args[0] ?? '').trim()
    const minutes = Number(args[1] ?? 0)
    if (!agent || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
      return reply('用法：/auto <agent|*> <分钟>，例如 /auto Muse 60。最多 1440 分钟（24 小时）。')
    }
    const until = Date.now() + Math.floor(minutes) * 60000
    await updateState(env, (next) => {
      next.settings.telegramAuto = { agent, until, createdAt: nowIso() }
      return next
    })
    await addAudit(env, { event: 'telegram.auto-on', agent, minutes: Math.floor(minutes), source: 'telegram' })
    // Say plainly what was just enabled: an auto-approval rule is a standing
    // permission and the operator must not be surprised by it later.
    return reply('已开启：' + (agent === '*' ? '所有 Agent' : agent) + ' 的请求将在未来 ' + Math.floor(minutes) + ' 分钟内自动批准。\n\n这段时间内这些请求不会征求你的意见，审批仍会记入日志。用 /auto off 立即关闭。')
  }

  if (verb === 'approve' || verb === 'deny') {
    const entry = resolvePending(state, args[0])
    if (!entry) return reply('找不到这个请求。先发 /pending 看看有哪些。')
    const decision = verb === 'deny' ? 'deny' : (String(args[1] ?? 'once').toLowerCase())
    if (verb === 'approve' && !['once', '1h', '24h', '7d', 'always'].includes(decision)) {
      return reply('时长只能是 once / 1h / 24h / 7d / always。')
    }
    const outcome = await decidePending(env, entry.id, decision, 'telegram')
    if (!outcome) return reply('这个请求已经处理过了。')
    if (outcome.denied) return reply('已拒绝：' + outcome.agent + ' → ' + outcome.name)
    if (outcome.error) return reply('没能批准：' + outcome.error)
    await recordGeoEvent(env, { headers: new Headers() }, {}, { agent: outcome.agent, kind: 'token', action: 'secret.approve', ok: true }).catch(() => {})
    return reply('已批准：' + outcome.agent + ' → ' + outcome.name + '（' + (outcome.mode || decision) + '）')
  }

  if (verb === 'extend') {
    const [agent, item, span, action = 'secret.read'] = args
    if (!agent || !item || !span) return reply('用法：/extend <agent> <条目> <天数|permanent> [secret.read|secret.use|secret.fill]')
    const days = span === 'permanent' ? 'permanent' : Number(span)
    if (days !== 'permanent' && (!Number.isFinite(days) || days <= 0 || days > 3650)) {
      return reply('天数只能是 1-3650，或 permanent。')
    }
    const state2 = await loadState(env)
    const itemId = telegramItemId(state2, item)
    if (!itemId) return reply('找不到条目「' + item + '」。控制台解锁一次密码库后再试，或直接抄 itemId（条目详情里有）。')
    const key = capabilityKey(agent, itemId, action)
    const cap = state2.capabilities?.[key]
    if (!cap) return reply('「' + agent + '」没有对「' + item + '」的 ' + action + ' 授权；用 /approve 或网页授权。')
    const until = days === 'permanent' ? null : Date.now() + days * 86400e3
    await updateState(env, (next) => {
      const c = next.capabilities[key]
      if (c) { c.expiresAt = until; c.revokedAt = null; c.revokedBy = null }
      const legacy = next.grants?.[grantKey(agent, item)]
      if (legacy) { legacy.expiresAt = until ?? 0; legacy.revokedAt = null; legacy.revokedBy = null }
      return next
    })
    await addAudit(env, { event: 'grant.extend', agent, name: item, action, days: String(span), source: 'telegram' })
    return reply('已延长：' + agent + ' → ' + item + '（' + action + '）到 ' + (until ? new Date(until).toLocaleString('zh-CN', { hour12: false }) : '永久'))
  }

  if (verb === 'revoke') {
    const [agent, item, action = 'secret.read'] = args
    if (!agent || !item) return reply('用法：/revoke <agent> <条目> [secret.read|secret.use|secret.fill]')
    const state2 = await loadState(env)
    const itemId = telegramItemId(state2, item)
    if (!itemId) return reply('找不到条目「' + item + '」。控制台解锁一次密码库后再试，或直接抄 itemId。')
    const key = capabilityKey(agent, itemId, action)
    const cap = state2.capabilities?.[key]
    const legacyKey = grantKey(agent, item)
    if (!cap && !state2.grants?.[legacyKey]) return reply('没有这条授权。')
    await updateState(env, (next) => {
      const c = next.capabilities[key]
      if (c) { c.revokedAt = nowIso(); c.revokedBy = 'telegram' }
      const legacy = next.grants?.[legacyKey]
      if (legacy) { legacy.revokedAt = nowIso(); legacy.revokedBy = 'telegram' }
      return next
    })
    await addAudit(env, { event: 'grant.revoke', agent, name: item, action, source: 'telegram' })
    return reply('已撤销：' + agent + ' → ' + item + '（' + action + '）')
  }

  // Not a command: answer as the assistant, which cannot change anything.
  const session = await getSession(env)
  const snapshot = aiSnapshot(state, { vaultUnlocked: Boolean(session), scope: await vaultItemNames(env, env.NODEWARDEN_DB) })
  const answer = await askAi(env, state.settings, { question: parsed.text, snapshot, history: [] })
  if (!answer.ok) return reply('回答不了：' + answer.reason + '\n\n发 /help 看命令。')
  return reply(answer.text)
}

// A channel switched off in the settings is dropped here, so every sender below
// keeps its plain `if (notifications.x)` shape and a muted channel cannot be
// woken by a test. A missing `enabled` means on, so existing configs keep working.
function liveChannels(notifications) {
  const out = {}
  for (const name of ['telegram', 'ntfy', 'gotify', 'wxpush']) {
    const channel = notifications?.[name]
    if (channel && channel.enabled !== false) out[name] = channel
  }
  out.templates = notifications?.templates
  return out
}

async function notifyDenied(env, origin, entry, notifications) {
  const actionLabel = { 'secret.read': '读取明文', 'secret.use': '代持调用（http_request）', 'secret.fill': '网页填充' }[entry.action] || entry.action || ''
  const text = `${entry.agent} 尝试${actionLabel}「${entry.name}」但被拦下：${entry.reason}\n在控制台的「被拦下的请求」里可以一键授权：${origin}/#items`
  const tasks = []
  if (notifications.telegram?.botToken && notifications.telegram?.chatId) {
    tasks.push(fetch(`https://api.telegram.org/bot${notifications.telegram.botToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: notifications.telegram.chatId, text, disable_web_page_preview: true }),
    }))
  }
  if (notifications.ntfy?.url && notifications.ntfy?.topic) {
    tasks.push(fetch(`${String(notifications.ntfy.url).replace(/\/$/, '')}/${encodeURIComponent(notifications.ntfy.topic)}`, {
      method: 'POST', headers: { title: 'Secrets Broker · 被拦下的请求', tags: 'warning' }, body: text,
    }))
  }
  if (notifications.gotify?.url && notifications.gotify?.token) {
    tasks.push(fetch(`${String(notifications.gotify.url).replace(/\/$/, '')}/message`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-gotify-key': notifications.gotify.token },
      body: JSON.stringify({ title: 'Secrets Broker · 被拦下的请求', message: text, priority: 5 }),
    }))
  }
  if (notifications.wxpush?.url) {
    tasks.push(fetch(String(notifications.wxpush.url), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Secrets Broker · 被拦下的请求', content: text }),
    }))
  }
  await Promise.allSettled(tasks)
}

async function notifyPending(env, origin, entry, ctx) {
  const state = await loadState(env)
  const notifications = liveChannels(state.settings?.notifications ?? {})
  // A refusal is a report, not a question: there is no pending record to approve,
  // so the allow/deny buttons would answer "already handled". Say where to fix it.
  if (entry.denied === true) return notifyDenied(env, origin, entry, notifications)
  const tpl = notificationTemplates(notifications).approval
  const links = await signedApprovalLinks(env, entry.id, origin)
  const shortText = renderTemplate(tpl.body, { agent: entry.agent, name: entry.name, time: entry.createdAt, origin })
  const linkText = `${shortText}\n\n${tpl.labels.once}: ${links.once}\n${tpl.labels['24h']}: ${links['24h']}\n${tpl.labels.always}: ${links.always}\n${tpl.labels.deny}: ${links.deny}`
  const tasks = []
  if (notifications.telegram?.botToken && notifications.telegram?.chatId) {
    const keyboard = { inline_keyboard: [
      [{ text: tpl.labels.once, callback_data: `a:${entry.id}:once` }, { text: tpl.labels['24h'], callback_data: `a:${entry.id}:24h` }],
      [{ text: tpl.labels.always, callback_data: `a:${entry.id}:always` }, { text: tpl.labels.deny, callback_data: `d:${entry.id}` }],
    ] }
    tasks.push(fetch(`https://api.telegram.org/bot${notifications.telegram.botToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: notifications.telegram.chatId, text: shortText, disable_web_page_preview: true, reply_markup: keyboard }),
    }))
  }
  if (notifications.ntfy?.url && notifications.ntfy?.topic) {
    const actions = [
      `view, ${tpl.labels.once}, ${links.once}, clear=true`,
      `view, ${tpl.labels['24h']}, ${links['24h']}, clear=true`,
      `view, ${tpl.labels.always}, ${links.always}, clear=true`,
      `view, ${tpl.labels.deny}, ${links.deny}, clear=true`,
    ].join('; ')
    tasks.push(fetch(`${String(notifications.ntfy.url).replace(/\/$/, '')}/${encodeURIComponent(notifications.ntfy.topic)}`, {
      method: 'POST', headers: { title: tpl.title, tags: 'lock', Actions: actions }, body: shortText,
    }))
  }
  if (notifications.gotify?.url && notifications.gotify?.token) {
    // Gotify clients (Gotify+ / notify inbox) render notify::actions as buttons,
    // mirroring the Telegram inline keyboard: short body, no raw signed URLs.
    // '拒绝' sits third so it survives the 3-action cap of Android notifications;
    // the detail view shows all four. click.url opens the console on tap.
    const extras = {
      'client::notification.click': { url: `${origin}/` },
      'notify::actions': [
        { label: tpl.labels.once, url: links.once },
        { label: tpl.labels['24h'], url: links['24h'] },
        { label: tpl.labels.deny, url: links.deny },
        { label: tpl.labels.always, url: links.always },
      ],
    }
    tasks.push(fetch(`${String(notifications.gotify.url).replace(/\/$/, '')}/message?token=${encodeURIComponent(notifications.gotify.token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: tpl.title, message: shortText, priority: 5, extras }),
    }))
  }
  if (notifications.wxpush?.url && notifications.wxpush?.token) {
    if (notifications.wxpush.format === 'json') {
      tasks.push(fetch(notifications.wxpush.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${notifications.wxpush.token}` }, body: JSON.stringify({ title: tpl.title, text: linkText, content: linkText, agent: entry.agent, item: entry.name, approval: links }) }))
    } else {
      const body = new URLSearchParams({ title: tpl.title, content: linkText, token: notifications.wxpush.token })
      tasks.push(fetch(notifications.wxpush.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }))
    }
  }
  if (!tasks.length) return
  const run = Promise.allSettled(tasks)
  if (ctx?.waitUntil) ctx.waitUntil(run)
  else await run
}


// ── Authorization reminders ────────────────────────────────────────────────
// Aggregates everything an operator needs to act on: agents whose authorization
// expires within the reminder window, and agents that have gone quiet. Pending
// approvals always take priority over reminders in the UI, but both are
// returned so the banner can explain why it is showing one and not the other.
const REMINDER_WINDOWS = [5, 3, 1]
const IDLE_DAYS = 7

// Severity follows the operator's rule: anything below 3 days is red, the
// remaining window (up to 5 days) is the orange warning band.
function reminderSeverity(daysLeft) {
  if (daysLeft <= 2) return 'critical'
  return 'warning'
}

function buildReminders(state, now = Date.now()) {
  const reminders = []
  const audit = state.audit ?? []
  const lastActivity = new Map()
  for (const entry of audit) {
    if (!entry.agent) continue
    const time = Date.parse(entry.time)
    if (!Number.isFinite(time)) continue
    if (!lastActivity.has(entry.agent) || time > lastActivity.get(entry.agent)) lastActivity.set(entry.agent, time)
  }
  const seen = new Set()
  const consider = (name, oauth, expiresAt) => {
    if (seen.has(name)) return
    seen.add(name)
    if (typeof expiresAt === 'number') {
      const msLeft = expiresAt - now
      if (msLeft <= 0) {
        reminders.push({ kind: 'expired', agent: name, oauth, severity: 'critical', daysLeft: 0, expiresAt, message: '授权已过期' })
      } else {
        const daysLeft = Math.ceil(msLeft / 86400e3)
        if (daysLeft <= 5) {
          reminders.push({ kind: 'expiring', agent: name, oauth, severity: reminderSeverity(daysLeft), daysLeft, expiresAt, message: daysLeft <= 1 ? '授权将在 1 天内过期' : '授权将在 ' + daysLeft + ' 天内过期' })
        }
      }
    }
    const last = lastActivity.get(name)
    if (!last || now - last > IDLE_DAYS * 86400e3) {
      reminders.push({ kind: 'idle', agent: name, oauth, severity: 'notice', daysIdle: last ? Math.floor((now - last) / 86400e3) : null, lastActivityAt: last ? new Date(last).toISOString() : null, message: last ? '已 ' + Math.floor((now - last) / 86400e3) + ' 天无读取记录' : '从未有读取记录' })
    }
  }
  for (const [name, agent] of Object.entries(state.agents ?? {})) consider(name, false, agent.expiresAt)
  // OAuth subjects: their window lives on the token records.
  const oauthExpiry = new Map()
  for (const token of Object.values(state.oauthTokens ?? {})) {
    if (!token.agent) continue
    if (token.expiresAt && token.expiresAt < now) continue
    const current = oauthExpiry.get(token.agent)
    if (current === undefined || (typeof token.expiresAt === 'number' && token.expiresAt < current)) oauthExpiry.set(token.agent, typeof token.expiresAt === 'number' ? token.expiresAt : null)
  }
  for (const [agent, exp] of oauthExpiry.entries()) consider(agent, true, exp)
  // A secret with an expiry of its own. It uses the same severity bands, so
  // the home page and the notification channels show it without any new
  // plumbing.
  for (const [name, entry] of Object.entries(state.secretExpiry ?? {})) {
    if (!entry || typeof entry.expiresAt !== 'number') continue
    const msLeft = entry.expiresAt - now
    if (msLeft <= 0) {
      reminders.push({ kind: 'secret-expired', agent: name, name, oauth: false, severity: 'critical', daysLeft: 0, expiresAt: entry.expiresAt, message: '密钥已过期' })
      continue
    }
    const daysLeft = Math.ceil(msLeft / 86400e3)
    if (daysLeft <= 5) {
      reminders.push({ kind: 'secret-expiring', agent: name, name, oauth: false, severity: reminderSeverity(daysLeft), daysLeft, expiresAt: entry.expiresAt, message: daysLeft <= 1 ? '密钥今天到期' : '密钥即将到期' })
    }
  }
  const order = { critical: 0, warning: 1, notice: 2 }
  reminders.sort((a, b) => (order[a.severity] - order[b.severity]) || String(a.agent).localeCompare(String(b.agent)))
  return reminders
}

// Notification body for a reminder batch. Deliberately excludes any secret
// material and any token; it only carries agent names and day counts plus the
// link back to the console where an admin can extend.
function reminderMessage(reminders, origin, notifications) {
  const tpl = notificationTemplates(notifications).reminder
  const lines = reminders.map((r) => {
    const kind = r.oauth ? 'OAuth' : (r.kind.startsWith('secret-') ? '密钥' : 'Token')
    if (r.kind === 'expired' || r.kind === 'secret-expired') return '- ' + r.agent + ' (' + kind + ')：' + r.message
    if (r.kind === 'expiring' || r.kind === 'secret-expiring') return '- ' + r.agent + ' (' + kind + ')：' + r.message + '，剩余 ' + r.daysLeft + ' 天'
    return '- ' + r.agent + ' (' + kind + ')：' + r.message
  })
  return { title: tpl.title, text: renderTemplate(tpl.body, { lines: lines.join('\n'), origin }) }
}

// One key for a reminder, used on both sides: reading it decides whether this
// batch was already sent, writing it records that it was. Two different
// expressions here is how a key-expiry reminder went out every 15 seconds.
function reminderSentKey(r) {
  const threshold = r.kind === 'expiring' || r.kind === 'secret-expiring' ? r.daysLeft : 'idle'
  return r.agent + '\u0000' + r.kind + '\u0000' + threshold
}

// Send once per (agent, kind, threshold) so a 5-day reminder does not repeat on
// every page load. State lives under state.reminderSent.
async function dispatchReminderBatch(env, state, origin, ctx, now = Date.now()) {
  const reminders = buildReminders(state, now)
  if (!reminders.length) return { sent: 0, reminders: 0 }
  const sentMap = state.reminderSent ?? {}
  const TTL = 20 * 3600e3
  const fresh = reminders.filter((r) => {
    const key = reminderSentKey(r)
    const last = sentMap[key]
    return !(typeof last === 'number' && now - last < TTL)
  })
  if (!fresh.length) return { sent: 0, reminders: reminders.length }
  const notifications = liveChannels(state.settings?.notifications ?? {})
  const { title, text } = reminderMessage(fresh, origin, notifications)
  const tasks = []
  if (notifications.telegram?.botToken && notifications.telegram?.chatId) {
    tasks.push(fetch('https://api.telegram.org/bot' + notifications.telegram.botToken + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: notifications.telegram.chatId, text, disable_web_page_preview: true }) }))
  }
  if (notifications.ntfy?.url && notifications.ntfy?.topic) {
    tasks.push(fetch(String(notifications.ntfy.url).replace(/\/$/, '') + '/' + encodeURIComponent(notifications.ntfy.topic), { method: 'POST', headers: { 'title': title, tags: 'warning' }, body: text }))
  }
  if (notifications.gotify?.url && notifications.gotify?.token) {
    tasks.push(fetch(String(notifications.gotify.url).replace(/\/$/, '') + '/message?token=' + encodeURIComponent(notifications.gotify.token), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, message: text, priority: 6 }) }))
  }
  if (notifications.wxpush?.url && notifications.wxpush?.token) {
    if (notifications.wxpush.format === 'json') {
      tasks.push(fetch(notifications.wxpush.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + notifications.wxpush.token }, body: JSON.stringify({ title, text, content: text }) }))
    } else {
      tasks.push(fetch(notifications.wxpush.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ title, content: text, token: notifications.wxpush.token }) }))
    }
  }
  if (tasks.length) {
    const run = Promise.allSettled(tasks)
    if (ctx?.waitUntil) ctx.waitUntil(run)
    else await run
  }
  // Record the sent markers atomically. A whole-state write here would persist a
  // stale snapshot and silently drop anything that landed in the meantime -
  // for example an OAuth client registered while this batch was being built.
  const ops = fresh.map((r) => ({
    op: 'set',
    path: ['reminderSent', reminderSentKey(r)],
    value: now,
  }))
  if (ops.length) await mutateState(env, ops).catch(() => {})
  return { sent: tasks.length ? fresh.length : 0, reminders: reminders.length }
}

// Count the captured globe events without exposing anything sensitive: totals
// and the agent names only, no coordinates, no identifiers.
async function geoEventSummary(env) {
  try {
    const response = await stateStub(env).fetch('https://state/geo/query', { method: 'POST', body: JSON.stringify({ windowMs: 7 * 86400e3, limit: 500 }) })
    const payload = await response.json()
    const events = Array.isArray(payload.events) ? payload.events : []
    const agents = new Set()
    for (const entry of events) if (entry && entry.agent) agents.add(String(entry.agent))
    return { events: events.length, agents: agents.size }
  } catch {
    return { events: 0, agents: 0 }
  }
}
// ── Web fill (P1): classification, policy, one-shot authorization ──────────
// The Agent may ask for a credential to be filled into a website. The Agent
// never sees the value. This file only decides, authorizes and audits.

// How a credential is classified is an explicit admin decision stored per item.
// The NodeWarden item type is deliberately NOT used: it is user editable, so
// deriving "this is a website login" from it would let anyone reclassify a
// secret at will and read it back as plaintext.
const CREDENTIAL_KINDS = new Set(['api', 'web'])
const FILL_ACTIONS = new Set(['login'])

// Fill authorizations live apart from capabilities: they are one-shot, bound to
// a concrete origin, and redeemed by the execution layer only.
function fillPolicyKey(itemId) { return itemId }

// Normalise an origin to scheme + host + port so comparisons are exact.
// No suffix or wildcard matching: "example.com.evil.test" must never match
// a policy for "example.com".
// https is required because a credential filled over plain http crosses the
// network in the clear. The exception is a host that cannot leave the local
// network (loopback, RFC1918, .lan/.local): a homelab console has no
// certificate, and refusing it makes the feature unusable there.
function isPrivateHost(host) {
  const name = String(host || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (name === 'localhost' || name === '::1' || name === '0.0.0.0') return true
  if (/\.(local|lan|internal|home\.arpa|localhost)$/.test(name)) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  if (a === 10 || a === 127) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function normalizeOrigin(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  // An operator typing an internal service writes "192.168.1.10:8080", so a
  // missing scheme means https rather than a parse failure.
  const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw
  let url
  try { url = new URL(text) } catch { return null }
  if (url.username || url.password) return null
  const scheme = url.protocol === 'https:' ? 'https' : url.protocol === 'http:' ? 'http' : ''
  if (!scheme) return null
  if (scheme === 'http' && !isPrivateHost(url.hostname)) return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return null
  const fallback = scheme === 'http' ? '80' : '443'
  const port = url.port ? String(url.port) : fallback
  const shownPort = port === fallback ? '' : ':' + port
  return { origin: scheme + '://' + host + shownPort, host, port }
}

function credentialKind(state, itemId) {
  return state.credentialKinds?.[itemId] ?? null
}

// Record a classification and, for a website login, the origins it may be
// filled into. Shared by the admin route and the plugin route: one shape in
// state, one audit event, one place to change.
// Returns { ok } or { ok: false, error } so each caller can shape its failure.
function applyCredentialKind(state, { itemId, kind, origins, actions, accountId, autoApprove }) {
  state.credentialKinds ??= {}
  state.credentialKinds[itemId] = kind
  if (kind === 'web') {
    state.fillPolicies ??= {}
    state.fillPolicies[itemId] = {
      itemId, accountId, origins, actions,
      // A fresh revision on every change. It is unique, so a policy that is
      // deleted and recreated never matches an old authorization.
      policyRevision: crypto.randomUUID(),
      autoApprove: autoApprove === true, updatedAt: nowIso(),
    }
  } else {
    // An api credential has no fill policy: it is not a website login.
    delete state.fillPolicies?.[itemId]
  }
  return state
}

// A policy is applicable only when the item is classified as a web
// credential and the request origin is listed verbatim. Any ambiguity (more
// than one policy claiming the item, or an item with no policy) is not
// auto-approved: the caller turns it into a pending request.
function fillPolicyFor(state, itemId, origin) {
  // Callers hand over what the agent typed ("https://x.com/" with a slash, or a
  // bare host); policy origins are stored normalised, so normalise here too.
  origin = normalizeOrigin(origin)?.origin ?? ''
  const kind = credentialKind(state, itemId)
  if (kind !== 'web') return { ok: false, reason: 'not-a-web-credential' }
  const policy = state.fillPolicies?.[itemId] ?? null
  if (!policy) return { ok: false, reason: 'no-fill-policy' }
  if (policy.accountId && origin && state.settings?.vaultEmail &&
      String(policy.accountId).toLowerCase() !== String(state.settings?.vaultEmail).toLowerCase()) {
    return { ok: false, reason: 'account-mismatch' }
  }
  const origins = (policy.origins ?? []).map((value) => normalizeOrigin(value)?.origin).filter(Boolean)
  if (!origins.length) return { ok: false, reason: 'policy-has-no-origin' }
  if (!origin || !origins.includes(origin)) return { ok: false, reason: 'origin-not-allowed' }
  const actions = (policy.actions ?? []).map((value) => String(value))
  if (!actions.length) return { ok: false, reason: 'policy-has-no-action' }
  return { ok: true, policy, origin, origins, actions, kind }
}
// Plaintext read guard, and the whole simplification of this model.
//
// The rule that matters is "may this Agent read this credential": scope plus a
// grant, or an explicit approval. Classification and the plaintext policy were
// built as a SECOND gate on top of that, which made the common case — approve a
// request, then read — fail with "unclassified-credential" even though the
// operator had just said yes. Two mechanisms for one decision, and the strict one
// won by surprise.
//
// So: once an Agent holds a valid read grant for the item (approved, shared, or
// preapproved), the read is allowed. Classification is metadata that decides
// whether the item is a website login and which sites it may fill, not whether an
// already-granted read is permitted. The web rule stays, because filling is a
// different capability, not a permission level.
//
// The declarations still matter for one case, and only one: an item marked
// no-approval, where nobody is asked. Then classification and the plaintext
// policy are the only thing standing between an Agent and the value.
// Policies are keyed by item name, so the read guard needs the name that goes
// with an id it was handed.
function itemNameOf(state, itemId) {
  if (!itemId) return ''
  for (const [name, id] of Object.entries(state.itemIds ?? {})) if (id === itemId) return name
  return ''
}

// The guard answers in stable codes. An agent that only sees
// "web-credential-is-fill-only" does not know that request_fill is the way in.
const READ_GUARD_HINTS = {
  'item-id-unresolved': '这个条目的 id 解析不到；让操作员在面板里重新授权一次',
  'account-mismatch': '这份授权属于另一个 vault 账户；先切回那个账户再试',
  'web-credential-is-fill-only': '这是网站登录条目，只能 request_fill 填进白名单站点，永远取不到明文',
  'unclassified-plaintext-off': '条目没有分类，默认不给明文；让操作员把它设为 api 条目',
  'no-read-grant': '这个 Agent 还没有读取授权；先 request_access，批准后重试',
}
// The code stays in brackets: the sentence is for the agent, the code is for
// whoever greps the audit trail later.
function readGuardMessage(reason) { const hint = READ_GUARD_HINTS[reason]; return hint ? hint + ' [' + reason + ']' : reason }
function plaintextReadAllowed(state, itemId, { noApproval = false, granted = false, agent = '' } = {}) {
  // An id that could not be resolved is not an unclassified credential: it is an
  // unknown item, and an unknown item never gets plaintext.
  if (!itemId) return { ok: false, reason: 'item-id-unresolved' }
  const kind = credentialKind(state, itemId)
  const rules = behaviourSettings(state)
  // A per-agent action grant for this item is the operator answering this exact
  // question for this exact agent, so it outranks the global switch.
  const explicit = agent ? actionGrantFor(state, agent, itemId) : null
  const explicitRead = Boolean(explicit && (explicit.actions ?? []).includes('secret.read'))
  // An Agent that was granted this item may read it. The grant is the decision.
  // The account check is NOT bypassed: a capability is bound to the vault it was
  // issued for, and after an account switch the same capability must not read the
  // other vault. `granted` only says "a grant exists"; sameAccount says it is this
  // vault's grant.
  if (granted) {
    const cap = state.capabilities?.[capabilityKey(granted.subject, itemId, 'secret.read')] ?? null
    const boundAccount = cap?.accountId || granted.accountId || ''
    const current = String(state.settings?.vaultEmail ?? '').toLowerCase()
    if (boundAccount && current && String(boundAccount).toLowerCase() !== current) {
      return { ok: false, reason: 'account-mismatch' }
    }
    // The switches only ever narrow what a grant can do; a grant never widens
    // them, because the switch is the operator's answer for the whole vault.
    if (kind === 'web' && !rules.webPlaintext && !noApproval && !explicitRead) return { ok: false, reason: 'web-credential-is-fill-only' }
    if (!kind && !rules.unclassifiedPlaintext && !noApproval && !explicitRead) return { ok: false, reason: 'unclassified-plaintext-off' }
    return { ok: true, granted: true }
  }
  if (noApproval) {
    // No-approval is the operator's standing "yes" for this item, made knowing
    // what it is. It bypasses the approval prompt, so it must also satisfy the
    // read guard: an item marked no-approval that still cannot be read is a
    // switch that does nothing.
    //
    // It is also the one path with no grant to carry an account, so the policy
    // itself has to say which vault it was made for. Without that, a name that
    // exists in two vaults would carry the permission from one into the other.
    const policyAccount = String(state.policies?.[itemNameOf(state, itemId)]?.accountId ?? '').toLowerCase()
    const current = String(state.settings?.vaultEmail ?? '').toLowerCase()
    if (policyAccount && current && policyAccount !== current) return { ok: false, reason: 'account-mismatch' }
    return { ok: true, noApproval: true }
  }
  return { ok: false, reason: 'no-read-grant' }
}

// Whether an unclassified credential must be refused. Defaults to true so a
// fresh install is safe; the operator can turn it off in 设置.
// One switch per question, because a single "mode" preset never fits: an
// operator may want plaintext for one website credential and not the next.
// Every default is the safe answer, and an explicit per-item or per-agent
// choice always outranks the switch.
function behaviourSettings(state) {
  const settings = state?.settings ?? {}
  return {
    webPlaintext: settings.webPlaintext === true,
    unclassifiedPlaintext: settings.unclassifiedPlaintext === true,
    useAnyTarget: settings.useAnyTarget === true,
  }
}

function requireClassification(state) {
  // Only consulted for a no-approval item, where nobody is asked. Off by default:
  // classification is metadata now, and an unclassified item being refused after
  // an explicit approval is what made this model feel backwards.
  return state?.settings?.requireClassification === true
}
// How long a fill authorization stays valid. Kept short on purpose: the
// execution layer redeems it immediately.
function fillAuthTtlMs(env) {
  const configured = Number(env.FILL_AUTH_TTL_MS ?? 0)
  if (Number.isFinite(configured) && configured > 0) return Math.min(15 * 60 * 1000, configured)
  return 10 * 60 * 1000
}
// ── Web fill task control plane (P3.0) ────────────────────────────────────
// A task is the unit of work an execution layer performs. The lifecycle is
// created -> authorized -> claimed -> running -> completed, with denied,
// expired, cancelled and failed as the other terminal states.
//
// Every transition is validated here and applied inside a Durable Object
// transaction, so two executors can never claim the same task and a task can
// never move backwards.
const FILL_TASK_STATES = new Set(['created', 'authorized', 'claimed', 'running', 'completed', 'denied', 'expired', 'cancelled', 'failed'])
// The states a task may move to from the current one. A state that is not
// listed here can never be entered.
const FILL_TASK_TRANSITIONS = {
  created: ['authorized', 'denied', 'cancelled', 'expired', 'failed'],
  authorized: ['claimed', 'denied', 'cancelled', 'expired', 'failed'],
  claimed: ['running', 'cancelled', 'expired', 'failed'],
  running: ['completed', 'cancelled', 'expired', 'failed'],
  completed: [],
  denied: [],
  expired: [],
  cancelled: [],
  failed: [],
}
// A terminal state can never be reactivated.
const FILL_TASK_TERMINAL = new Set(['completed', 'denied', 'expired', 'cancelled', 'failed'])
// How long a task may stay in a non-terminal state before it is expired.
const FILL_TASK_TIMEOUT_MS = {
  created: 5 * 60 * 1000,
  authorized: 10 * 60 * 1000,
  claimed: 10 * 60 * 1000,
  running: 5 * 60 * 1000,
}
// A task credential is short lived and bound to one task and one executor.
const FILL_TASK_CREDENTIAL_TTL_MS = 5 * 60 * 1000

// The scope of a task. Every field is bound into the task credential, so a
// credential cannot be used for a different item, account, origin or action.
function taskScope(task) {
  return [
    task.taskId, task.executorId, task.accountId, task.agent,
    task.cipherId, task.origin, task.action, task.policyRevision,
  ].map((value) => String(value ?? ''))
}

// The signed part of a task credential. The nonce and the expiry are inside
// the signature, so neither can be changed.
function taskCredentialPayload(task, nonce, expiresAt) {
  return JSON.stringify({
    s: taskScope(task),
    n: nonce,
    e: expiresAt,
  })
}

// A task credential is HMAC signed with the task key. The key never leaves
// the Worker secret store and is never handed to an Agent.
async function signTaskCredential(env, task, nonce, expiresAt) {
  const key = await taskSigningKey(env)
  const payload = encoder.encode(taskCredentialPayload(task, nonce, expiresAt))
  const signature = await hmacSha256(key, payload)
  return base64Url(signature) + '.' + base64Url(payload)
}

// Verify a task credential and return the parsed scope, or null.
async function verifyTaskCredential(env, token, task) {
  if (!token || typeof token !== 'string') return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const signature = token.slice(0, dot)
  const payload = token.slice(dot + 1)
  let decoded
  try { decoded = JSON.parse(decoder.decode(base64UrlDecode(payload))) } catch { return null }
  if (!decoded || !Array.isArray(decoded.s)) return null
  if (!Number.isFinite(Number(decoded.e)) || Number(decoded.e) < Date.now()) return null
  if (!String(decoded.n ?? '')) return null
  const expected = await hmacSha256(await taskSigningKey(env), encoder.encode(taskCredentialPayload(task, decoded.n, Number(decoded.e))))
  if (!constantTimeEqual(encoder.encode(base64Url(expected)), encoder.encode(signature))) return null
  if (!decoded.s.every((value, index) => value === taskScope(task)[index])) return null
  return decoded
}

// Decode a base64url string. atob only understands the standard alphabet, so
// the url-safe characters are mapped back first.
function base64UrlDecode(text) {
  const normalized = String(text).replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return b64ToBytes(padded)
}
// The key that signs task credentials. It is a Worker secret and is never
// sent to an Agent or an executor.
async function taskSigningKey(env) {
  const raw = String(env.FILL_TASK_SIGNING_KEY ?? '')
  if (!raw) throw new Error('FILL_TASK_SIGNING_KEY is not configured')
  return b64ToBytes(raw)
}

// The identity of an execution layer. A registered executor holds a secret
// that is shown once; only its hash is stored, so a state dump cannot
// impersonate an executor. This mirrors how Agent tokens are handled.
function executorAuthOk(state, executorId, presented) {
  const record = state.fillExecutors?.[executorId]
  if (!record || record.revokedAt) return false
  return constantTimeEqual(encoder.encode(record.hash), encoder.encode(presented))
}

// ── Rate limiting and concurrency caps ─────────────────────────────────────
// The counters live in the main state, so they are updated through the same
// compare-and-swap writer as everything else and survive a restart.
const FILL_RATE_LIMITS = {
  // tasks created per agent per minute
  agentTasksPerMinute: 30,
  // tasks that may be open at once for one account
  accountConcurrent: 10,
  // tasks that may be open at once for one credential
  credentialConcurrent: 3,
  // claims and redemptions per executor per minute
  executorOpsPerMinute: 120,
  // how often a failed task may be retried
  maxRetries: 3,
}

// The counter lives in the main state, so it is written through the same
// compare-and-swap writer as everything else and survives a restart.
// Returns null when the action is allowed, otherwise the reason.
async function fillRateLimited(env, key, limit, windowMs) {
  let reason = null
  await updateState(env, (state) => {
    const now = Date.now()
    state.fillRateCounters ??= {}
    // Counters are keyed by executor, account and credential, so the map only
    // grows while new keys keep arriving. Drop the ones whose window has passed.
    for (const [oldKey, oldEntry] of Object.entries(state.fillRateCounters)) {
      if (now - (oldEntry?.startedAt ?? 0) > Math.max(windowMs, 60000)) delete state.fillRateCounters[oldKey]
    }
    const entry = state.fillRateCounters[key]
    if (!entry || now - entry.startedAt > windowMs) {
      state.fillRateCounters[key] = { count: 1, startedAt: now }
      return state
    }
    entry.count += 1
    if (entry.count > limit) reason = 'rate-limited'
    return state
  })
  return reason
}
// Count the tasks that are still open for a given key. A task that has been
// told to cancel no longer holds a slot: the executor is winding it down and
// it must not block the queue.
async function countOpenTasks(env, predicate) {
  const response = await stateStub(env).fetch('https://state/fill/task/list', { method: 'POST', body: JSON.stringify({}) })
  const payload = await response.json()
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : []
  return tasks.filter((task) => !FILL_TASK_TERMINAL.has(task.state) && task.cancelRequested !== true && predicate(task)).length
}

// Cancel the open tasks that depend on a policy change, a revoked credential
// or a locked vault. The tasks are marked cancel-requested so the executor
// stops at its next checkpoint; the broker does not claim they are already
// stopped.
async function cancelTasksFor(env, predicate, reason) {
  const response = await stateStub(env).fetch('https://state/fill/task/list', { method: 'POST', body: JSON.stringify({}) })
  const payload = await response.json()
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : []
  const affected = []
  for (const task of tasks) {
    if (FILL_TASK_TERMINAL.has(task.state)) continue
    if (!predicate(task)) continue
    const res = await stateStub(env).fetch('https://state/fill/task/request-cancel', {
      method: 'POST',
      body: JSON.stringify({ taskId: task.taskId }),
    })
    const outcome = await res.json()
    if (outcome?.ok) affected.push(task.taskId)
  }
  if (affected.length) await addAudit(env, { event: 'fill.task.bulk-cancel', reason, count: affected.length })
  return affected
}

// ── Worker side: task control plane endpoints ─────────────────────────────
// The execution layer is identified by a registered executor secret, and
// every task it works on is authorised by a separate short lived task
// credential. The two are verified independently.
async function registerFillExecutor(env, body) {
  const executorId = String(body.executorId ?? '').trim()
  if (!executorId || !/^[A-Za-z0-9._-]{3,64}$/.test(executorId)) return { ok: false, reason: 'invalid-executor-id' }
  const secret = randomToken() + randomToken()
  const hash = await sha256Base64(secret)
  await updateState(env, (state) => {
    state.fillExecutors ??= {}
    state.fillExecutors[executorId] = { executorId, hash, createdAt: nowIso(), revokedAt: null, revokedBy: null }
    return state
  })
  await addAudit(env, { event: 'fill.executor.register', executor: executorId })
  // The secret is shown once and is never stored in plain form.
  return { ok: true, executorId, secret }
}

// Resolve the executor identity from the request. The secret is compared as
// a hash, so a state dump cannot be replayed as a credential.
async function resolveFillExecutor(env, request) {
  const executorId = String(request.headers.get('x-fill-executor-id') ?? '')
  const secret = String(request.headers.get('x-fill-executor-secret') ?? '')
  if (!executorId || !secret) return null
  const state = await loadState(env)
  if (!executorAuthOk(state, executorId, await sha256Base64(secret))) return null
  return { executorId, state }
}

// Create a task for a credential. The task carries the full scope so the
// credential that unlocks it is bound to exactly this work.
async function createFillTask(env, { agent, accountId, cipherId, itemName, origin, action, policyRevision, executorId }) {
  const taskId = 't_' + base64Url(crypto.getRandomValues(new Uint8Array(18)))
  const now = Date.now()
  const task = {
    taskId, executorId, agent, accountId, cipherId, itemName, origin, action,
    policyRevision, state: 'authorized', createdAt: now, updatedAt: now,
    expiresAt: now + FILL_TASK_TIMEOUT_MS.authorized,
    claimedBy: '', claimedAt: 0, cancelRequested: false,
  }
  const response = await stateStub(env).fetch('https://state/fill/task/store', {
    method: 'POST',
    body: JSON.stringify({ task }),
  })
  const stored = await response.json()
  if (!stored?.ok) return { ok: false, reason: stored?.reason ?? 'store-failed' }
  return { ok: true, task }
}

// ── Fill authorization ledger ─────────────────────────────────────────────
// Stored under its own top-level key so the main state shape is untouched.
// The DO transaction is the only place an authorization can be redeemed, so a
// replayed nonce or a concurrent second request cannot both succeed.
async function issueFillAuthorization(env, { nonce, agent, itemId, itemName, accountId, origin, action, ttlMs, policyRevision }) {
  const now = Date.now()
  const expiresAt = now + ttlMs
  const record = { nonce, agent, itemId, itemName: itemName ?? '', accountId, origin, action, policyRevision: policyRevision ?? '', issuedAt: now, expiresAt, consumedAt: 0 }
  const response = await stateStub(env).fetch('https://state/fill/issue', {
    method: 'POST',
    body: JSON.stringify({ record }),
  })
  return response.json()
}

// Redeem exactly once. Returns the binding so the execution layer can check
// that the origin it is about to fill matches the authorized one.
async function consumeFillAuthorization(env, { nonce, agent, itemId, accountId, origin }) {
  const response = await stateStub(env).fetch('https://state/fill/consume', {
    method: 'POST',
    body: JSON.stringify({ nonce, agent, itemId, accountId, origin }),
  })
  return response.json()
}

// The execution layer must present a credential that is NOT the Agent token.
// It is configured separately and is never handed to an Agent.
function executionLayerAuthorized(env, request) {
  const expected = String(env.FILL_EXECUTION_TOKEN ?? '')
  if (!expected) return false
  const header = request.headers.get('x-fill-execution-token') ?? ''
  return constantTimeEqual(encoder.encode(expected), encoder.encode(header))
}
// ── Agent Live Globe: event capture ────────────────────────────────────────
// Records where an *authenticated Agent* reached this broker from. Never stores
// or returns a raw IP, token, cookie, secret value or sensitive URL parameter.
// Any failure here is swallowed so capture can never affect authorization.
const GEO_ENABLED = (env) => String(env?.GEO_ENABLED ?? '0') === '1'

function geoFromRequest(request) {
  const cf = (request && request.cf) || null
  // Country/city/coords come from Cloudflare's IP geolocation. When the runtime
  // does not provide them we record an explicit unknown rather than inventing
  // coordinates. CF-RAY identifies the serving colo, NOT the caller, so it is
  // never used as a location.
  const country = cf && typeof cf.country === 'string' && cf.country.trim() ? cf.country.trim().toUpperCase().slice(0, 2) : ''
  const city = cf && typeof cf.city === 'string' ? cf.city.trim().slice(0, 64) : ''
  const asn = cf && Number.isFinite(Number(cf.asn)) ? Number(cf.asn) : null
  const lat = cf && Number.isFinite(Number(cf.latitude)) ? Number(cf.latitude) : null
  const lon = cf && Number.isFinite(Number(cf.longitude)) ? Number(cf.longitude) : null
  const valid = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)
  if (!country && !valid) return { known: false, country: '', city: '', asn, lat: null, lon: null }
  return {
    known: true,
    country,
    city,
    asn,
    // ~1km precision is plenty for a globe dot and avoids pinpointing.
    lat: valid ? Math.round(lat * 100) / 100 : null,
    lon: valid ? Math.round(lon * 100) / 100 : null,
  }
}

async function recordOperatorLocation(env, request) {
  if (!GEO_ENABLED(env)) return
  try {
    const geo = geoFromRequest(request)
    if (!geo.known) return
    await stateStub(env).fetch('https://state/geo/operator', { method: 'POST', body: JSON.stringify({ geo }) })
  } catch {}
}

async function recordGeoEvent(env, request, ctx, { agent, kind, action, ok }) {
  if (!GEO_ENABLED(env)) return
  try {
    if (!agent) return
    const geo = geoFromRequest(request)
    const event = {
      at: nowIso(),
      agent: String(agent).slice(0, 64),
      kind: kind === 'oauth' ? 'oauth' : 'token',
      action: String(action || '').slice(0, 40),
      ok: ok === true,
      geo,
    }
    await stateStub(env).fetch('https://state/geo/append', { method: 'POST', body: JSON.stringify({ event }) })
  } catch {
    // Capture is best-effort by design.
  }
}

async function consumeOidcState(env, cookieValue, returned) {
  const response = await stateStub(env).fetch('https://state/oidc/state/consume', { method: 'POST', body: JSON.stringify({ cookie: cookieValue, state: returned }) })
  return response.json()
}

async function consumeCapability(env, key, accountId, action) {
  const response = await stateStub(env).fetch('https://state/capability/consume', { method: 'POST', body: JSON.stringify({ key, accountId, action }) })
  return response.json()
}

// Ask the Durable Object to materialise a capability from persisted authority.
// Only identifiers cross the boundary; the DO derives expiry/uses/account from
// its own records, so nothing in this request can widen the grant.
async function ensureCapability(env, { subjectId, itemId, action, accountId, legacyName }) {
  const response = await stateStub(env).fetch('https://state/capability/ensure', { method: 'POST', body: JSON.stringify({ subjectId, itemId, action, accountId, legacyName }) })
  return response.json()
}

// Lazy migration: ONLY live approval state migrates — a valid legacy grant
// or a noApproval policy. A bare actionGrant (needs approval) must NOT
// synthesize a capability, otherwise the approval gate in agentAccess would
// see decision.capability and skip pending. Approvals write real temporary
// capabilities via decidePending; preapproved ones come from the admin API.
// Never auto-creates permanent-unlimited from allowAll.
function migrateLegacyCapability(state, { subjectId, accountId, itemId, itemName, action, createdBy, noApproval = false }) {
  const key = capabilityKey(subjectId, itemId, action)
  if (state.capabilities?.[key]) return state.capabilities[key]
  const oldGrant = state.grants?.[`${subjectId}\u0000${itemName}`] ?? null
  const oldAction = state.actionGrants?.[actionGrantKey(subjectId, itemId)] ?? null
  const actionAllowed = (oldAction?.actions ?? []).includes(action)
  // secret.use is NEVER synthesized from a legacy grant: it requires an
  // explicit admin-issued capability (action + usePolicy). Legacy grants
  // migrate to secret.read only; allow/groups/noApproval never imply use.
  if (action === 'secret.use' && !state.capabilities?.[key]) return null
  // noApproval alone is not an authority source: it must be backed by a
  // persisted actionGrant for secret.read on this exact subject/item
  // (mirrors the DO-side rule so both sides agree).
  if (!oldGrant && !(actionAllowed && noApproval)) return null
  // Validate the legacy source before migrating: revoked/expired/exhausted
  // legacy grants must NOT resurrect as capabilities.
  if (oldGrant) {
    if (oldGrant.revokedAt) return null
    if (oldGrant.expiresAt && oldGrant.expiresAt < Date.now()) return null
    if (oldGrant.maxReads != null && (oldGrant.reads ?? 0) >= oldGrant.maxReads) return null
    if (accountId && oldGrant.account && oldGrant.account.toLowerCase() !== String(accountId).toLowerCase()) return null
  }
  if (oldAction && accountId && oldAction.accountId && oldAction.accountId.toLowerCase() !== String(accountId).toLowerCase()) return null
  const now = Date.now()
  const cap = {
    id: key, subjectId, accountId: oldAction?.accountId ?? oldGrant?.account ?? accountId ?? '',
    itemId, itemName: itemName ?? oldAction?.itemName ?? '', action,
    mode: 'preapproved', createdAt: new Date(now).toISOString(), createdBy: createdBy ?? 'legacy-migration',
    expiresAt: oldGrant?.expiresAt ? oldGrant.expiresAt : null,
    maxUses: oldGrant?.maxReads ?? null, usedCount: oldGrant?.reads ?? 0,
    revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1,
  }
  // NOTE: deliberately do NOT write to state.capabilities here. The caller
  // persists through /capability/ensure so migration and the first consume
  // share one serialized storage boundary (no in-memory-only capability and
  // no lost update between two concurrent migrations).
  cap.__pendingMigration = true
  return cap
}

async function consumeGrant(env, agent, name) {
  const response = await stateStub(env).fetch('https://state/grant/consume', { method: 'POST', body: JSON.stringify({ agent, name }) })
  return response.json()
}

// Shared item/group scope predicate for reads AND writes. allowAll only applies
// when the agent has no explicit allow/groups scope. Exported for unit tests;
// the save handler and agentAccess use the same rule.
export function agentInScope(agent, itemGroups, targetName, groupOverride) {
  const group = groupOverride !== undefined ? groupOverride : (itemGroups?.[targetName] ?? '')
  const allow = agent.allow ?? []
  const groups = agent.groups ?? []
  if (allow.length === 0 && groups.length === 0) return agent.allowAll === true
  return allow.includes(targetName) || (group !== '' && groups.includes(group))
}

// ── Phase-1 hybrid permission model ────────────────────────────────────────
// secret.read and secret.use are independent actions. secret.read returns
// plaintext; secret.use only lets the broker inject and execute. Neither
// implies the other.
const SECRET_ACTIONS = new Set(['secret.read', 'secret.use', 'secret.fill', 'secret.materialize'])

// ── Unified capability model (read/use share one authority) ───────────────
// A capability is the SOLE authority for secret.read / secret.use grants:
// key = subjectId + itemId + action. Legacy `state.grants` (approval temp
// state) and `state.actionGrants` (permanent, no expiry/uses) are lazily
// migrated into capabilities on first hit; their old counters are never
// consulted again, so no double-counting path exists.
// expiresAt: null = permanent (never use magic timestamps).
// maxUses: null = unlimited (still bound by expiry/revoke/scope/target).
const CAPABILITY_DURATIONS = { '1d': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3, permanent: null }
const CAPABILITY_MODES = new Set(['preapproved', 'temporary'])

function capabilityKey(subjectId, itemId, action) { return `${subjectId}\u0000${itemId}\u0000${action}` }

// A capability account must be a concrete vault identity. Blank, whitespace or
// obviously malformed values are rejected so no account-agnostic capability can
// ever be minted (the consume gate skips the account check when it is empty).
const ACCOUNT_ID_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isWellFormedAccountId(value) {
  return typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value.trim())
}

export function capabilityStatus(cap, now = Date.now()) {
  if (!cap) return 'missing'
  if (cap.revokedAt) return 'revoked'
  if (cap.expiresAt != null && cap.expiresAt <= now) return 'expired'
  if (cap.maxUses != null && (cap.usedCount ?? 0) >= cap.maxUses) return 'exhausted'
  if (cap.expiresAt != null && cap.expiresAt - now <= 24 * 3600e3) return 'expiring'
  return 'valid'
}

function actionGrantKey(subjectId, itemId) { return `${subjectId}\u0000${itemId}` }

export function actionGrantFor(state, subjectId, itemId) {
  return state.actionGrants?.[actionGrantKey(subjectId, itemId)] ?? null
}

function usePolicyFor(state, itemId, accountId) {
  const policy = state.usePolicies?.[itemId] ?? null
  // useAnyTarget is the operator's standing answer to "which hosts may this be
  // used against": any. Reading it here keeps one authority for the target
  // question — the approval gate and the capability path cannot disagree, which
  // is what left an approved request permanently denied.
  if (!policy && behaviourSettings(state).useAnyTarget) return { itemId, anyTarget: true }
  if (!policy) return null
  if (policy.accountId && accountId && String(policy.accountId).toLowerCase() !== String(accountId).toLowerCase()) return null
  return policy
}

function targetAllowed(policy, target) {
  if (!policy || !target) return false
  // The whole point of the switch: no host list to consult.
  if (policy.anyTarget) return true
  const host = String(target.host ?? '').toLowerCase().replace(/\.$/, '')
  const port = String(target.port ?? '443')
  const method = String(target.method ?? 'GET').toUpperCase()
  const pathname = String(target.pathname ?? '/')
  const hosts = (policy.hosts ?? []).map((v) => String(v).toLowerCase().replace(/\.$/, ''))
  // '*' is an explicit "no host restriction" chosen in the console. It is a
  // literal entry, not a pattern: nothing widens by accident.
  if (!hosts.includes('*') && !hosts.includes(host)) return false
  if (!(policy.methods ?? []).map((v) => String(v).toUpperCase()).includes(method)) return false
  if ((policy.ports ?? ['443']).map(String).includes(port) === false) return false
  const prefixes = policy.pathPrefixes ?? []
  if (prefixes.length > 0 && !prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'))) return false
  return true
}

/**
 * The target shape the use policy and the approval binding both compare.
 *
 * One helper so the enforcement path and explain_access cannot describe the
 * same request differently. Returns null when the URL is not a URL.
 */
export function useTargetOf(rawUrl, method = 'GET') {
  let parsed
  try { parsed = new URL(String(rawUrl ?? '')) } catch { return null }
  return {
    host: parsed.hostname.toLowerCase().replace(/\.$/, ''),
    port: String(parsed.port || '443'),
    method: String(method ?? 'GET').trim().toUpperCase(),
    pathname: parsed.pathname || '/',
    origin: parsed.origin,
  }
}

/**
 * Unified authorization for secret.read / secret.use.
 *
 * Returns { ok, reason, legacy, shadow? }. Never returns secret material.
 *
 * secret.read:
 *   - explicit actionGrants containing secret.read → allow
 *   - legacy agent + old agentInScope → allow (marked legacy)
 *   - otherwise deny
 *
 * secret.use:
 *   - explicit actionGrants containing secret.use AND a matching usePolicy
 *   - legacy fallback is deliberately NOT accepted
 */
export function authorizeSecretAction(state, { agent, agentName, itemId, itemName, action, target, accountId }) {
  if (!SECRET_ACTIONS.has(action)) return { ok: false, reason: 'unknown-action' }
  if (!itemId) return { ok: false, reason: 'no-item-id' }
  const subjectId = agentName
  const key = capabilityKey(subjectId, itemId, action)
  let cap = state.capabilities?.[key] ?? null
  if (!cap) cap = migrateLegacyCapability(state, { subjectId, accountId, itemId, itemName, action, createdBy: 'legacy-migration', noApproval: state.policies?.[itemName]?.noApproval === true })
  const sameAccount = !cap || !cap.accountId || !accountId || String(cap.accountId).toLowerCase() === String(accountId).toLowerCase()
  const legacyScope = Boolean(agent?.legacy) && agentInScope(agent, state.itemGroups, itemName)
  const legacyDecision = action === 'secret.read' && legacyScope
  let ok = false
  let reason = 'no-capability'
  if (cap && sameAccount) {
    // Capability is the authority for expiry/uses/revoke; status here is a
    // pre-check only — the atomic consume at execution time is decisive.
    const status = capabilityStatus(cap)
    if (status !== 'valid' && status !== 'expiring') { ok = false; reason = status }
    else if (action === 'secret.read') { ok = true; reason = 'capability' }
    else if (action === 'secret.fill') {
      // The fill policy is the authority for the target origin. Without a
      // policy the request is not approvable, it is a hard deny.
      const fill = fillPolicyFor(state, itemId, target?.origin ?? '')
      if (!fill.ok) { ok = false; reason = fill.reason }
      else if (!fill.actions.includes(String(target?.action ?? 'login'))) { ok = false; reason = 'action-not-allowed' }
      else if (Array.isArray(cap.targets) && target?.origin && !cap.targets.includes(target.origin)) { ok = false; reason = 'target-not-approved' }
      else { ok = true; reason = 'capability' }
    }
    else {
      const policy = usePolicyFor(state, itemId, accountId)
      if (!policy) { ok = false; reason = 'no-use-policy' }
      else if (!targetAllowed(policy, target)) { ok = false; reason = 'target-denied' }
      // The approval named one site. Another site the policy happens to allow
      // is a new question, not an inherited right.
      else if (Array.isArray(cap.targets) && target?.origin && !cap.targets.includes(target.origin)) { ok = false; reason = 'target-not-approved' }
      else { ok = true; reason = 'capability' }
    }
  } else if (legacyDecision && !cap) {
    // Compatibility: legacy agents keep secret.read ONLY when no capability
    // exists for this (subject, item, action). Once a capability exists —
    // valid, expired, revoked or exhausted — its verdict is final and the
    // legacy path must not resurrect access.
    ok = true
    reason = 'legacy-scope'
  }
  // A capability that exists but is not usable is DECISIVE: no caller may
  // fall through to the approval gate, a legacy grant, or the legacy scope
  // path. Account mismatch counts as decisive too (cross-account attempt).
  const targetNotApproved = reason === 'target-not-approved'
  const capabilityDecisive = Boolean(cap) && (reason !== 'capability') && !targetNotApproved
  if (capabilityDecisive) { ok = false; if (!reason || reason === 'no-capability') reason = capabilityStatus(cap) }
  // Capability-eligible but not yet issued (actionGrant without approval
  // state): the approval gate in agentAccess must see this as pending, not
  // as a hard deny — EXCEPT target-policy violations, which stay hard denies
  // so mis-scoped use can never be approved into existence.
  const grant = actionGrantFor(state, subjectId, itemId)
  let grantEligible = Boolean(grant && (grant.actions ?? []).includes(action)
    && (!grant.accountId || !accountId || String(grant.accountId).toLowerCase() === String(accountId).toLowerCase()))
  if (action === 'secret.materialize' && !cap && agentInScope(agent, state.itemGroups, itemName)) {
    // Writing a credential into a file is askable by any agent the operator has
    // put in scope, exactly like a read: the approval page is where the decision
    // is made. It never becomes a capability, so eligibility here buys nothing
    // more than the right to ask.
    grantEligible = true
    ok = false
    reason = 'awaiting-approval'
  }
  // Only when the capability did not already authorise this request: an approved,
  // in-policy use must not be rewritten into "waiting for approval" again, which
  // is what made an approved request impossible to ever satisfy.
  if (!ok && grantEligible && !capabilityDecisive && action === 'secret.use') {
    // One authority for the target question: usePolicyFor reads the switch and
    // targetAllowed honours it, so the approval gate and the capability path
    // cannot disagree about whether a host was allowed.
    const policy = usePolicyFor(state, itemId, accountId)
    if (!policy) { ok = false; reason = 'no-use-policy'; grantEligible = false }
    else if (!targetAllowed(policy, target)) { ok = false; reason = 'target-denied'; grantEligible = false }
    else { ok = false; reason = 'awaiting-approval' }
  }
  if (grantEligible && action === 'secret.fill') {
    // An action grant exists but the operator has not approved this fill yet.
    // The target origin must already satisfy the fill policy, otherwise the
    // request is a hard deny and can never be approved into existence.
    const fill = fillPolicyFor(state, itemId, target?.origin ?? '')
    if (!fill.ok) { ok = false; reason = fill.reason; grantEligible = false }
    else if (!fill.actions.includes(String(target?.action ?? 'login'))) { ok = false; reason = 'action-not-allowed'; grantEligible = false }
    else { ok = false; reason = 'awaiting-approval' }
  }
  return { ok, reason, legacy: legacyDecision, grant: null, capability: cap, capabilityKey: key, grantEligible, capabilityDecisive, targetNotApproved }
}

// A refusal that only says "not allowed" costs the Agent (and the operator) a
// round of guessing: is it the kind, the account, a missing grant, or a target
// that was never allowed? This answers that with the same authorities the real
// path uses, and never reads the value.
async function explainAccess(env, { resolved, session, name, action, origin = '', url = '' }) {
  if (!name) return { error: 'name is required' }
  if (!SECRET_ACTIONS.has(action)) return { error: 'unknown action: ' + action, actions: [...SECRET_ACTIONS] }
  const state = await loadState(env)
  const accountId = session?.email ?? ''
  const itemId = state.itemIds?.[name] ?? await resolveItemId(env, env.NODEWARDEN_DB, session, name)
  const itemName = name
  if (!itemId) {
    return {
      item: itemName, action, decision: 'deny',
      reasons: ['当前账户里没有这个条目（名字必须与面板上完全一致）'],
      suggestions: ['list_secrets 看一遍可用的名字'],
    }
  }
  const kind = state.credentialKinds?.[itemId] ?? ''
  const policy = state.policies?.[itemName] ?? null
  const cap = state.capabilities?.[capabilityKey(resolved.name, itemId, action)] ?? null
  const status = capabilityStatus(cap)
  const target = action === 'secret.fill' ? { origin } : action === 'secret.use' && url ? useTargetOf(url) : null
  const decision = authorizeSecretAction(state, { agent: resolved.agent, agentName: resolved.name, itemId, itemName, action, target, accountId })
  const guard = plaintextReadAllowed(state, itemId, { agent: resolved.name, noApproval: policy?.noApproval === true, granted: cap && status !== 'revoked' ? { subject: resolved.name, accountId } : null })
  const reasons = []
  const suggestions = []
  if (kind === 'web') reasons.push('这是网页登录，只能填充到白名单站点，不能取明文')
  else if (!kind) reasons.push('还没有分类（未分类条目默认不给明文）')
  else reasons.push('分类：' + kind + '（可以取明文）')
  if (policy?.noApproval === true) reasons.push('已设为免审批：in-scope 的 Agent 读它不用问')
  if (cap) reasons.push('能力：' + ({ valid: '有效', expiring: '有效（24 小时内到期）', expired: '已过期', revoked: '已撤销', exhausted: '次数已用完', missing: '无' })[status] + (cap.expiresAt ? '，到期 ' + new Date(cap.expiresAt).toISOString() : '') + (cap.maxUses != null ? '，已用 ' + (cap.usedCount ?? 0) + '/' + cap.maxUses : ''))
  else reasons.push('能力：无')
  if (cap?.targets?.length) reasons.push('已批准的目标：' + cap.targets.join('、'))
  if (decision.targetNotApproved) reasons.push('这次的目标 ' + (target?.origin ?? '') + ' 没有批准过；每次批准只管它当时写明的站点')
  if (decision.ok) reasons.push('判定：放行（' + decision.reason + '）')
  else if (decision.grantEligible) reasons.push('判定：需要你批准（' + decision.reason + '）')
  else reasons.push('判定：拒绝（' + decision.reason + '）')
  if (action === 'secret.read' && !guard.ok) reasons.push('明文读取限制：' + guard.reason)
  if (action === 'secret.fill') {
    const fill = fillPolicyFor(state, itemId, origin)
    if (!fill.ok) reasons.push('填充策略：' + fill.reason)
    else reasons.push('填充策略：允许 ' + fill.origins.join('、') + '（动作 ' + fill.actions.join('/') + '）')
  }
  if (action === 'secret.use') {
    const use = usePolicyFor(state, itemId, accountId)
    if (!use) reasons.push('调用策略：没有配置（secret.use 需要逐条目站点白名单）')
    else reasons.push('调用策略：' + (use.anyTarget ? '任意站点（经审批）' : (use.origins ?? []).join('、')))
  }
  if (resolved.agent?.account && accountId && String(resolved.agent.account).toLowerCase() !== String(accountId).toLowerCase()) reasons.push('这个 Agent 绑定的是另一个 vault 账户')
  if (decision.ok) suggestions.push(action === 'secret.read' ? 'get_secret / get_credential 取用' : action === 'secret.fill' ? 'request_fill' : 'http_request')
  else if (decision.grantEligible) suggestions.push('request_access 发起申请，等审批页批准后重试')
  else if (kind === 'web') suggestions.push('request_fill（让浏览器执行器填进允许的站点）')
  else if (status === 'expired' || status === 'revoked' || status === 'exhausted') suggestions.push('让操作员在面板里重新授权这个条目')
  else suggestions.push('让操作员在「动作授权」里给这个条目加上 ' + action + '，或在同意页勾上「允许读取明文」')
  return {
    item: itemName, itemId, action,
    kind: kind || 'unclassified',
    account: cap?.accountId || accountId,
    decision: decision.ok ? 'allow' : decision.grantEligible ? 'needs-approval' : 'deny',
    reason: decision.reason,
    reasons,
    suggestions,
  }
}

function shadowAudit(env, state, action, agentName, itemName, itemId, newDecision, legacyDecision) {
  if (state.settings?.shadowPolicy !== true && env.POLICY_SHADOW !== '1') return
  if (newDecision === legacyDecision) return
  // Never include values, usernames, TOTP, request bodies or headers.
  addAudit(env, {
    event: 'policy.shadow-mismatch',
    action,
    agent: agentName,
    name: itemName,
    itemId: itemId ?? '',
    new: newDecision ? 'allow' : 'deny',
    legacy: legacyDecision ? 'allow' : 'deny',
  }).catch(() => {})
}

function itemIdByName(state, name) {
  return state.itemIds?.[name] ?? ''
}

// Resolve a stable NodeWarden cipher id for an item name. Used by the hybrid
// action model, which binds grants to itemId rather than a renameable name.
async function resolveItemId(env, db, session, name) {
  const found = await findCipherRow(env, db, session, name)
  const id = found?.row?.id ?? ''
  // Record the binding. The admin UI reverse-maps a classification from its id
  // back to a name, so an id resolved here and never cached makes a credential
  // the operator just classified keep showing as unclassified.
  if (id) await updateState(env, (next) => { next.itemIds ??= {}; next.itemIds[name] = id; return next })
  return id
}

// The cipher id for a name, resolved from the live vault when the cache has no
// entry. A share written without an id is a legacy grant with no identity
// binding, which the read path then refuses as 'unbound-legacy-identity' — the
// operator has to re-grant an authorisation they just created. Resolving here
// keeps new shares bound from the start.
async function ensureItemId(env, db, session, name) {
  const state = await loadState(env)
  const cached = state.itemIds?.[name]
  if (cached) return cached
  const resolved = await resolveItemId(env, db, session, name)
  if (resolved) await updateState(env, (next) => { next.itemIds ??= {}; next.itemIds[name] = resolved; return next })
  return resolved
}


// The agent-facing vocabulary for an access decision. It names the state, not
// the internals, and never carries a credential or another account's details.
function accessStatusLabel(access) {
  if (access.status === 'allowed') return { status: 'allowed', message: 'access already allowed; use get_secret' }
  if (access.status === 'pending') return { status: 'pending', message: 'pending approval: ' + access.approvalUrl }
  const reason = String(access.reason ?? '')
  if (reason === 'unbound-legacy-identity') {
    return { status: 'identity-unbound', message: 'the existing authorisation is not bound to a credential id; an administrator must re-grant it' }
  }
  if (reason === 'revoked' || reason === 'legacy-revoked') {
    return { status: 'revoked', message: 'the authorisation was revoked' }
  }
  if (reason === 'read-forbidden-by-kind') {
    return { status: 'read-forbidden-by-kind', message: 'this credential is classified as a website login and can only be filled in, not read' }
  }
  if (reason === 'unclassified-credential') {
    return { status: 'unclassified-credential', message: 'this credential has not been classified, so plaintext reads are refused; an administrator must mark it as api (and allow reads) or web' }
  }
  if (reason === 'expired' || reason === 'legacy-expired') {
    return { status: 'expired', message: 'the authorisation has expired' }
  }
  if (reason === 'exhausted' || reason === 'legacy-exhausted') {
    return { status: 'exhausted', message: 'the authorisation has no uses left' }
  }
  if (reason === 'account-mismatch' || reason === 'legacy-cross-account') {
    return { status: 'account-mismatch', message: 'the authorisation belongs to a different account' }
  }
  if (reason === 'item-id-unresolved') {
    return { status: 'identity-unbound', message: 'the credential id could not be resolved; an administrator must re-grant it' }
  }
  if (reason === 'no-plaintext-read-policy') {
    return { status: 'read-forbidden-by-kind', message: 'plaintext reads are not enabled for this credential' }
  }
  return { status: 'forbidden', message: access.error ?? 'access denied' }
}

async function agentAccess(env, { session, agentName, agent, state, name, origin, ctx, consumeRead = true, action = 'secret.read', target = null }) {
  if (agent.account && session.email && String(agent.account).toLowerCase() !== String(session.email).toLowerCase()) return { status: 'forbidden', error: 'agent is bound to another vault account' }
  // Legacy scope is only a fallback for secret.read; it must not pre-block an
  // explicit action grant (e.g. a new agent granted secret.use on one item).
  if (agent.legacy && !agentInScope(agent, state.itemGroups, name)) {
    // Keep going: authorizeSecretAction decides whether an action grant applies.
  }
  // Hybrid action check. Legacy agents keep secret.read; secret.use always
  // requires an explicit action grant + per-item target policy.
  if (!state.itemIds?.[name]) {
    const resolved = await resolveItemId(env, env.NODEWARDEN_DB, session, name)
    if (resolved) { state.itemIds ??= {}; state.itemIds[name] = resolved }
  }
  const itemId = state.itemIds?.[name] ?? ''
  const decision = authorizeSecretAction(state, { agent, agentName, itemId, itemName: name, action, target, accountId: session.email })
  shadowAudit(env, state, action, agentName, name, itemId, decision.ok, decision.legacy)
  // A live capability that covers another site is not a grant and not a
  // refusal: it is a new question about this one, so the approval gate below
  // must run with the capability suppressed.
  const needsTargetApproval = decision.targetNotApproved === true
  if (!decision.ok) {
    if (decision.reason === 'no-use-policy' || decision.reason === 'target-denied') return { status: 'forbidden', error: `secret.use denied: ${decision.reason}` }
    // A capability that exists but is expired/revoked/exhausted/cross-account
    // is decisive. Never fall through to approval, legacy grants or legacy
    // scope — that would resurrect access the operator already withdrew.
    if (decision.capabilityDecisive) return { status: 'forbidden', error: `capability ${decision.reason}: access denied`, reason: decision.reason }
    // A no-approval item is a standing yes for an Agent that is already in
    // scope: it clears the capability requirement, the approval prompt, the
    // classification check and the plaintext policy in one step. Scope is still
    // required — "免审批" means "don't ask me again", not "any Agent may read
    // this". A revoked/expired capability was already returned as decisive.
    const noApprovalInScope = action === 'secret.read' && state.policies?.[name]?.noApproval === true
      && agentInScope(agent, state.itemGroups, name)
    // An active auto-approval rule is a deliberate "yes" from the operator for
    // this agent, time-boxed. It makes the request eligible, which is exactly
    // what pressing 批准 would do — the only difference is who answered.
    const autoRuleLive = autoRuleActive(state, agentName)
    if (!decision.grantEligible && !decision.legacy && !noApprovalInScope && !autoRuleLive) {
      const why = !itemId ? '当前账户里没有名为「' + name + '」的条目（名字必须与面板完全一致，空格也算）'
        : !agentInScope(agent, state.itemGroups, name) ? '该条目不在 Agent 的可读范围内'
        : '在可读范围内，但缺少这条授权'
      // Notify at most once per (agent, item, action) every 30 minutes. An Agent
      // that retries in a loop must not turn into a stream of push messages; the
      // console list still records every attempt with its count.
      const prior = state.deniedAttempts?.['deny\u0000' + agentName + '\u0000' + name + '\u0000' + action]
      const lastNotified = Number(prior?.notifiedAt ?? 0)
      const shouldNotify = Date.now() - lastNotified > 30 * 60 * 1000
      await updateState(env, (next) => {
        const key = 'deny\u0000' + agentName + '\u0000' + name + '\u0000' + action
        next.deniedAttempts ??= {}
        const before = next.deniedAttempts[key]
        next.deniedAttempts[key] = {
          agent: agentName, name, itemId, account: session.email, action, reason: why,
          origin: action === 'secret.use' ? String(target?.host ?? '') : '',
          count: (before?.count ?? 0) + 1, firstAt: before?.firstAt ?? nowIso(), lastAt: nowIso(),
          notifiedAt: shouldNotify ? Date.now() : (before?.notifiedAt ?? 0),
        }
        return next
      })
      await addAudit(env, { event: 'access.denied', agent: agentName, name, itemId, action, reason: why, source: 'agent' })
      if (shouldNotify) await notifyPending(env, origin, { id: 'deny-' + itemId, agent: agentName, name, createdAt: nowIso(), action, denied: true, reason: why }, ctx).catch(() => {})
      // Say which action was refused: "read" sent agents looking for a read
      // permission when the block was about calling the API with it.
      const verb = action === 'secret.use' ? 'use this credential (http_request)' : action === 'secret.fill' ? 'fill with this credential' : 'read this item'
      // The reason is in the message: the generic "run explain_access" line made
      // an agent investigate permissions when the name was simply misspelled.
      return { status: 'forbidden', code: !itemId ? 'not-found' : 'not-granted', error: 'agent not allowed to ' + verb + '：' + why, reason: 'not-granted' }
    }
  }
  const policy = state.policies?.[name]
  // Approval gate.
  //   secret.read: a noApproval item or a live legacy grant may satisfy it.
  //   secret.use : NEVER satisfied by a legacy read grant or by noApproval;
  //                it needs an explicit use capability (which only an
  //                approval or an admin pre-grant mints).
  const legacyGrant = action === 'secret.read' ? activeGrant(state, agentName, name) : null
  const noApprovalSatisfies = action === 'secret.read' && policy?.noApproval === true
  if (!noApprovalSatisfies && (!decision.capability || needsTargetApproval) && !legacyGrant) {
    let pendingId = findPending(state, agentName, name, action)
    if (!pendingId) {
      pendingId = crypto.randomUUID()
      // The pending request records the target origin so the approver can see
      // which site the credential would be filled into. A fill request without
      // an origin is never approvable.
      // fill and use both name a site, and the approval binds that site rather
      // than just the credential. An approval without an origin is a blank
      // cheque, so the origin is recorded for both and checked when it decides.
      const bindsTarget = action === 'secret.fill' || action === 'secret.use'
      const entry = { id: pendingId, agent: agentName, name, account: session.email, action, createdAt: nowIso(), targetOrigin: bindsTarget ? String(target?.origin ?? origin ?? '') : '', ...(action === 'secret.materialize' ? { target: { path: String(target?.path ?? ''), key: String(target?.key ?? '') } } : {}) }
      await updateState(env, (next) => { next.pending[pendingId] = entry; if (itemId) { next.itemIds ??= {}; next.itemIds[name] = itemId } return next })
      await addAudit(env, { event: 'request.create', agent: agentName, name })
      // An active auto-approval rule answers it now instead of asking. It is
      // time-boxed and audited with source 'auto-rule', so a grant made while
      // the operator was away is never indistinguishable from their own click.
      if (autoRuleActive(state, agentName)) {
        const auto = await decidePending(env, pendingId, 'once', 'auto-rule')
        await addAudit(env, { event: 'request.auto-approve', agent: agentName, name, action, source: 'auto-rule' })
        if (auto && !auto.denied && !auto.error) {
          await notifyPending(env, origin, { ...entry, autoApproved: true }, ctx).catch(() => {})
          // Fall through to the normal checks by re-reading the capability we
          // just minted: one call, one decision, no second approval prompt.
          const fresh = await loadState(env)
          const cap = fresh.capabilities?.[capabilityKey(agentName, itemId, action)]
          if (cap && !cap.revokedAt) {
            const consumed = await consumeCapability(env, capabilityKey(agentName, itemId, action), session.email, action)
            if (consumed?.ok) {
              if (action === 'secret.use') return { status: 'use-ok', itemId, url: (await readSecretFromRows(env, env.NODEWARDEN_DB, session, name))?.url ?? '' }
              // The auto rule just minted and consumed a capability, so this read
              // is granted: classification is not a second gate on it.
              const guard = plaintextReadAllowed(fresh, itemId, { agent: agentName, noApproval: fresh.policies?.[name]?.noApproval === true, granted: { subject: agentName, accountId: session.email } })
              if (guard.ok) {
                const result = await readSecretFromRows(env, env.NODEWARDEN_DB, session, name)
                if (result) {
                  await addAudit(env, { event: 'secret.read', agent: agentName, name, itemId, via: 'agent', source: 'auto-rule' })
                  return { status: 'allowed', itemId: result.id || itemId, value: result.value, url: result.url }
                }
              }
            }
          }
        }
      } else {
        await notifyPending(env, origin, entry, ctx)
      }
    }
    return { status: 'pending', requestId: pendingId, approvalUrl: `${origin}/#pending`, itemId, targetOrigin: String(target?.origin ?? '') }
  }
  // Unified atomic consume: capability is the sole counter. Checks passed
  // above; consume now, before decrypt/fetch, inside the DO transaction.
  // Failed upstream calls still count (no infinite failure-retry bypass).
  // Whenever a capability exists it is the sole counter — including for
  // legacy agents. The legacy path never skips consumption.
  if (decision.capability && !needsTargetApproval) {
    // The DO is the authority. A pending migration is materialised first so
    // the identity binding is proven: a legacy grant without one is refused
    // with 'unbound-legacy-identity' here, exactly as on the read path. This
    // runs for a status query too, so request_access cannot report access that
    // the real use would refuse.
    if (decision.capability.__pendingMigration) {
      const ensured = await ensureCapability(env, { subjectId: agentName, itemId, action, accountId: session.email, legacyName: name })
      if (!ensured?.ok) return { status: 'forbidden', error: 'capability migration rejected: ' + (ensured?.reason ?? 'unknown'), reason: ensured?.reason ?? 'migration-rejected' }
    }
    // The counter is only spent on a real use. A status check leaves the
    // capability exactly as it was.
    if (consumeRead) {
      const consumed = await consumeCapability(env, decision.capabilityKey, session.email, action)
      if (!consumed?.ok) return { status: 'forbidden', error: 'capability no longer valid: ' + (consumed?.reason ?? 'unknown'), reason: consumed?.reason ?? 'capability-invalid' }
    }
  } else if (legacyGrant && consumeRead) {
    const consumed = await consumeGrant(env, agentName, name)
    if (!consumed?.ok) return { status: 'forbidden', error: 'grant is no longer valid', reason: 'grant-invalid' }
  }
  if (action === 'secret.use') {
    // The caller (http_request) performs the fetch; this returns metadata only.
    return { status: 'use-ok', itemId, url: (await readSecretFromRows(env, env.NODEWARDEN_DB, session, name))?.url ?? '' }
  }
  if (action === 'secret.fill') {
    // Metadata only. The value never travels through this path: the execution
    // layer redeems the one-shot authorization for it, with its own token.
    await addAudit(env, { event: 'fill.approved', agent: agentName, name, origin: String(target?.origin ?? '') })
    return { status: 'fill-ok', itemId, origin: String(target?.origin ?? ''), action: String(target?.action ?? 'login') }
  }
  if (action === 'secret.materialize') {
    // Metadata only, and the path is re-validated here: an approval made while
    // a path was listed must stop working once the operator removes it.
    const dest = materializeTarget(state, target)
    if (!dest) return { status: 'forbidden', error: 'materialize target is not allowed', reason: 'target-not-allowed' }
    await addAudit(env, { event: 'materialize.approved', agent: agentName, name, path: dest.path, key: dest.key })
    return { status: 'materialize-ok', itemId, target: dest }
  }
  const result = await readSecretFromRows(env, env.NODEWARDEN_DB, session, name)
  if (!result) return { status: 'notfound', error: 'not found' }
  // The credential id comes from the row that was actually decrypted, so a
  // stale name->id cache can never point the guard at the wrong item.
  const resolvedItemId = result.id || itemId
  // The plaintext guard runs here, where the real id is known. A web
  // credential never reaches the caller; an api credential needs an explicit
  // read policy. An id that cannot be resolved is refused, not treated as
  // unclassified.
  const readGuard = plaintextReadAllowed(state, resolvedItemId, { agent: agentName, noApproval: policy?.noApproval === true, granted: (decision.capability || legacyGrant) ? { subject: agentName, accountId: session.email } : null })
  if (!readGuard.ok) {
    await addAudit(env, { event: 'secret.read-deny', agent: agentName, name, reason: readGuard.reason })
    // The agent has the scope but not the plaintext door. Leaving this as a bare
    // 403 is why a freshly authorised MCP client looked "connected but broken":
    // the console had nothing to show and nothing to click. Record it in the same
    // list as a missing grant, so one chip can open the door.
    await updateState(env, (next) => {
      const key = 'deny\u0000' + agentName + '\u0000' + name + '\u0000plaintext'
      next.deniedAttempts ??= {}
      const before = next.deniedAttempts[key]
      next.deniedAttempts[key] = {
        agent: agentName, name, itemId: resolvedItemId, account: session.email, action: 'secret.read',
        reason: readGuard.reason, plaintext: true, origin: '',
        count: (before?.count ?? 0) + 1, firstAt: before?.firstAt ?? nowIso(), lastAt: nowIso(),
        notifiedAt: before?.notifiedAt ?? 0,
      }
      return next
    })
    return { status: 'forbidden', error: '不能读明文：' + readGuardMessage(readGuard.reason), reason: readGuard.reason }
  }
  // One event name for every authorised read, with the risk carried in fields.
  // A separate 'secret.read-noapproval' name made the statistics — totalReads,
  // buckets, topItems, topAgents, activeAgents — silently skip exactly the reads
  // that skipped every check, which is the opposite of what an audit is for.
  await addAudit(env, { event: 'secret.read', agent: agentName, name, itemId: resolvedItemId, mode: readGuard.noApproval ? 'no-approval' : 'grant', via: 'agent', legacy: decision.legacy === true, ...(readGuard.noApproval ? { noApproval: true, severity: 'warn', source: 'no-approval' } : {}) })
  return { status: 'allowed', itemId: resolvedItemId, value: result.value, url: result.url, noApproval: readGuard.noApproval === true }
}

function statsFor(state, range) {
  const rangeMs = range === '7d' ? 7 * 86400e3 : range === '30d' ? 30 * 86400e3 : 24 * 3600e3
  const start = Date.now() - rangeMs
  const reads = (state.audit ?? []).filter((entry) => entry.event === 'secret.read' && Date.parse(entry.time) >= start)
  const bucketCount = range === '24h' ? 24 : range === '7d' ? 28 : 30
  const bucketMs = rangeMs / bucketCount
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const from = start + index * bucketMs
    const count = reads.filter((entry) => { const time = Date.parse(entry.time); return time >= from && time < from + bucketMs }).length
    const date = new Date(from)
    return { label: range === '24h' ? String(date.getHours()).padStart(2, '0') + ':00' : (date.getMonth() + 1) + '/' + date.getDate(), count }
  })
  const countBy = (field) => {
    const map = new Map()
    for (const entry of reads) { const key = entry[field] ?? (field === 'agent' ? '网页/管理员' : '未知'); map.set(key, (map.get(key) ?? 0) + 1) }
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }
  const grants = Object.values(state.grants ?? {}).filter((grant) => !grant.revokedAt && (!grant.expiresAt || grant.expiresAt > Date.now()))
  return {
    totalReads: reads.length,
    activeAgents: new Set(reads.map((entry) => entry.agent).filter(Boolean)).size,
    pending: Object.keys(state.pending ?? {}).length,
    activeGrants: grants.length,
    buckets,
    topItems: countBy('name').slice(0, 20),
    topAgents: countBy('agent').slice(0, 8),
  }
}

function oauthMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['secrets.read'],
  }
}

// What the consent page may offer: item names and group names. Names only, no
// values. Reading the vault needs an unlocked session, and this page is shown
// right after login, so a failure yields an empty picker rather than an error
// page the user cannot get past.
async function consentCatalog(env, db) {
  try {
    const session = await getSession(env)
    if (!session) return { items: [], groups: [] }
    const items = await listCiphers(env, db, session)
    const groups = [...new Set(items.map((item) => item.group).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    return { items: items.map((item) => item.name).sort((a, b) => a.localeCompare(b)), groups }
  } catch { return { items: [], groups: [] } }
}

// The consent page asks what the client may reach, not just "allow": an Agent
// connects in order to read one credential, so choosing it here saves a second
// trip to the console. The choices become the Agent's scope and a plaintext
// read policy, so the very next get_secret works.
// The panel and the three pages that live outside it share one palette, one
// type scale and one row rhythm. The CSS only existed in three copies before
// this, each with its own teal accent, so the login page looked like a
// different product from the console behind it.
function consolePageCss() {
  return String.raw`
  :root{--bg-grouped:#F2F2F7;--card:#FFFFFF;--label:#000000;--label-2:rgba(60,60,67,.6);--label-3:rgba(60,60,67,.35);--separator:rgba(60,60,67,.29);--fill:rgba(118,118,128,.12);--blue:#007AFF;--green:#34C759;--red:#FF3B30;--purple:#AF52DE;--mix-tint:12%}
  @media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg-grouped:#000000;--card:#1C1C1E;--label:#FFFFFF;--label-2:rgba(235,235,245,.6);--label-3:rgba(235,235,245,.35);--separator:rgba(84,84,88,.6);--fill:rgba(118,118,128,.24);--blue:#0A84FF;--green:#30D158;--red:#FF453A;--purple:#BF5AF2;--mix-tint:20%}}
  :root[data-theme="dark"]{--bg-grouped:#000000;--card:#1C1C1E;--label:#FFFFFF;--label-2:rgba(235,235,245,.6);--label-3:rgba(235,235,245,.35);--separator:rgba(84,84,88,.6);--fill:rgba(118,118,128,.24);--blue:#0A84FF;--green:#30D158;--red:#FF453A;--purple:#BF5AF2;--mix-tint:20%}
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg-grouped);color:var(--label);font:400 17px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{width:100%;max-width:400px;margin:0 auto;padding:32px 16px 40px;min-height:100%;display:flex;flex-direction:column;justify-content:center}
  .wrap--wide{max-width:560px}
  .brand{display:flex;align-items:center;gap:12px;margin:0 4px 20px}
  .brand img{width:44px;height:44px;border-radius:10px;object-fit:cover;display:block;background:var(--fill)}
  .brand h1{font-size:24px;line-height:1.2;letter-spacing:-.5px;margin:0;font-weight:700}
  .sub{color:var(--label-2);font-size:13px;margin:3px 0 0}
  .group{background:var(--card);border-radius:12px;overflow:hidden;margin:0 0 16px}
  .row{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 16px;border-top:1px solid var(--separator);font-size:17px;color:var(--label)}
  .row:first-child{border-top:0}
  .row__label{flex:0 0 auto}
  .row input,.row select{flex:1 1 auto;min-width:0;border:0;background:transparent;color:var(--label);font:inherit;padding:12px 0;outline:none;text-align:right}
  .row input::placeholder{color:var(--label-3)}
  .row--link{justify-content:space-between;text-decoration:none;color:var(--blue)}
  .row__chev{color:var(--label-3);margin-left:auto}
  .primary,.secondary{display:block;width:100%;min-height:50px;border:0;border-radius:12px;font-family:inherit;font-size:17px;font-weight:600;padding:0 16px;cursor:pointer}
  .primary{background:var(--blue);color:#fff}
  .primary:active{opacity:.86}
  .secondary{background:var(--fill);color:var(--blue)}
  .btn-row{display:flex;gap:10px;margin-top:16px}
  .btn-row>*{flex:1 1 0}
  .status{min-height:20px;margin:10px 2px 0;font-size:13px;color:var(--red)}
  .hint{color:var(--label-2);font-size:13px;margin:12px 2px;line-height:1.5}
  .sep{display:flex;align-items:center;gap:10px;margin:22px 0 12px;color:var(--label-2);font-size:12px}
  .sep::before,.sep::after{content:"";flex:1;height:1px;background:var(--separator)}
  .group-head{font-size:13px;color:var(--label-2);margin:18px 4px 8px;font-weight:400}
  .pick{max-height:220px;overflow-y:auto}
  .pick .row{align-items:flex-start;gap:10px;padding:10px 16px}
  .pick .row span{font-size:15px;padding-top:2px;word-break:break-word}
  input[type=checkbox]{appearance:none;-webkit-appearance:none;flex:0 0 auto;width:22px;height:22px;margin:0;border:1.5px solid var(--label-3);border-radius:50%;background:transparent;position:relative}
  input[type=checkbox]:checked{background:var(--blue);border-color:var(--blue)}
  input[type=checkbox]:checked::after{content:"";position:absolute;inset:0;background:no-repeat center/11px 9px url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 10' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1.5 5.4l3 3 6-6.6'/%3E%3C/svg%3E")}
  .agent{background:color-mix(in srgb,var(--blue) var(--mix-tint),transparent);border-radius:12px;padding:12px 14px;font-size:15px;margin:0 0 16px}
  code{font:inherit;color:var(--label-2)}`
}

// The panel remembers its theme in localStorage; these pages are the same
// origin, so they follow it instead of only the OS setting.
function consoleThemeBoot() {
  return '<script>try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}</script>'
}

function oauthConsentPage(origin, params, client, catalog = { items: [], groups: [] }) {
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const field = (name) => '<input type="hidden" name="' + name + '" value="' + escape(params.get(name)) + '">'
  const boxes = (name, values) => values.length
    ? '<div class="group pick">' + values.map((value) =>
        '<label class="row"><input type="checkbox" name="' + name + '" value="' + escape(value) + '"><span>' + escape(value) + '</span></label>'
      ).join('') + '</div>'
    : '<p class="hint">还没有可选的内容，可以先在控制台创建密钥，或稍后到 Agents 页勾选。</p>'
  // Client names are self-reported, so an unfamiliar one is the only signal the
  // operator gets that this is a new application asking for keys. Say it plainly
  // the first time, and let that one approval stop the question coming back.
  const firstVisit = client && !client.trustedAt
    ? '<div class="group"><label class="row"><span class="row__label">新应用：<code>' + escape(client.clientName || client.clientId) + '</code> 第一次请求访问</span>' +
      '<input type="checkbox" name="remember_app" value="1" checked></label></div>' +
      '<p class="hint">这个名称由客户端自己填写，不能当作身份证明。若不是你刚才在自己的 Agent 里点开授权，直接点「拒绝」。取消勾选则下次还会再问一次。</p>'
    : '<p class="hint">这个应用已经在本站确认过：<code>' + escape(client?.clientName || client?.clientId || '') + '</code>。</p>'
  return '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><title>MCP 授权 · Secrets Broker</title><style>' + consolePageCss() + '</style>' + consoleThemeBoot() + '</head><body><div class="wrap wrap--wide">' +
    '<div class="brand"><img src="/logo.png" alt=""><div><h1>MCP 授权</h1><p class="sub">客户端 <code>' + escape(client?.clientName ?? params.get('client_id')) + '</code> 请求访问你的密钥库</p></div></div>' +
    '<form method="post" action="/oauth/authorize">' + field('client_id') + field('redirect_uri') + field('state') + field('code_challenge') + field('code_challenge_method') +
    firstVisit + field('scope') +
    '<p class="hint">Scope: ' + escape(params.get('scope') ?? 'secrets.read') + ' · 勾选只给它申请和读取的资格，值本身还要看同类里的明文开关。不勾则暂时不给任何条目。</p>' +
    '<div class="group-head">可读条目</div>' + boxes('grant_items', catalog.items) +
    '<div class="group-head">可读分组</div>' + boxes('grant_groups', catalog.groups) +
    '<div class="group">' +
    // Checked by default: an operator who clicks 允许 without touching anything
    // used to hand the client a token with an empty scope, and every read then
    // failed with no hint about why. Scope is the cheap part; the plaintext
    // switch below is the one that stays opt-in.
    '<label class="row"><input type="checkbox" name="grant_all" value="1" checked><span>允许全部条目（含以后新增的）</span></label>' +
    // Off by default, and short: granting scope must not silently open the
    // plaintext door for a month. The operator opts in and picks the window.
    '<label class="row"><input type="checkbox" name="grant_plaintext" value="1"><span>同时允许读取明文值</span></label>' +
    '<label class="row"><span class="row__label">明文有效期</span>' +
    '<select name="grant_hours"><option value="1">1 小时</option><option value="24" selected>24 小时</option><option value="168">7 天</option><option value="720">30 天</option></select></label>' +
    '</div>' +
    '<p class="hint">不勾选明文时，Agent 只能看到条目名称并提交审批申请，读不到值。web 类型的网站登录无论是否勾选都不会给明文。</p>' +
    '<div class="btn-row"><button class="primary" name="decision" value="allow">允许</button><button class="secondary" name="decision" value="deny">拒绝</button></div></form></div></body></html>'
}

function standaloneLoginPage(next, providers = []) {
  const target = safeNext(next)
  // One button per enabled provider. Adding a provider in 设置 is enough for it
  // to appear here; nothing needs to change on this page.
  const buttons = providers.map((provider) =>
    '<a class="row row--link" href="/oidc/login?provider=' + encodeURIComponent(provider.id) + '&next=' + encodeURIComponent(target) + '">使用 ' + escapeHtml(provider.label || provider.id) + ' 登录<span class="row__chev">›</span></a>'
  ).join('')
  const oidcBlock = buttons
    ? '<div class="sep"><span>或</span></div><div class="group">' + buttons + '</div>'
    : ''
  return String.raw`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><title>登录 · Secrets Broker</title><style>${consolePageCss()}</style>${consoleThemeBoot()}</head><body><div class="wrap">
    <div class="brand"><img src="/logo.png" alt=""><div><h1>Secrets Broker</h1><p class="sub">管理登录，这不是 Bitwarden 主密码</p></div></div>
    <div class="group">
      <div class="row"><span class="row__label">管理密码</span><input id="password" type="password" autocomplete="current-password" placeholder="••••••••"></div>
      <div class="row" id="totp" style="display:none"><span class="row__label">验证码</span><input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6 位数字"></div>
    </div>
    <button class="primary" id="go">登录</button>
    <div id="status" class="status" role="status"></div>
    ${oidcBlock}
  </div><script>
    try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}
    const next=${JSON.stringify(target)}
    const go=document.getElementById('go')
    async function submit(){
      const status=document.getElementById('status')
      status.textContent=''
      try{
        const response=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value,code:document.getElementById('code').value})})
        const data=await response.json()
        if(!response.ok){
          if(data.totpRequired){document.getElementById('totp').style.display='flex';status.textContent=data.error||'请输入验证码'}
          else status.textContent=data.error||'登录失败'
          return
        }
        location.href=next
      }catch(error){status.textContent=String(error.message||error)}
    }
    document.getElementById('password').addEventListener('keydown',(event)=>{if(event.key==='Enter')submit()})
    document.getElementById('code').addEventListener('keydown',(event)=>{if(event.key==='Enter')submit()})
    go.onclick=submit
  </script></body></html>`
}

// Browser half of device-code pairing. The whole point of this page is the key
// fingerprint: it must match the line the terminal printed, or the typing of a
// short code would let anyone swap in their own public key.
function pairPage({ code, entry }) {
  const gone = !entry
  const approved = Boolean(entry?.approved)
  const status = gone ? '这个配对码不存在，或者已经过期（五分钟内有效）。' : approved ? '这台设备已经批准过了。' : '确认终端上显示的公钥指纹与下面这串一致，再点批准。'
  return String.raw`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><title>配对设备 · Secrets Broker</title><style>${consolePageCss()}</style>${consoleThemeBoot()}</head><body><div class="wrap">
    <div class="brand"><img src="/logo.png" alt=""><div><h1>配对设备</h1><p class="sub">批准后这台机器会拿到一把只能自己解开的信封</p></div></div>
    <div class="group">
      <div class="row"><span class="row__label">配对码</span><b>${escapeHtml(code || '—')}</b></div>
      <div class="row"><span class="row__label">设备</span><b>${escapeHtml(entry?.name || '—')}</b></div>
      <div class="row"><span class="row__label">公钥指纹</span><code id="fp" style="font-size:15px;letter-spacing:1px">${escapeHtml(entry?.fingerprint || '—')}</code></div>
      <div class="row"><span class="row__label">过期时间</span><span>${entry?.expiresAt ? new Date(entry.expiresAt).toLocaleTimeString('zh-CN') : '—'}</span></div>
    </div>
    <p class="sub" id="status">${escapeHtml(status)}</p>
    ${gone || approved ? '' : '<button class="primary" id="approve">批准这台设备</button>'}
  </div><script>
    const code=${JSON.stringify(code || '')}
    const button=document.getElementById('approve')
    if(button)button.onclick=async()=>{
      const status=document.getElementById('status')
      button.disabled=true
      status.textContent='正在批准…'
      try{
        const response=await fetch('/api/v2/pair/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})})
        const data=await response.json()
        if(!response.ok)throw new Error(data.error||'批准失败')
        status.textContent='已批准：'+data.name+' · '+data.fingerprint
        button.remove()
      }catch(error){status.textContent=String(error.message||error);button.disabled=false}
    }
  </script></body></html>`
}

function connectPage(request) {
  const item = request
  return String.raw`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><title>连接密钥 · Secrets Broker</title><style>${consolePageCss()}</style>${consoleThemeBoot()}</head><body><div class="wrap">
    <div class="brand"><img src="/logo.png" alt=""><div><h1>连接密钥</h1><p class="sub">保存到当前解锁的 vault，并授权给请求的 Agent</p></div></div>
    <div class="agent"><b>${escapeHtml(item.agent || 'Agent')}</b> 需要：<code>${escapeHtml(item.name || '')}</code>${item.description ? '<br><span class="sub">' + escapeHtml(item.description) + '</span>' : ''}</div>
    <div class="group">
      <div class="row"><span class="row__label">名称</span><input id="name" value="${escapeHtml(item.name || '')}"></div>
      <div class="row"><span class="row__label">用户名</span><input id="username" placeholder="可选"></div>
      <div class="row"><span class="row__label">密钥值</span><input id="value" type="password" autocomplete="off" placeholder="粘贴 API key / 密码"></div>
      <div class="row"><span class="row__label">分组</span><input id="group" placeholder="例如 api/prod"></div>
    </div>
    <button class="primary" id="save">保存并授权</button>
    <div id="status" class="status"></div>
  </div><script>
    const id=${JSON.stringify(item.id)}
    document.getElementById('save').onclick=async()=>{
      const status=document.getElementById('status')
      const value=document.getElementById('value').value
      if(!value){status.textContent='请填写密钥值';return}
      status.style.color='';status.textContent='保存中…'
      try{
        const response=await fetch('/api/connect/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,name:document.getElementById('name').value,username:document.getElementById('username').value,value,group:document.getElementById('group').value})})
        const data=await response.json()
        if(!response.ok)throw new Error(data.error||'保存失败')
        status.style.color='var(--green)'
        status.textContent='已保存并授权，可以关闭此页面'
        setTimeout(()=>location.href='/',1200)
      }catch(error){status.style.color='';status.textContent=String(error.message||error)}
    }
  </script></body></html>`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

export default {
  // Cron entry point: runs the authorization reminder batch without an admin
  // page load. This is what makes reminders work while nobody is looking.
  async scheduled(event, env, ctx) {
    const work = (async () => {
      const state = await loadState(env)
      const origin = String(env.PUBLIC_ORIGIN || 'https://sb.otscup.com').replace(/\/$/, '')
      await dispatchReminderBatch(env, state, origin, ctx)
    })()
    if (ctx?.waitUntil) ctx.waitUntil(work)
    else await work
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // A browser extension is an executor that runs inside the operator's own
    // browser instead of a container: no Docker, no second process. It calls the
    // executor endpoints cross-origin with its own executor secret, and a browser
    // needs the CORS headers on the real response too, not only the preflight.
    // Only these paths carry them; every admin route stays same-origin.
    const executorPath = url.pathname.startsWith('/api/fill/task')
    if (request.method === 'OPTIONS' && executorPath) {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, x-fill-executor-id, x-fill-executor-secret',
          'access-control-max-age': '600',
        },
      })
    }
    // Shadow the two response helpers so every executor reply carries the header
    // without touching twenty return sites. For any other path these are the
    // original functions unchanged.
    const json = executorPath
      ? (data, status = 200, headers = {}) => jsonBase(data, status, { ...headers, 'access-control-allow-origin': '*' })
      : jsonBase
    const fail = executorPath
      ? (message, status = 400) => jsonBase({ error: message }, status, { 'access-control-allow-origin': '*' })
      : failBase

    if (url.pathname === '/login' && request.method === 'GET') {
      const nextTarget = String(url.searchParams.get('next') ?? '/')
      // Already signed in: honour the return target instead of always going home.
      if (await adminAuthorized(request, env)) return Response.redirect(new URL(nextTarget, url).toString(), 302)
      const state = await loadState(env)
      const providers = oidcProviders(state).filter((entry) => entry.enabled !== false)
      // The account is NOT listed here. This page is the only unauthenticated
      // entry point, so rendering vault account emails on it would publish them
      // to anyone who can reach the URL. A pre-auth caller learns nothing about
      // who has an account. The account is chosen after login, in 设置 → 账户.
      return htmlResponse(standaloneLoginPage(nextTarget, providers))
    }
    if (url.pathname === '/connect' && request.method === 'GET') {
      if (!(await adminAuthorized(request, env))) return Response.redirect(new URL('/login?next=' + encodeURIComponent(url.pathname + url.search), url).toString(), 302)
      const state = await loadState(env)
      const id = url.searchParams.get('id') ?? ''
      const item = state.credentialRequests?.[id]
      if (!item) return new Response('连接请求不存在或已完成', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      const session = await getSession(env)
      if (!session) return Response.redirect(new URL('/?login=1', url).toString(), 302)
      if (item.account && String(item.account).toLowerCase() !== String(session.email).toLowerCase()) return new Response('请先切换到请求对应的 vault 账户并解锁', { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      return htmlResponse(connectPage(item))
    }
    if (url.pathname === '/api/credential-requests/cancel' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const id = String(body.id ?? '')
      await updateState(env, (state) => { if (state.credentialRequests?.[id]) delete state.credentialRequests[id]; return state })
      await addAudit(env, { event: 'credential.cancel', id })
      return json({ ok: true })
    }
    if (url.pathname === '/api/connect/save' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('vault locked', 423)
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      const item = state.credentialRequests?.[String(body.id ?? '')]
      if (!item) return fail('request not found', 404)
      if (item.account && String(item.account).toLowerCase() !== String(session.email).toLowerCase()) return fail('wrong vault account', 409)
      try {
        const saved = await saveCredentialRequest(env, session, item, body, 'connect-page')
        if (saved.error) return fail(saved.error, saved.status)
        return json({ ok: true, name: saved.name, itemId: saved.itemId })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/logo.png' || url.pathname === '/favicon.ico') {
      const bytes = b64ToBytes(url.pathname === '/logo.png' ? LOGO_PNG_B64 : FAVICON_ICO_B64)
      return new Response(bytes, { headers: { 'content-type': url.pathname === '/logo.png' ? 'image/png' : 'image/x-icon', 'cache-control': 'public, max-age=86400' } })
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!(await adminAuthorized(request, env))) return Response.redirect(new URL('/login?next=' + encodeURIComponent(url.pathname + url.search), url).toString(), 302)
      return htmlResponse(uiHtml)
    }
    if (url.pathname === '/api/plugin/pending' && request.method === 'GET') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const state = await loadState(env)
      return json({ pending: Object.values(state.pending ?? {}).map((entry) => ({ id: entry.id, agent: entry.agent, name: entry.name, action: entry.action, targetOrigin: entry.targetOrigin ?? '', createdAt: entry.createdAt })), count: Object.keys(state.pending ?? {}).length })
    }
    // Read-only: which agents are using which credentials, derived from the audit
    // trail and the live capabilities. This is the "who is using my keys" fact
    // the plugin can show and the web page cannot put in front of the model.
    // Metadata only: no value, no username, no TOTP.
    if (url.pathname === '/api/plugin/usage' && request.method === 'GET') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const state = await loadState(env)
      const now = Date.now()
      const windowHours = Math.max(1, Math.min(24 * 30, Number(url.searchParams.get('hours')) || 24))
      const since = now - windowHours * 3600e3
      // Hourly buckets, so the panel can draw a trend and a weekday heatmap
      // without shipping the audit trail to the browser.
      const buckets = new Array(windowHours).fill(null).map(() => ({ reads: 0, denied: 0 }))
      const byAgent = {}
      const byItem = {}
      let reads = 0
      let denied = 0
      for (const entry of state.audit ?? []) {
        const at = Date.parse(entry.time ?? '')
        if (!Number.isFinite(at) || at < since) continue
        const event = String(entry.event ?? '')
        if (event !== 'secret.read' && event !== 'secret.read-deny') continue
        const agent = String(entry.agent ?? '') || '(admin)'
        const name = String(entry.name ?? '') || '(unknown)'
        const bucket = buckets[Math.min(windowHours - 1, Math.floor((at - since) / 3600e3))]
        if (event === 'secret.read-deny') {
          denied += 1
          if (bucket) bucket.denied += 1
          const slot = byAgent[agent] ?? (byAgent[agent] = { agent, reads: 0, denied: 0, items: {}, lastAt: '' })
          slot.denied += 1
          if (!slot.lastAt || at > Date.parse(slot.lastAt)) slot.lastAt = new Date(at).toISOString()
          continue
        }
        reads += 1
        if (bucket) bucket.reads += 1
        const slot = byAgent[agent] ?? (byAgent[agent] = { agent, reads: 0, denied: 0, items: {}, lastAt: '' })
        slot.reads += 1
        slot.items[name] = (slot.items[name] ?? 0) + 1
        if (!slot.lastAt || at > Date.parse(slot.lastAt)) slot.lastAt = new Date(at).toISOString()
        byItem[name] = (byItem[name] ?? 0) + 1
      }
      // Live authorisations, so the plugin can show what is currently allowed and
      // how much of a bounded grant is left.
      const capabilities = Object.values(state.capabilities ?? {})
        .filter((cap) => !cap.revokedAt)
        .filter((cap) => !cap.expiresAt || cap.expiresAt > now)
        .map((cap) => ({
          agent: cap.subjectId ?? '', name: cap.itemName ?? '', action: cap.action ?? '',
          expiresAt: cap.expiresAt ?? null,
          usesLeft: cap.maxUses == null ? null : Math.max(0, cap.maxUses - (cap.usedCount ?? 0)),
          maxUses: cap.maxUses ?? null, usedCount: cap.usedCount ?? 0,
        }))
      const pending = Object.values(state.pending ?? {}).map((entry) => ({ id: entry.id, agent: entry.agent, name: entry.name, action: entry.action ?? '', createdAt: entry.createdAt ?? '' }))
      return json({
        windowHours, reads, denied,
        series: buckets.map((bucket, index) => ({ t: since + index * 3600e3, reads: bucket.reads, denied: bucket.denied })),
        agents: Object.values(byAgent).sort((a, b) => b.reads - a.reads),
        items: Object.entries(byItem).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, reads: count })),
        capabilities, pending,
        requireClassification: requireClassification(state),
      })
    }
    // Long poll: return as soon as the pending queue changes, so a plugin that is
    // waiting on an approval resumes by itself instead of polling on a timer.
    // It never approves anything; it only reports. Capped at 25s so the caller
    // and the platform both stay inside their own timeouts.
    if (url.pathname === '/api/plugin/wait' && request.method === 'GET') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      // The caller passes the queue signature it last saw. If that already
      // differs, the answer is immediate; otherwise poll the state until it
      // changes or the window closes. Capped at 25s to stay inside the platform
      // request limit.
      const wanted = String(url.searchParams.get('since') ?? '')
      const waitMs = Math.max(0, Math.min(25000, Number(url.searchParams.get('timeout')) || 20000))
      const started = Date.now()
      const snapshot = async () => {
        const state = await loadState(env)
        const ids = Object.keys(state.pending ?? {}).sort()
        return {
          count: ids.length,
          ids,
          signature: ids.join(','),
          pending: Object.values(state.pending ?? {}).map((entry) => ({ id: entry.id, agent: entry.agent, name: entry.name, action: entry.action ?? '', createdAt: entry.createdAt ?? '' })),
        }
      }
      let current = await snapshot()
      // The signature the caller last saw. No since= means "tell me the current
      // state", which is not a change.
      const baseline = wanted || current.signature
      if (current.signature === baseline) {
        while (Date.now() - started < waitMs && current.signature === baseline) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          current = await snapshot()
        }
      }
      const { signature, ids, ...rest } = current
      void ids
      void signature
      return json({ ...rest, changed: current.signature !== baseline, waitedMs: Date.now() - started })
    }
    if (url.pathname === '/api/plugin/connect/save' && request.method === 'POST') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('vault locked; unlock the broker first', 423)
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      const item = state.credentialRequests?.[String(body.id ?? '')]
      if (!item) return fail('request not found', 404)
      if (item.account && String(item.account).toLowerCase() !== String(session.email).toLowerCase()) return fail('wrong vault account', 409)
      try {
        const saved = await saveCredentialRequest(env, session, item, body, 'dsh-plugin')
        if (saved.error) return fail(saved.error, saved.status)
        return json({ ok: true, name: saved.name, itemId: saved.itemId })
      } catch (error) { return fail(String(error.message ?? error), error.status ?? 500) }
    }
    if (url.pathname === '/api/plugin/credential-requests' && request.method === 'GET') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const state = await loadState(env)
      return json({ requests: Object.values(state.credentialRequests ?? {}).map((entry) => ({ id: entry.id, agent: entry.agent, name: entry.name, description: entry.description ?? '', createdAt: entry.createdAt })) })
    }
    // The operator declining a request, so a prompt for a key they will never
    // enter stops appearing. Same effect as the browser cancel button.
    if (url.pathname === '/api/plugin/credential-requests/cancel' && request.method === 'POST') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const id = String(body.id ?? '')
      if (!id) return fail('id required', 400)
      await updateState(env, (state) => { if (state.credentialRequests?.[id]) delete state.credentialRequests[id]; return state })
      await addAudit(env, { event: 'credential.cancel', id, source: 'dsh-plugin' })
      return json({ ok: true })
    }
    // The operator typing a credential in the plugin, with no Agent behind the
    // request. Separate from connect/save: there is no request id and no Agent to
    // grant to, so this only stores the item in the vault.
    if (url.pathname === '/api/plugin/items/save' && request.method === 'POST') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('vault locked; unlock the broker first', 423)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim()
      if (!name) return fail('name required', 400)
      const value = String(body.value ?? '')
      if (!value) return fail('value required', 400)
      // An optional classification, so a key typed in the plugin arrives already
      // labelled instead of showing as unclassified until someone opens the
      // console. Invalid values are refused rather than silently dropped: the
      // operator picked a category, and "saved but not applied" is the bug they
      // reported.
      const wantKind = String(body.kind ?? '').trim()
      if (wantKind && !CREDENTIAL_KINDS.has(wantKind)) return fail('kind must be api or web', 400)
      const wantOrigins = (Array.isArray(body.origins) ? body.origins : [])
        .map((entry) => normalizeOrigin(entry)?.origin)
        .filter(Boolean)
      if (wantKind === 'web' && !wantOrigins.length) return fail('a website login needs at least one origin', 400)
      try {
        const found = await findCipherRow(env, env.NODEWARDEN_DB, session, name)
        let itemId = found?.row?.id ?? ''
        if (found) {
          await updateCipher(env, env.NODEWARDEN_DB, session, name, {
            value,
            username: typeof body.username === 'string' ? body.username : undefined,
            url: typeof body.url === 'string' ? body.url : undefined,
            notes: typeof body.notes === 'string' ? body.notes : undefined,
          })
          await addAudit(env, { event: 'item.update', name, source: 'dsh-plugin' })
        } else {
          const created = await createCipher(env, env.NODEWARDEN_DB, session, {
            name, value,
            username: typeof body.username === 'string' ? body.username : '',
            url: typeof body.url === 'string' ? body.url : '',
            notes: typeof body.notes === 'string' ? body.notes : '',
            group: typeof body.group === 'string' ? body.group : '',
          })
          itemId = created.id ?? ''
          await addAudit(env, { event: 'item.create', name, source: 'dsh-plugin' })
        }
        if (wantKind && itemId) {
          const kind = wantKind
          await updateState(env, (state) => applyCredentialKind(state, {
            itemId, kind, origins: wantOrigins, actions: ['login'], accountId: session.email, autoApprove: false,
          }))
          await addAudit(env, { event: 'fill-policy.update', name, itemId, kind, origins: wantOrigins, source: 'dsh-plugin' })
          await cancelTasksFor(env, (task) => task.cipherId === itemId, 'policy-changed')
        } else if (wantKind && !itemId) {
          // The cipher is stored but its id is unknown, so the classification
          // cannot be recorded against it. Say so instead of pretending.
          return json({ ok: true, name, created: !found, kindApplied: false, warning: 'item id unavailable; classification not applied' })
        }
        return json({ ok: true, name: found ? name : name, updated: Boolean(found), created: !found, kindApplied: Boolean(wantKind && itemId) })
      } catch (error) { return fail(String(error.message ?? error), error.status ?? 500) }
    }
    if (url.pathname === '/api/plugin/items/delete' && request.method === 'POST') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('vault locked; unlock the broker first', 423)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim()
      if (!name) return fail('name required', 400)
      try {
        const deleted = await deleteCipher(env, env.NODEWARDEN_DB, session, name)
        if (!deleted) return fail('item not found', 404)
        await addAudit(env, { event: 'item.delete', name, source: 'dsh-plugin' })
        return json({ ok: true, name })
      } catch (error) { return fail(String(error.message ?? error), error.status ?? 500) }
    }
    // The operator's own list, so the plugin can show what it may pick from
    // without loading the console. Names and groups only: never a value.
    if (url.pathname === '/api/plugin/items' && request.method === 'GET') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('vault locked; unlock the broker first', 423)
      try {
        const items = await listCiphers(env, env.NODEWARDEN_DB, session)
        return json({ items: items.map((item) => ({ name: item.name, group: item.group ?? '', url: item.url ?? '' })) })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    // Recent activity in the operator's own words: what was read, approved,
    // written or refused, newest first. This is what the popup shows instead of
    // an empty "nothing pending" panel.
    if (url.pathname === '/api/plugin/activity' && request.method === 'GET') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const state = await loadState(env)
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 30))
      const skip = new Set(['admin.login', 'admin.oidc-login', 'admin.login-fail', 'vault.unlock', 'vault.lock'])
      const activity = (state.audit ?? [])
        .filter((entry) => !skip.has(String(entry.event ?? '')))
        .slice(0, limit)
        .map((entry) => ({
          time: entry.time ?? '',
          event: String(entry.event ?? ''),
          agent: String(entry.agent ?? ''),
          name: String(entry.name ?? ''),
          ok: !String(entry.event ?? '').includes('deny') && !String(entry.event ?? '').includes('fail'),
        }))
      return json({ activity })
    }
    if (url.pathname === '/api/plugin/decide' && request.method === 'POST') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      if (!body.id) return fail('id required', 400)
      const outcome = await decidePending(env, String(body.id), String(body.decision ?? 'once'), 'dsh-plugin')
      return json({ ok: true, outcome })
    }
    // Lazily loaded 3D globe island. Served as a static asset so it never
    // inflates the Worker script itself; same-origin keeps CSP at 'self'.
    if (url.pathname === '/globe.js' || url.pathname === '/earth.jpg') {
      const isJs = url.pathname === '/globe.js'
      const asset = env.ASSETS && typeof env.ASSETS.fetch === 'function' ? await env.ASSETS.fetch(new Request(new URL(url.pathname, url.origin), request)) : null
      if (!asset || !asset.ok) return fail('asset unavailable', 404)
      const headers = new Headers(asset.headers)
      headers.set('content-type', isJs ? 'text/javascript; charset=utf-8' : 'image/jpeg')
      headers.set('cache-control', 'public, max-age=86400, immutable')
      headers.set('x-content-type-options', 'nosniff')
      return new Response(asset.body, { status: 200, headers })
    }
    if (url.pathname === '/api/status') {
      return json({ ok: true, name: 'secrets-broker-workers', bindings: { d1: Boolean(env.NODEWARDEN_DB), durableObject: Boolean(env.BROKER_STATE) } })
    }
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown'
      if (loginBlocked(state, ip)) return fail('登录尝试过多，请 15 分钟后再试', 429)
      let passwordValid = await verifyAdminPassword(env, state, body.password)
      if (!passwordValid && env.ADMIN_PASSWORD && constantTimeEqual(encoder.encode(String(body.password ?? '')), encoder.encode(env.ADMIN_PASSWORD))) passwordValid = true
      if (!passwordValid) {
        await recordLoginFailure(env, ip)
        await addAudit(env, { event: 'admin.login-fail', ip })
        return fail('密码错误', 401)
      }
      if (state.security?.totpEnabled) {
        if (!body.code) return json({ totpRequired: true }, 401)
        const secret = await totpSecret(env, state)
        if (!secret || !(await verifyTotp(secret, body.code))) {
          await recordLoginFailure(env, ip)
          await addAudit(env, { event: 'admin.totp-fail', ip })
          return json({ totpRequired: true, error: '两步验证码错误' }, 401)
        }
      }
      await clearLoginFailures(env, ip)
      // An account chosen on the login page becomes the vault this broker uses.
      // It is a preference, not a lock: the next login offers every account
      // again, so a switch is always reversible without logging in as the one
      // you just left.
      const wantedAccount = String(body.account ?? '').trim()
      if (wantedAccount) {
        const exists = await env.NODEWARDEN_DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(wantedAccount).first()
        if (!exists) return fail('账户不存在：' + wantedAccount, 400)
        await updateState(env, (state) => {
          state.settings ??= { notifications: {} }
          state.settings.vaultEmail = wantedAccount
          // The unlocked session belongs to the previous account; drop it so the
          // operator cannot read the old vault under the new account's name.
          return state
        })
        await stateStub(env).fetch('https://state/session', { method: 'DELETE' }).catch(() => {})
      }
      const cookie = await createAdminCookie(env, request)
      await addAudit(env, { event: 'admin.login', ip, account: wantedAccount || undefined })
      // SameSite=None so the cookie is sent on the cross-site POST that the
      // OAuth consent form performs (meta.ai -> this origin). With Lax the
      // browser withholds it on POST, validCookie sees no cookie, and the user
      // is bounced back to /login forever.
      return json({ ok: true }, 200, { 'set-cookie': `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=604800` })
    }
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      const sessionId = cookieSessionId(request)
      if (sessionId) await updateState(env, (state) => { if (state.adminSessions?.[sessionId]) delete state.adminSessions[sessionId]; return state })
      return json({ ok: true }, 200, { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0` })
    }
    if (url.pathname === '/api/sessions' && request.method === 'GET') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const current = cookieSessionId(request)
      const sessions = Object.values(state.adminSessions ?? {}).filter((entry) => !entry.expiresAt || entry.expiresAt > Date.now()).map((entry) => ({ id: entry.id, ip: entry.ip ?? '', ua: entry.ua ?? '', createdAt: entry.createdAt ?? '', lastSeen: entry.lastSeen ?? '', expiresAt: entry.expiresAt ?? 0, current: entry.id === current }))
      return json({ sessions, legacy: !current })
    }
    if (url.pathname === '/api/sessions/revoke' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      if (!body.id) return fail('session id required', 400)
      await updateState(env, (state) => { if (state.adminSessions?.[body.id]) delete state.adminSessions[body.id]; return state })
      await addAudit(env, { event: 'admin.session-revoke', sessionId: body.id })
      return json({ ok: true })
    }
    if (url.pathname === '/api/me') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      const state = await loadState(env)
      return json({ email: state.settings?.vaultEmail || env.VAULT_EMAIL || (session && session.email) || '', name: state.profile?.name || '', avatarUrl: state.profile?.avatarUrl || '', siteName: state.settings?.siteName || 'Secrets Broker', unlocked: Boolean(session), expiresAt: session?.expiresAt ?? 0, pending: Object.keys(state.pending ?? {}).length })
    }
    if (url.pathname === '/api/profile') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      if (request.method === 'GET') {
        const state = await loadState(env)
        const oidc = await oidcConfig(env, request, state)
        return json({ profile: state.profile ?? {}, oidcEnabled: Boolean(oidc), oidcIssuer: oidc?.issuer ?? '', oidcLoginUrl: oidc ? '/oidc/login' : '', oidcProviders: oidcProviders(state).map((entry) => ({ id: entry.id, label: entry.label ?? '', issuer: entry.issuer ?? '', enabled: entry.enabled !== false })), oidcBindings: oidcBindingMap(state) })
      }
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        await updateState(env, (state) => {
          state.profile ??= {}
          if (typeof body.name === 'string') state.profile.name = body.name.trim()
          if (typeof body.email === 'string') state.profile.email = body.email.trim()
          if (typeof body.avatarUrl === 'string') state.profile.avatarUrl = body.avatarUrl.trim()
          return state
        })
        await addAudit(env, { event: 'profile.update' })
        return json({ ok: true })
      }
    }
    if (url.pathname === '/api/security') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      return json({ passwordSource: state.security?.passwordHash ? 'custom' : 'env', totpEnabled: state.security?.totpEnabled === true, totpPending: Boolean(state.security?.totpPendingWrapped) })
    }
    if (url.pathname === '/api/security/password' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      if (!(await verifyAdminPassword(env, state, body.currentPassword))) return fail('当前密码错误', 401)
      const next = String(body.newPassword ?? '')
      if (next.length < 8) return fail('新密码至少 8 位', 400)
      const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)))
      const hash = await hashAdminPassword(next, salt)
      await updateState(env, (nextState) => { nextState.security ??= {}; nextState.security.passwordSalt = salt; nextState.security.passwordHash = hash; return nextState })
      await addAudit(env, { event: 'security.password-change' })
      return json({ ok: true })
    }
    if (url.pathname === '/api/2fa/setup' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)))
      const wrapped = await wrapWithKek(encoder.encode(secret), await kekBytes(env))
      await updateState(env, (next) => { next.security ??= {}; next.security.totpPendingWrapped = wrapped; return next })
      const label = encodeURIComponent(`Secrets Broker:${state.profile?.email || env.VAULT_EMAIL || 'admin'}`)
      return json({ ok: true, secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=Secrets%20Broker` })
    }
    if (url.pathname === '/api/2fa/enable' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      if (!state.security?.totpPendingWrapped) return fail('请先生成两步验证密钥', 400)
      const secret = new TextDecoder().decode(await unwrapWithKek(state.security.totpPendingWrapped, await kekBytes(env)))
      if (!(await verifyTotp(secret, body.code))) return fail('验证码错误', 400)
      await updateState(env, (next) => { next.security ??= {}; next.security.totpSecretWrapped = state.security.totpPendingWrapped; next.security.totpEnabled = true; next.security.totpPendingWrapped = ''; return next })
      await addAudit(env, { event: 'security.2fa-enable' })
      return json({ ok: true })
    }
    if (url.pathname === '/api/2fa/disable' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      if (!(await verifyAdminPassword(env, state, body.password))) return fail('密码错误', 401)
      await updateState(env, (next) => { next.security ??= {}; next.security.totpEnabled = false; next.security.totpSecretWrapped = ''; next.security.totpPendingWrapped = ''; return next })
      await addAudit(env, { event: 'security.2fa-disable' })
      return json({ ok: true })
    }
    if (url.pathname === '/api/oidc/discover') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const configured = await oidcConfig(env, request, state)
      const issuer = String(url.searchParams.get('issuer') || configured?.issuer || '').replace(/\/$/, '')
      if (!issuer) return fail('issuer required', 400)
      try {
        const discovery = await oidcDiscovery(issuer)
        return json({ authorizationEndpoint: discovery.authorization_endpoint ?? '', tokenEndpoint: discovery.token_endpoint ?? '', userinfoEndpoint: discovery.userinfo_endpoint ?? '', jwksUri: discovery.jwks_uri ?? '', scope: discovery.scopes_supported?.join(' ') ?? '' })
      } catch (error) { return fail(String(error.message ?? error), 502) }
    }
    if (url.pathname === '/api/oidc/providers') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      if (request.method === 'GET') {
        const providers = oidcProviders(state)
        const listed = []
        for (const entry of providers) {
          listed.push({
            id: entry.id, label: entry.label ?? '', issuer: entry.issuer ?? '',
            clientId: entry.clientId ?? '', redirectUri: entry.redirectUri ?? '',
            scope: entry.scope ?? '', authorizationEndpoint: entry.authorizationEndpoint ?? '',
            tokenEndpoint: entry.tokenEndpoint ?? '', userinfoEndpoint: entry.userinfoEndpoint ?? '',
            jwksUri: entry.jwksUri ?? '', enabled: entry.enabled !== false,
            // The secret itself never leaves the broker; the UI only learns
            // that one is stored, and leaves the field empty to keep it.
            secretConfigured: Boolean(entry.clientSecret),
          })
        }
        const bindings = oidcBindingMap(state)
        return json({ providers: listed, bindings })
      }
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const id = String(body.id ?? '').trim()
        if (!/^[A-Za-z0-9._-]{1,48}$/.test(id)) return fail('a provider id is required', 400)
        const issuer = String(body.issuer ?? '').trim()
        const clientId = String(body.clientId ?? '').trim()
        if (!issuer || !clientId) return fail('issuer and clientId are required', 400)
        await updateState(env, (next) => {
          next.settings ??= {}
          next.settings.oidcProviders ??= {}
          // The 'default' provider IS the legacy single configuration. Writing
          // it into the provider map created a hidden duplicate: oidcProviders()
          // prefers the legacy entry, so the name never changed.
          if (id === 'default' && next.settings.oidc) {
            const legacy = next.settings.oidc
            legacy.label = String(body.label ?? legacy.label ?? '').trim()
            legacy.issuer = issuer
            legacy.clientId = clientId
            legacy.enabled = body.enabled !== false
            for (const key of ['redirectUri', 'scope', 'authorizationEndpoint', 'tokenEndpoint', 'userinfoEndpoint', 'jwksUri']) {
              if (typeof body[key] === 'string') legacy[key] = body[key].trim()
            }
            if (typeof body.clientSecret === 'string' && body.clientSecret.length > 0) legacy.clientSecret = body.clientSecret
            if (body.clearSecret === true) delete legacy.clientSecret
            return next
          }
          const current = next.settings.oidcProviders[id] ?? {}
          const entry = { ...current, id, label: String(body.label ?? current.label ?? '').trim(), issuer, clientId, enabled: body.enabled !== false }
          for (const key of ['redirectUri', 'scope', 'authorizationEndpoint', 'tokenEndpoint', 'userinfoEndpoint', 'jwksUri']) {
            if (typeof body[key] === 'string') entry[key] = body[key].trim()
          }
          // An empty secret keeps the stored one, so the UI can save the rest
          // of the form without knowing the secret.
          if (typeof body.clientSecret === 'string' && body.clientSecret.length > 0) entry.clientSecret = body.clientSecret
          if (body.clearSecret === true) delete entry.clientSecret
          next.settings.oidcProviders[id] = entry
          return next
        })
        await addAudit(env, { event: 'oidc.provider.update', provider: id })
        return json({ ok: true, id })
      }
      if (request.method === 'DELETE') {
        const body = await request.json().catch(() => ({}))
        const id = String(body.id ?? '').trim()
        if (!id) return fail('id required', 400)
        await updateState(env, (next) => {
          if (next.settings?.oidcProviders) delete next.settings.oidcProviders[id]
          // A binding of a deleted provider is dropped with it.
          if (next.profile?.oidcBindings) delete next.profile.oidcBindings[id]
          return next
        })
        await addAudit(env, { event: 'oidc.provider.delete', provider: id })
        return json({ ok: true, id })
      }
    }
    // Bind or unbind one provider. Each provider is bound on its own, so a
    // second identity provider can be added or removed without touching the
    // others.
    if (url.pathname === '/api/profile/oidc/bindings') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const id = String(body.id ?? '').trim()
      if (!id) return fail('id required', 400)
      if (request.method === 'DELETE') {
        await updateState(env, (next) => {
          if (next.profile?.oidcBindings) delete next.profile.oidcBindings[id]
          // Unbinding the legacy provider must also clear the single global
          // identity, otherwise oidcBindingFor keeps reporting it as bound.
          if (id === 'default' && next.profile) { delete next.profile.oidcSub; delete next.profile.oidcEmail }
          return next
        })
        await addAudit(env, { event: 'profile.oidc-unbind', provider: id })
        return json({ ok: true, id })
      }
      const state = await loadState(env)
      return json({ bindings: oidcBindingMap(state) })
    }

    if (url.pathname === '/api/oidc/status') {
      const state = await loadState(env)
      const oidc = await oidcConfig(env, request, state)
      const list = []
      for (const entry of oidcProviders(state)) { if (entry.enabled === false) continue; list.push({ id: entry.id, label: entry.label ?? '', issuer: entry.issuer ?? '' }) }
      return json({ enabled: Boolean(oidc), providers: list, issuer: oidc?.issuer ?? '' })
    }
    // Diagnose one provider without leaving the broker: discovery, the id_token
    // signing algorithms the provider advertises, and whether the authorization
    // endpoint actually accepts this client id. A wrong client id used to show up
    // as an error page at the identity provider with no hint of the cause.
    if (url.pathname === '/api/oidc/probe') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const provider = pickOidcProvider(state, url.searchParams.get('provider'))
      const oidc = await oidcConfig(env, request, state, provider)
      if (!oidc) return fail('OIDC is not configured', 400)
      const report = { provider: oidc.id, issuer: oidc.issuer, clientId: oidc.clientId, redirectUri: oidc.redirectUri, problems: [] }
      try {
        const endpoints = await oidcEndpoints(oidc)
        report.authorizationEndpoint = endpoints.authorization ?? ''
        report.tokenEndpoint = endpoints.token ?? ''
        report.hasSecret = Boolean(oidc.clientSecret)
        const discovery = await oidcDiscovery(oidc.issuer).catch(() => null)
        report.signingAlgs = discovery?.id_token_signing_alg_values_supported ?? null
        if (Array.isArray(report.signingAlgs) && report.signingAlgs.length) {
          const supported = report.signingAlgs.filter((alg) => ALLOWED_ALGS.has(alg))
          if (!supported.length) report.problems.push('issuer only signs with ' + report.signingAlgs.join('/') + ', which the broker cannot verify')
        }
        // Ask the authorization endpoint about this client. Providers differ;
        // a redirect to their own sign-in page means the client id is accepted.
        if (endpoints.authorization) {
          const probe = new URL(endpoints.authorization)
          probe.searchParams.set('client_id', oidc.clientId)
          probe.searchParams.set('redirect_uri', oidc.redirectUri)
          probe.searchParams.set('response_type', 'code')
          probe.searchParams.set('scope', oidc.scope)
          probe.searchParams.set('state', 'probe')
          probe.searchParams.set('code_challenge', base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('probe-verifier')))))
          probe.searchParams.set('code_challenge_method', 'S256')
          probe.searchParams.set('nonce', 'probe')
          const response = await fetch(probe.toString(), { redirect: 'manual' })
          const text = await response.text().catch(() => '')
          report.authorizeStatus = response.status
          report.redirected = Boolean(response.headers.get('location'))
          // An error page naming invalid_client (or a redirect carrying
          // error=invalid_client) is the authoritative "this client id is not
          // registered here" signal.
          const combined = String(response.headers.get('location') ?? '') + ' ' + text
          if (/invalid_client|client not found|unknown client/i.test(combined)) {
            report.problems.push('the authorization endpoint does not know this client id (' + oidc.clientId + '); register it at the issuer')
          }
          if (/pkce is required/i.test(combined)) report.pkce = true
        }
      } catch (error) {
        report.problems.push(String((error && error.message) || error))
      }
      return json(report)
    }
    if (url.pathname === '/oidc/login') {
      const state = await loadState(env)
      const oidc = await oidcConfig(env, request, state, pickOidcProvider(state, url.searchParams.get('provider')))
      if (!oidc) return fail('OIDC is not configured (OIDC_ISSUER / OIDC_CLIENT_ID)', 503)
      try {
        const endpoints = await oidcEndpoints(oidc)
        if (!endpoints.authorization) return fail('OIDC authorization endpoint missing', 502)
        const state = randomToken()
        const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
        const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))))
        const nonce = randomToken()
        const next = url.searchParams.get('next') === 'profile' ? 'profile' : ''
        const cookie = await oidcStateCookie(env, state, verifier, next, nonce, oidc.id)
        const target = new URL(endpoints.authorization)
        target.searchParams.set('client_id', oidc.clientId)
        target.searchParams.set('redirect_uri', oidc.redirectUri)
        target.searchParams.set('response_type', 'code')
        target.searchParams.set('scope', oidc.scope)
        target.searchParams.set('state', state)
        target.searchParams.set('code_challenge', challenge)
        target.searchParams.set('code_challenge_method', 'S256')
        target.searchParams.set('nonce', nonce)
        const prompt = url.searchParams.get('prompt')
        if (prompt === 'login' || prompt === 'consent') target.searchParams.set('prompt', prompt)
        // Ask the provider whether it knows this client before sending the
        // operator there. A client id that was never registered used to dump the
        // user on the provider's own error page ("client not found") with no clue
        // which provider or which id was wrong; now the broker says it.
        try {
          const check = await fetch(target.toString(), { redirect: 'manual' })
          const text = await check.text().catch(() => '')
          const combined = String(check.headers.get('location') ?? '') + ' ' + text
          if (/invalid_client|client not found|unknown client/i.test(combined)) {
            return fail(`OIDC 服务商「${oidc.label || oidc.id}」不认这个 client id（${oidc.clientId}）。请到该服务商后台登记这个 client，并在「设置 → OIDC 登录」里改成它分配给你的 client id 和 secret。`, 400)
          }
        } catch { /* the provider may not allow a probe; the real redirect still runs */ }
        return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': `oidc_state=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } })
      } catch (error) { return fail(String(error.message ?? error), 502) }
    }
    if (url.pathname === '/oidc/callback') {
      const clearOidcCookie = 'oidc_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
      const failOidc = (message, status = 400) => json({ error: message }, status, { 'set-cookie': clearOidcCookie })
      const returned = url.searchParams.get('state') ?? ''
      const consumed = await consumeOidcState(env, readCookie(request, 'oidc_state'), returned)
      if (!consumed?.ok) {
        const reason = String(consumed?.reason ?? 'invalid')
        if (reason === 'replay') return failOidc('OIDC state already used (replay)', 400)
        if (reason === 'expired') return failOidc('OIDC state expired', 400)
        return new Response('<meta charset="utf-8"><h2>OIDC 状态校验失败</h2><p>这个链接是回调地址，不能直接打开；请从「个人资料 → 使用 OIDC 登录 / 绑定」重新发起。</p><p><a href="/?view=profile">回到个人资料</a></p>', { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': clearOidcCookie } })
      }
      // The provider comes from the signed state cookie, so the callback
      // uses the configuration the sign-in actually started with. The state is
      // read before the provider is picked because the provider list lives in
      // it; reading it later left `cbState` undefined and broke every callback.
      const state = await loadState(env)
      const oidc = await oidcConfig(env, request, state, pickOidcProvider(state, consumed.provider))
      if (!oidc) return failOidc('OIDC is not configured', 503)
      const stateData = { state: consumed.state, verifier: consumed.verifier, nonce: consumed.nonce, next: consumed.next }
      const code = url.searchParams.get('code') ?? ''
      if (!code) return failOidc('missing authorization code', 400)
      try {
        const endpoints = await oidcEndpoints(oidc)
        if (!endpoints.token || !endpoints.userinfo || !endpoints.jwks) return failOidc('OIDC token/userinfo/jwks endpoint missing', 502)
        const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: oidc.redirectUri, client_id: oidc.clientId, code_verifier: stateData.verifier })
        if (oidc.clientSecret) body.set('client_secret', oidc.clientSecret)
        const tokenResponse = await fetch(endpoints.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
        const tokens = await tokenResponse.json()
        if (!tokenResponse.ok || !tokens.access_token) return failOidc(tokens.error_description || 'OIDC token exchange failed', 502)
        if (typeof tokens.id_token !== 'string' || !tokens.id_token) return failOidc('OIDC id_token missing from token response', 502)
        const parsed = parseJwt(tokens.id_token)
        const jwksResponse = await fetch(endpoints.jwks)
        if (!jwksResponse.ok) return failOidc('OIDC jwks fetch failed', 502)
        const jwks = await jwksResponse.json()
        await verifyJwtSignature(parsed, jwks)
        const claims = validateIdTokenClaims(parsed.payload, { issuer: oidc.issuer, clientId: oidc.clientId, nonce: stateData.nonce })
        const userResponse = await fetch(endpoints.userinfo, { headers: { authorization: `Bearer ${tokens.access_token}` } })
        const user = await userResponse.json()
        if (!userResponse.ok) return failOidc('OIDC userinfo failed', 502)
        try { checkUserinfoSub(user.sub, claims.sub) } catch (error) { return failOidc(error.message, 403) }
        if (user.email_verified === false) return failOidc('OIDC email is not verified', 403)
        if (user.iss != null && String(user.iss).replace(/\/$/, '') !== oidc.issuer) return failOidc('OIDC userinfo issuer mismatch', 403)
        const isAdmin = await adminAuthorized(request, env)
        if (stateData.next === 'profile' && !isAdmin) return failOidc('请先在 Secrets Broker 登录后再绑定 OIDC', 401)
        // The check is per provider. The old global issuer/sub check ran on
        // every sign-in, so any second identity was rejected as "not the bound
        // one" and every existing binding looked broken.
        const binding = oidcBindingFor(state, oidc)
        if (binding?.sub && claims.sub !== binding.sub) return failOidc('这个服务商已绑定另一个身份，请先在个人资料里解绑再绑定', 403)
        const boundSub = String(binding?.sub ?? '')
        if (!boundSub && !isAdmin) {
          const allowedSub = String(env.OIDC_ALLOWED_SUB ?? '')
          const allowedEmail = String(env.OIDC_ALLOWED_EMAIL ?? '')
          if (!allowedSub && !allowedEmail) return failOidc('首次 OIDC 登录需要管理员先登录绑定，或配置 OIDC_ALLOWED_SUB / OIDC_ALLOWED_EMAIL', 403)
          if (allowedSub && claims.sub !== allowedSub) return failOidc('OIDC 身份不在允许列表', 403)
          if (allowedEmail && String(user.email ?? '').toLowerCase() !== allowedEmail.toLowerCase()) return failOidc('OIDC 邮箱不在允许列表', 403)
        }
        await updateState(env, (next) => {
          next.profile ??= {}
          // Each provider is bound on its own, so a second identity provider
          // can be added without replacing the first one.
          next.profile.oidcBindings ??= {}
          next.profile.oidcBindings[oidc.id] = {
            providerId: oidc.id, issuer: oidc.issuer, sub: claims.sub,
            email: String(user.email ?? ''), name: String(user.name ?? user.preferred_username ?? ''),
            avatarUrl: String(user.picture ?? ''), boundAt: new Date().toISOString(),
          }
          // The single global identity (oidcIssuer/oidcSub) predates the
          // provider list and belongs to the legacy 'default' provider. Writing
          // it from any provider would silently steal the default binding.
          if (oidc.id === 'default') {
            next.profile.oidcIssuer = oidc.issuer
            next.profile.oidcSub = claims.sub
            next.profile.oidcEmail = String(user.email ?? next.profile.email ?? '')
          }
          // Sign-in only fills what is still empty, so a name or avatar the
          // operator set by hand is not replaced by the identity provider.
          next.profile.name ||= String(user.name ?? user.preferred_username ?? '')
          next.profile.email ||= String(user.email ?? '')
          next.profile.avatarUrl ||= String(user.picture ?? '')
          return next
        })
        const cookie = await createAdminCookie(env, request)
        await addAudit(env, { event: 'admin.oidc-login', email: user.email ?? claims.sub ?? '' })
        const headers = new Headers({ location: stateData.next === 'profile' ? '/?view=profile' : '/' })
        headers.append('set-cookie', `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=604800`)
        headers.append('set-cookie', clearOidcCookie)
        return new Response(null, { status: 302, headers })
      } catch (error) { return failOidc(String(error.message ?? error), 502) }
    }
    if (url.pathname === '/api/bootstrap') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      if (!env.NODEWARDEN_DB) return fail('D1 binding missing', 500)
      try { return json(await bootstrap(env, env.NODEWARDEN_DB)) } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/api/unlock' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      try {
        const encBytes = b64ToBytes(String(body.symEncKey ?? ''))
        const macBytes = b64ToBytes(String(body.symMacKey ?? ''))
        if (encBytes.length !== 32 || macBytes.length !== 32) return fail('invalid session keys', 400)
        const ttl = body.ttl === 'permanent' ? 0 : Math.max(60, Math.min(60 * 86400, Number(body.ttl) || 86400)) * 1000
        const expiresAt = ttl === 0 ? 0 : Date.now() + ttl
        const email = await vaultEmail(env, env.NODEWARDEN_DB, await loadState(env))
        const sessionData = { email, symEncKey: String(body.symEncKey), symMacKey: String(body.symMacKey), expiresAt }
        await putSession(env, sessionData)
        const completedTransfers = await processTransfers(env, sessionData)
        await pruneForeignGrants(env, sessionData)
        await addAudit(env, { event: 'vault.unlock', email, ttl: body.ttl ?? '24h' })
        return json({ ok: true, expiresAt, permanent: ttl === 0, completedTransfers })
      } catch (error) { return fail(String(error.message ?? error), 400) }
    }
    if (url.pathname === '/api/lock' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      if (!(await verifyAdminPassword(env, state, body.password))) return fail('管理密码错误', 401)
      await stateStub(env).fetch('https://state/session', { method: 'DELETE' })
      await addAudit(env, { event: 'vault.lock', source: 'password-confirmed' })
      // A locked vault ends every open task: the executor may no longer
      // redeem a credential.
      await cancelTasksFor(env, () => true, 'vault-locked')
      return json({ ok: true })
    }
    if (url.pathname === '/api/items/update' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '')
      if (!name) return fail('name required', 400)
      try {
        const nextName = await updateCipher(env, env.NODEWARDEN_DB, session, name, body)
        if (!nextName) return fail('item not found', 404)
        if (typeof body.noApproval === 'boolean') {
          await updateState(env, (state) => {
            state.policies ??= {}
            if (body.noApproval) state.policies[nextName] = { noApproval: true }
            else delete state.policies[nextName]
            return state
          })
        }
        // The expiry is stored per item, the same way the approval
        // policy is.
        if (body.expiresAt !== undefined) {
          const raw = body.expiresAt
          const stamp = raw === null || raw === 0 || raw === '' ? 0 : Date.parse(String(raw))
          if (!Number.isFinite(stamp)) return fail('invalid expiresAt', 400)
          await updateState(env, (state) => {
            state.secretExpiry ??= {}
            if (stamp > 0) state.secretExpiry[nextName] = { itemId: nextName, expiresAt: stamp }
            else delete state.secretExpiry[nextName]
            return state
          })
        }
        return json({ ok: true, name: nextName })
      } catch (error) {
        if (error.code === 'ambiguous_item_name') return json({ ok: false, error: '同名条目不止一个，请改用 itemId 指定要改哪一个', ids: error.ids }, 409)
        return fail(String(error.message ?? error), error.status ?? 500)
      }
    }
    if (url.pathname === '/api/items/delete' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '')
      try {
        const deleted = await deleteCipher(env, env.NODEWARDEN_DB, session, name, { itemId: body.itemId ? String(body.itemId) : undefined })
        if (!deleted) return fail('item not found', 404)
        return json({ ok: true })
      } catch (error) {
        if (error.code === 'ambiguous_item_name') return json({ ok: false, error: '同名条目不止一个，请改用 itemId 指定要删哪一个', ids: error.ids }, 409)
        return fail(String(error.message ?? error), error.status ?? 500)
      }
    }
    if (url.pathname === '/api/items/create' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      try { return json({ ok: true, ...(await createCipher(env, env.NODEWARDEN_DB, session, body)) }) } catch (error) { return fail(String(error.message ?? error), error.status ?? 400) }
    }
    if (url.pathname === '/api/items/import' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      try { await vault2WriteKey(env) } catch (error) { return fail(String(error.message ?? error), error.status ?? 423) }
      const body = await request.json().catch(() => ({}))
      const entries = Array.isArray(body) ? body : Array.isArray(body.items) ? body.items : []
      const created = []
      const skipped = []
      for (const entry of entries) {
        try { created.push((await createCipher(env, env.NODEWARDEN_DB, session, entry)).name) } catch (error) { skipped.push({ name: entry?.name, error: String(error.message ?? error) }) }
      }
      return json({ ok: true, created, skipped })
    }
    // The export hands over every password in one file, so it is the widest door
    // a stolen cookie could walk through — wider than reading a single item. It
    // takes the same second factor as /api/secret/reveal for that reason.
    if (url.pathname === '/api/items/export' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const { code } = await request.json().catch(() => ({}))
      const refused = await secondFactorWall(request, env, 'items.export', code)
      if (refused) return refused
      try {
        const state = await loadState(env)
        const v2 = await vault2Context(env)
        const items = []
        if (v2?.dek) {
          const listed = await vault2ListPlain(env, v2.dek, 0)
          for (const row of listed.items.filter((entry) => !entry.deletedAt)) {
            const payload = vault2Payload(row)
            items.push({ name: payload.name, url: payload.url, notes: payload.notes, value: payload.password, group: state.itemGroups?.[payload.name] ?? '', noApproval: state.policies?.[payload.name]?.noApproval === true })
          }
        } else {
          const user = await vaultUser(env, env.NODEWARDEN_DB, session)
          const rows = await env.NODEWARDEN_DB.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(user.id).all()
          for (const row of rows.results ?? []) {
            const decrypted = await decryptCipherRow(row, session)
            items.push({ name: decrypted.name, url: cipherUrl(decrypted.data), notes: decrypted.notes, value: extractSecret(decrypted), group: state.itemGroups?.[decrypted.name] ?? '', noApproval: state.policies?.[decrypted.name]?.noApproval === true })
          }
        }
        await addAudit(env, { event: 'items.export', via: 'web', totp: true, count: items.length })
        return json({ exportedAt: nowIso(), items })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/api/folders') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      try { return json({ folders: await listFolders(env, env.NODEWARDEN_DB, session) }) } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/api/items') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const completedTransfers = await processTransfers(env, session)
      try {
        const items = await listCiphers(env, env.NODEWARDEN_DB, session)
        // Self-heal the id->name map. A credential classified before the id was
        // cached has a kind recorded against its id but no name, so the list
        // showed it as unclassified even though the classification was saved.
        // This is the one place that holds both the ids and the names.
        {
          const state = await loadState(env)
          const known = new Set(Object.values(state.itemIds ?? {}))
          const missing = (items || []).filter((item) => item.id && item.name && !known.has(item.id))
          if (missing.length) {
            await updateState(env, (next) => {
              next.itemIds ??= {}
              for (const item of missing) next.itemIds[item.name] = item.id
              return next
            })
          }
        }
        // Enrich each item with the most recent activity recorded in the audit
        // trail, plus who performed it. Used by the list view so operators do
        // not have to open every item to see whether it is still in use.
        const state = await loadState(env)
        const latest = new Map()
        for (const entry of state.audit ?? []) {
          const item = entry.name || entry.oldName
          if (!item) continue
          const time = Date.parse(entry.time)
          if (!Number.isFinite(time)) continue
          const current = latest.get(item)
          if (!current || time > current.time) {
            // Admin/console activity has no agent; label it explicitly rather
            // than pretending an agent did it.
            latest.set(item, { time, actor: entry.agent || '', via: entry.via || (entry.agent ? 'agent' : 'web'), event: entry.event || '' })
          }
        }
        const enriched = items.map((item) => {
          const hit = latest.get(item.name)
          return {
            ...item,
            lastActivityAt: hit ? new Date(hit.time).toISOString() : '',
            lastActor: hit ? (hit.actor || '管理员') : '',
            lastEvent: hit ? hit.event : '',
          }
        })
        return json({ items: enriched, completedTransfers })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/api/policies' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim()
      if (!name) return fail('name required', 400)
      const session = await getSession(env)
      const state = await updateState(env, (next) => {
        next.policies ??= {}
        // The account is recorded with the policy: "don't ask me again" is an
        // answer about one credential in one vault, never a rule that follows
        // the name into whatever vault is unlocked next.
        if (body.noApproval === true) next.policies[name] = { noApproval: true, accountId: session?.email ?? next.settings?.vaultEmail ?? '' }
        else delete next.policies[name]
        return next
      })
      await addAudit(env, { event: 'policy.update', name, noApproval: body.noApproval === true })
      const view = publicState(state)
      return json({ ok: true, state: { ...view, fillPolicies: { ...view.fillPolicies, executionLayer: Boolean(String(env.FILL_EXECUTION_TOKEN ?? '')) } } })
    }
    if (url.pathname === '/api/use-policies' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const itemName = String(body.item ?? '').trim()
      if (!itemName) return fail('item required', 400)
      const itemId = await resolveItemId(env, env.NODEWARDEN_DB, session, itemName)
      if (!itemId) return fail('item not found', 404)
      const hosts = (Array.isArray(body.hosts) ? body.hosts : []).map((v) => String(v).toLowerCase().replace(/\.$/, '')).filter(Boolean)
      const methods = (Array.isArray(body.methods) ? body.methods : []).map((v) => String(v).toUpperCase()).filter(Boolean)
      const pathPrefixes = (Array.isArray(body.pathPrefixes) ? body.pathPrefixes : []).map(String).filter(Boolean)
      const ports = (Array.isArray(body.ports) ? body.ports : ['443']).map(String).filter(Boolean)
      if (!hosts.length || !methods.length) return fail('hosts and methods are required', 400)
      await updateState(env, (state) => {
        state.usePolicies ??= {}
        state.usePolicies[itemId] = { itemId, accountId: session.email, hosts, methods, pathPrefixes, ports, updatedAt: nowIso() }
        return state
      })
      await addAudit(env, { event: 'use-policy.update', name: itemName, itemId, hosts, methods })
      return json({ ok: true, itemId })
    }
    // The operator has seen a refusal and does not want it listed any more.
    // Dismissing changes nothing about permissions: only /api/action-grants does.
    if (url.pathname === '/api/denied/dismiss' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      await updateState(env, (next) => {
        delete next.deniedAttempts?.['deny\u0000' + String(body.agent ?? '') + '\u0000' + String(body.name ?? '') + '\u0000' + String(body.action ?? '')]
        return next
      })
      return json({ ok: true })
    }
    // Per-item target rules for secret.use: which hosts, methods and ports an
    // Agent may reach when the broker injects the credential server-side. This
    // is the switch behind http_request, and it is separate from a plaintext
    // read: it grants use, never the value.
    if (url.pathname === '/api/use-policy' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const itemName = String(body.item ?? '').trim()
      if (!itemName) return fail('item required', 400)
      const itemId = await resolveItemId(env, env.NODEWARDEN_DB, session, itemName)
      if (!itemId) return fail('item not found', 404)
      const hosts = body.anyHost === true
        ? ['*']
        : (Array.isArray(body.hosts) ? body.hosts : []).map((v) => String(v).toLowerCase().trim()).filter(Boolean)
      const methods = (Array.isArray(body.methods) ? body.methods : []).map((v) => String(v).toUpperCase()).filter(Boolean)
      const ports = (Array.isArray(body.ports) ? body.ports : ['443']).map(String).filter(Boolean)
      const pathPrefixes = (Array.isArray(body.pathPrefixes) ? body.pathPrefixes : []).map(String).filter(Boolean)
      if (!hosts.length || !methods.length) return fail('hosts and methods are required', 400)
      await updateState(env, (state) => {
        state.usePolicies ??= {}
        state.usePolicies[itemId] = { itemId, accountId: session.email, hosts, methods, pathPrefixes, ports, updatedAt: nowIso() }
        return state
      })
      await addAudit(env, { event: 'use-policy.update', name: itemName, itemId, hosts, methods })
      return json({ ok: true, itemId })
    }
    // Admin: classify a credential and configure its fill policy. The kind is an
    // explicit admin decision; the NodeWarden item type is never consulted.
    // The only endpoint that hands a plaintext value to a caller. It requires
    // the execution layer's own token, which is never given to an Agent, and a
    // one-shot authorization bound to this exact item, account and origin.
    if (url.pathname === '/api/fill/execute' && request.method === 'POST') {
      // Retired: the shared static token is not bound to a task or an
      // executor, so it is disabled unless an operator explicitly opts in
      // while migrating. The task control plane is the supported path.
      if (String(env.FILL_LEGACY_EXECUTE_ENABLED ?? '0') !== '1') return fail('the legacy execute path is disabled; use the task control plane', 410)
      if (!executionLayerAuthorized(env, request)) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const nonce = String(body.nonce ?? '')
      const origin = String(body.origin ?? '')
      if (!nonce) return fail('nonce required', 400)
      const session = await getSession(env)
      // The vault must still be unlocked: a locked vault ends the task.
      if (!session) return fail('vault locked', 423)
      const state = await loadState(env)
      const itemId = String(body.itemId ?? '')
      const agent = String(body.agent ?? '')
      if (!itemId || !agent) return fail('item and agent are required', 400)
      // Redeem atomically first: a replayed or concurrent request loses here.
      // The policy that is in force RIGHT NOW, handed to the DO so the check
      // and the nonce consumption share one transaction. A policy narrowed
      // after the authorization was issued invalidates it.
      // The DO reads the authoritative policy in the same transaction that
      // consumes the nonce, so no snapshot is passed in and a stale one can
      // never be used to redeem.
      const consumed = await consumeFillAuthorization(env, { nonce, agent, itemId, accountId: session.email, origin })
      if (!consumed?.ok) {
        await addAudit(env, { event: 'fill.redeem-deny', agent, itemId, origin, reason: consumed?.reason ?? 'unknown' })
        return fail('authorization is not valid: ' + (consumed?.reason ?? 'unknown'), 403)
      }
      const record = consumed.record ?? {}
      // The vault may have been locked between issuing and redeeming.
      if (record.accountId && String(record.accountId).toLowerCase() !== String(session.email).toLowerCase()) {
        await addAudit(env, { event: 'fill.redeem-deny', agent, itemId, origin, reason: 'account-mismatch' })
        return fail('authorization is not valid: account-mismatch', 403)
      }
      const found = await readSecretFromRows(env, env.NODEWARDEN_DB, session, record.itemName ?? '')
      if (!found) return fail('credential not found', 404)
      await addAudit(env, { event: 'fill.redeem', agent, itemId, origin, action: record.action ?? '' })
      // The value goes to the execution layer only. It is never echoed to the
      // Agent and never written to the audit log.
      return json({ username: found.username, password: found.value, totp: found.totp, origin: record.origin, action: record.action })
    }
    // Admin: re-grant a legacy authorisation to a concrete credential.
    //
    // A legacy grant that has no recorded identity binding cannot be migrated:
    // its name may now denote a different cipher. This endpoint is therefore a
    // NEW authorisation by the admin, not a restoration of the old one. It
    // never widens the old grant: the admin states the item, the action and
    // the duration, and the new capability is bounded by exactly those terms.
    if (url.pathname === '/api/legacy/regrant' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const agentName = String(body.agent ?? '').trim()
      const itemName = String(body.item ?? '').trim()
      const action = String(body.action ?? 'secret.read')
      if (!agentName || !itemName) return fail('agent and item are required', 400)
      if (!SECRET_ACTIONS.has(action)) return fail('unknown action', 400)
      // The target is resolved from the live vault, never from the old grant.
      // A same-named item that was deleted and recreated therefore resolves to
      // the NEW cipher id, and the admin is granting against that id.
      const itemId = await resolveItemId(env, env.NODEWARDEN_DB, session, itemName)
      // Name the item: a retry that only says "item not found" gives no way to
      // tell which credential is gone.
      if (!itemId) return fail('凭据「' + itemName + '」在 vault 里已不存在，无法重新授权；请先删除这条旧授权', 404)
      const accountId = String(session.email ?? '').trim()
      if (!isWellFormedAccountId(accountId)) return fail('account scope unavailable', 403)
      const state = await loadState(env)
      const key = capabilityKey(agentName, itemId, action)
      const existing = state.capabilities?.[key] ?? null
      if (existing) {
        const status = capabilityStatus(existing)
        if (status === 'valid' || status === 'expiring') return fail('a live capability already exists for this item and action', 409)
      }
      // The duration is stated by the admin and capped. The old grant's terms
      // are NOT inherited: a re-grant can never be longer than what the admin
      // asks for here.
      const duration = CAPABILITY_DURATIONS[body.duration ?? '1d']
      if (duration === undefined) return fail('unknown duration', 400)
      const now = Date.now()
      await updateState(env, (next) => {
        next.capabilities ??= {}
        next.capabilities[key] = {
          id: key, subjectId: agentName, accountId, itemId, itemName, action,
          mode: 'preapproved', createdAt: new Date(now).toISOString(), createdBy: 'admin:legacy-regrant',
          expiresAt: duration === null ? null : now + duration,
          maxUses: null, usedCount: 0,
          revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1,
        }
        // The name is now bound to this cipher id, so a later rename or a
        // delete-and-recreate cannot re-point it.
        next.legacyItemBindings ??= {}
        next.legacyItemBindings[agentName + '\u0000' + itemName] = { itemId, boundAt: new Date(now).toISOString(), boundBy: 'admin:legacy-regrant' }
        // The old grant no longer needs to be migrated: it is superseded.
        const oldGrant = next.grants?.[grantKey(agentName, itemName)]
        if (oldGrant && !oldGrant.revokedAt) oldGrant.revokedAt = new Date(now).toISOString()
        return next
      })
      await addAudit(env, { event: 'legacy.regrant', agent: agentName, name: itemName, itemId, action, duration: body.duration ?? '1d', account: accountId })
      return json({ ok: true, agent: agentName, item: itemName, itemId, action, duration: body.duration ?? '1d' })
    }

    // ── Fill task control plane (executor facing) ────────────────────────
    // Every endpoint below requires the executor identity. The task
    // credential is a second, independent check on the task itself.
    if (url.pathname === '/api/fill/executors/register' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const result = await registerFillExecutor(env, body)
      if (!result.ok) return fail(result.reason ?? 'invalid', 400)
      return json(result)
    }
    if (url.pathname === '/api/fill/executors/revoke' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const executorId = String(body.executorId ?? '').trim()
      if (!executorId) return fail('executorId required', 400)
      await updateState(env, (state) => {
        const record = state.fillExecutors?.[executorId]
        if (record) { record.revokedAt = nowIso(); record.revokedBy = 'admin' }
        return state
      })
      await addAudit(env, { event: 'fill.executor.revoke', executor: executorId })
      return json({ ok: true, executorId })
    }
    // Claim the next task for this executor.
    if (url.pathname === '/api/fill/tasks/claim' && request.method === 'POST') {
      const executor = await resolveFillExecutor(env, request)
      if (!executor) return fail('unauthorized', 401)
      const state = executor.state
      const limited = await fillRateLimited(env, 'exec:' + executor.executorId, FILL_RATE_LIMITS.executorOpsPerMinute, 60000)
      if (limited) return fail('rate limited', 429)
      const response = await stateStub(env).fetch('https://state/fill/task/claim', {
        method: 'POST',
        body: JSON.stringify({ executorId: executor.executorId }),
      })
      const result = await response.json()
      if (!result?.ok) return json({ status: 'idle' })
      const task = result.task
      // The task credential is short lived and bound to this task, this
      // executor, this account, agent, credential, origin, action and policy
      // revision. The Agent never receives it.
      const nonce = base64Url(crypto.getRandomValues(new Uint8Array(18)))
      const expiresAt = Date.now() + FILL_TASK_CREDENTIAL_TTL_MS
      // that actually owns the task.
  // The scope is computed from the claimed task, so it names the executor
      // that actually owns the task.
      const scoped = { ...task, executorId: executor.executorId }
      const credential = await signTaskCredential(env, scoped, nonce, expiresAt)
          await addAudit(env, { event: 'fill.task.claim', agent: task.agent, itemId: task.cipherId, origin: task.origin, taskId: task.taskId, executor: executor.executorId })
      return json({
        ok: true,
        taskId: task.taskId,
        origin: task.origin,
        action: task.action,
        credential,
        credentialExpiresAt: expiresAt,
        policyRevision: task.policyRevision,
      })
    }

    if (url.pathname === '/api/fill/task/redeem' && request.method === 'POST') {
      const executor = await resolveFillExecutor(env, request)
      if (!executor) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const taskId = String(body.taskId ?? '')
      const credential = String(body.credential ?? '')
      if (!taskId || !credential) return fail('taskId and credential are required', 400)
      const state = executor.state
      const limited = await fillRateLimited(env, 'exec:' + executor.executorId, FILL_RATE_LIMITS.executorOpsPerMinute, 60000)
      if (limited) return fail('rate limited', 429)
      // The task must exist and must be in a state that allows a redemption.
      const taskResponse = await stateStub(env).fetch('https://state/fill/task/get', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      })
      const taskPayload = await taskResponse.json()
      if (!taskPayload?.ok) return fail('unknown task', 404)
      const task = taskPayload.task
      if (task.executorId !== executor.executorId) return fail('executor-mismatch', 403)
      if (task.cancelRequested === true) return fail('task cancelled', 409)
      // The origin in the request has to match the origin of the task. A
      // caller must not be able to redirect the credential elsewhere.
      const asked = normalizeOrigin(body.origin)
      if (asked && asked.origin !== task.origin) {
        await addAudit(env, { event: 'fill.redeem-deny', agent: task.agent, itemId: task.cipherId, origin: task.origin, taskId, reason: 'origin-mismatch' })
        return fail('task credential is not valid: origin-mismatch', 403)
      }
      if (!['claimed', 'running'].includes(task.state)) return fail('task is not claimable: ' + task.state, 409)
      // The vault must still be unlocked.
      const session = await getSession(env)
      if (!session) return fail('vault locked', 423)
      // The task belongs to the account that created it. A vault that is now
      // unlocked with a different account must not redeem it, and the check
      // happens before the credential is read so the refusal says nothing
      // about the vault contents.
      if (task.accountId && String(task.accountId).toLowerCase() !== String(session.email ?? '').toLowerCase()) {
        await addAudit(env, { event: 'fill.redeem-deny', agent: task.agent, itemId: task.cipherId, origin: task.origin, taskId, reason: 'account-mismatch' })
        return fail('task credential is not valid: account-mismatch', 403)
      }
      // The credential must be bound to exactly this task scope.
      const verified = await verifyTaskCredential(env, credential, task)
      if (!verified) return fail('task credential is not valid', 403)
      // The stored task carries the item name so the broker can read the
      // credential. The executor never sees the item name.
      const stored = await stateStub(env).fetch('https://state/fill/task/secret', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      })
      const secret = await stored.json()
      if (!secret?.ok) return fail('credential unavailable', 404)
      const found = await readSecretFromRows(env, env.NODEWARDEN_DB, session, secret.itemName)
      if (!found) return fail('credential not found', 404)
      // One redemption per task: the credential nonce is burned atomically, so
      // a replay of the same credential cannot fetch the value twice.
      const burned = await stateStub(env).fetch('https://state/fill/task/burn', {
        method: 'POST',
        body: JSON.stringify({ taskId, nonce: verified.n }),
      })
      const burnResult = await burned.json()
      if (!burnResult?.ok) return fail('task credential is not valid: ' + (burnResult?.reason ?? 'unknown'), 403)
      await addAudit(env, { event: 'fill.redeem', agent: task.agent, itemId: task.cipherId, origin: task.origin, action: task.action, taskId: task.taskId, executor: executor.executorId })
      return json({ username: found.username, password: found.value, totp: found.totp, origin: task.origin, action: task.action, taskId: task.taskId })
    }
    // The executor reports progress. The payload is a strict allowlist: a
    // credential, a cookie, a page or a header can never travel this way.
    if (url.pathname === '/api/fill/tasks/report' && request.method === 'POST') {
      const executor = await resolveFillExecutor(env, request)
      if (!executor) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const taskId = String(body.taskId ?? '')
      const state = String(body.state ?? '')
      if (!taskId) return fail('taskId required', 400)
      if (!['running', 'completed', 'failed', 'cancelled'].includes(state)) return fail('unknown state', 400)
      const taskResponse = await stateStub(env).fetch('https://state/fill/task/get', { method: 'POST', body: JSON.stringify({ taskId }) })
      const taskPayload = await taskResponse.json()
      if (!taskPayload?.ok) return fail('unknown task', 404)
      const task = taskPayload.task
      if (task.executorId !== executor.executorId) return fail('executor-mismatch', 403)
      // A cancelled task stays cancelled: the executor cannot revive it by
      // reporting a later state.
      if (task.cancelRequested === true && state !== 'cancelled') {
        return fail('task was cancelled', 409)
      }
      const outcome = String(body.outcome ?? '').slice(0, 32)
      const errorCode = body.errorCode ? String(body.errorCode).slice(0, 64) : ''
      const redirected = body.redirected === true
      const captcha = body.captcha === true
      const finalOrigin = normalizeOrigin(body.finalOrigin)?.origin ?? ''
      const transition = await stateStub(env).fetch('https://state/fill/task/transition', {
        method: 'POST',
        body: JSON.stringify({ taskId, to: state, executorId: executor.executorId }),
      })
      const result = await transition.json()
      if (!result?.ok) return fail(result?.reason ?? 'transition refused', 409)
      // Only the allowed outcome fields are recorded.
      await addAudit(env, {
        event: 'fill.task.' + state, agent: task.agent, itemId: task.cipherId, origin: task.origin,
        taskId, executor: executor.executorId, outcome, errorCode, redirected, captcha,
      })
      return json({ ok: true, state: result.state })
    }
    // The executor asks whether it may continue. A cancelled task is reported
    // as cancelled, and the executor is expected to stop and destroy its
    // browser context.
    if (url.pathname === '/api/fill/tasks/status' && request.method === 'POST') {
      const executor = await resolveFillExecutor(env, request)
      if (!executor) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const taskId = String(body.taskId ?? '')
      if (!taskId) return fail('taskId required', 400)
      const taskResponse = await stateStub(env).fetch('https://state/fill/task/get', { method: 'POST', body: JSON.stringify({ taskId }) })
      const taskPayload = await taskResponse.json()
      if (!taskPayload?.ok) return fail('unknown task', 404)
      const task = taskPayload.task
      if (task.executorId !== executor.executorId) return fail('executor-mismatch', 403)
      return json({ ok: true, state: task.state, cancelRequested: task.cancelRequested === true })
    }


    // Admin: cancel a task. The broker records the request; the executor
    // confirms separately, so the broker never claims a task is stopped
    // before the executor agrees.
    if (url.pathname === '/api/fill/tasks/cancel' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const taskId = String(body.taskId ?? '')
      if (!taskId) return fail('taskId required', 400)
      const reason = String(body.reason ?? 'admin').slice(0, 32)
      const response = await stateStub(env).fetch('https://state/fill/task/request-cancel', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      })
      const result = await response.json()
      if (!result?.ok) return fail(result?.reason ?? 'unknown task', 404)
      await addAudit(env, { event: 'fill.task.cancel-requested', taskId, reason })
      return json({ ok: true, taskId, state: result.state, cancelRequested: true })
    }
    // Admin: list the tasks, so the console can show what is open.
    if (url.pathname === '/api/fill/tasks' && request.method === 'GET') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const response = await stateStub(env).fetch('https://state/fill/task/list', { method: 'POST', body: JSON.stringify({}) })
      const payload = await response.json()
      const tasks = Array.isArray(payload.tasks) ? payload.tasks : []
      const state = await loadState(env)
      const executors = Object.values(state.fillExecutors ?? {}).map((entry) => ({
        executorId: entry.executorId, revokedAt: entry.revokedAt ?? '', createdAt: entry.createdAt ?? '',
      }))
      return json({ tasks, executors })
    }

    if (url.pathname === '/api/fill/policy' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const itemName = String(body.item ?? '').trim()
      if (!itemName) return fail('item required', 400)
      const itemId = await resolveItemId(env, env.NODEWARDEN_DB, session, itemName)
      if (!itemId) return fail('item not found', 404)
      const kind = String(body.kind ?? '')
      if (!CREDENTIAL_KINDS.has(kind)) return fail('kind must be api or web', 400)
      const origins = (Array.isArray(body.origins) ? body.origins : [])
        .map((value) => normalizeOrigin(value)?.origin)
        .filter(Boolean)
      const actions = (Array.isArray(body.actions) ? body.actions : [])
        .map((value) => String(value))
        .filter((value) => FILL_ACTIONS.has(value))
      if (kind === 'web' && !origins.length) return fail('web credentials need at least one https origin', 400)
      if (kind === 'web' && !actions.length) return fail('web credentials need at least one action', 400)
      await updateState(env, (state) => applyCredentialKind(state, { itemId, kind, origins, actions, accountId: session.email, autoApprove: body.autoApprove === true }))
      await addAudit(env, { event: 'fill-policy.update', name: itemName, itemId, kind, origins, actions })
      // The policy changed, so any task still working on this credential is
      // cancelled. The executor stops at its next checkpoint.
      await cancelTasksFor(env, (task) => task.cipherId === itemId, 'policy-changed')
      return json({ ok: true, itemId, kind, origins, actions })
    }
    if (url.pathname === '/api/fill/policies' && request.method === 'GET') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const kinds = state.credentialKinds ?? {}
      const policies = state.fillPolicies ?? {}
      const reads = state.plaintextReadPolicies ?? {}
      const items = Object.entries(kinds).map(([itemId, kind]) => ({
        itemId, kind,
        itemName: Object.keys(state.itemIds ?? {}).find((name) => state.itemIds[name] === itemId) ?? '',
        origins: policies[itemId]?.origins ?? [], actions: policies[itemId]?.actions ?? [],
        autoApprove: policies[itemId]?.autoApprove === true, accountId: policies[itemId]?.accountId ?? '',
        plaintextRead: Boolean(reads[itemId]),
        plaintextReadExpiresAt: reads[itemId]?.expiresAt ?? 0,
      }))
      return json({ items, executionLayer: Boolean(String(env.FILL_EXECUTION_TOKEN ?? '')) })
    }
    // Admin: allow or revoke plaintext reads for an api credential.
    // Admin: clear a classification and everything it authorised.
    if (url.pathname === '/api/fill/policy/delete' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const itemName = String(body.item ?? '').trim()
      if (!itemName) return fail('item required', 400)
      const itemId = await resolveItemId(env, env.NODEWARDEN_DB, session, itemName)
      if (!itemId) return fail('item not found', 404)
      await updateState(env, (state) => {
        delete state.credentialKinds?.[itemId]
        delete state.fillPolicies?.[itemId]
        delete state.plaintextReadPolicies?.[itemId]
        return state
      })
      await addAudit(env, { event: 'fill-policy.delete', name: itemName, itemId })
      await cancelTasksFor(env, (task) => task.cipherId === itemId, 'policy-deleted')
      return json({ ok: true, itemId })
    }
    if (url.pathname === '/api/fill/read-policy' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const itemName = String(body.item ?? '').trim()
      if (!itemName) return fail('item required', 400)
      const itemId = await resolveItemId(env, env.NODEWARDEN_DB, session, itemName)
      if (!itemId) return fail('item not found', 404)
      const kind = credentialKind(await loadState(env), itemId)
      if (kind === 'web') return fail('website credentials are fill-only and cannot be read as plaintext', 400)
      if (kind !== 'api') return fail('classify the credential as api first', 400)
      const allow = body.allow === true
      await updateState(env, (state) => {
        state.credentialKinds ??= {}
        state.credentialKinds[itemId] = 'api'
        state.plaintextReadPolicies ??= {}
        if (allow) {
          const ttlDays = Math.max(1, Math.min(365, Number(body.ttlDays) || 30))
          state.plaintextReadPolicies[itemId] = { itemId, accountId: session.email, expiresAt: Date.now() + ttlDays * 86400e3, createdAt: nowIso() }
        } else {
          delete state.plaintextReadPolicies[itemId]
        }
        return state
      })
      await addAudit(env, { event: 'plaintext-read-policy.update', name: itemName, itemId, allow })
      return json({ ok: true, itemId, allow })
    }
    if (url.pathname === '/api/action-grants' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      // Capabilities bind to a concrete vault account; never issue with a blank
      // scope (the consume gate would treat it as account-agnostic).
      const adminAccount = String(session.email ?? '').trim()
      if (!isWellFormedAccountId(adminAccount)) return fail('account scope unavailable', 403)
      const body = await request.json().catch(() => ({}))
      const agentName = String(body.agent ?? '').trim()
      const itemName = String(body.item ?? '').trim()
      const actions = (Array.isArray(body.actions) ? body.actions : []).map(String).filter((a) => SECRET_ACTIONS.has(a))
      if (!agentName || !itemName || !actions.length) return fail('agent, item and actions required', 400)
      const itemId = await resolveItemId(env, env.NODEWARDEN_DB, session, itemName)
      if (!itemId) return fail('item not found', 404)
      // Per-action terms: body.terms = { 'secret.read': { duration, maxUses }, 'secret.use': {...} }.
      // duration: 1d | 7d | 30d | permanent (default permanent).
      // maxUses: positive int | 'unlimited' (default unlimited).
      // mode: preapproved (default) — temporary grants come from approvals.
      const terms = (body.terms && typeof body.terms === 'object' ? body.terms : {})
      const parsedTerms = {}
      for (const action of actions) {
        const t = (terms[action] && typeof terms[action] === 'object' ? terms[action] : {})
        if (t.duration != null && !['1d', '7d', '30d', 'permanent'].includes(t.duration)) return fail('duration must be 1d, 7d, 30d or permanent', 400)
        const duration = t.duration ?? 'permanent'
        let maxUses = null
        if (t.maxUses != null && t.maxUses !== 'unlimited') {
          // Strict integer: reject floats, strings and out-of-range values
          // instead of silently flooring them into a different grant.
          if (typeof t.maxUses !== 'number' || !Number.isInteger(t.maxUses) || t.maxUses < 1 || t.maxUses > 1000000) return fail('maxUses must be a positive integer or "unlimited"', 400)
          maxUses = t.maxUses
        }
        parsedTerms[action] = { duration, maxUses }
      }
      await updateState(env, (state) => {
        state.actionGrants ??= {}
        const key = actionGrantKey(agentName, itemId)
        state.actionGrants[key] = { id: key, subjectId: agentName, accountId: adminAccount, itemId, itemName, actions, legacy: false, createdAt: nowIso() }
        state.capabilities ??= {}
        const now = Date.now()
        for (const action of actions) {
          const { duration, maxUses } = parsedTerms[action]
          const ckey = capabilityKey(agentName, itemId, action)
          state.capabilities[ckey] = {
            id: ckey, subjectId: agentName, accountId: adminAccount, itemId, itemName, action,
            mode: 'preapproved', createdAt: new Date(now).toISOString(), createdBy: 'admin:' + adminAccount,
            expiresAt: CAPABILITY_DURATIONS[duration] == null ? null : now + CAPABILITY_DURATIONS[duration],
            maxUses, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1,
          }
        }
        return state
      })
      await addAudit(env, { event: 'action-grant.update', agent: agentName, name: itemName, itemId, actions, terms: parsedTerms })
      return json({ ok: true, itemId, terms: parsedTerms })
    }
    if (url.pathname === '/api/action-grants/revoke' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const agentName = String(body.agent ?? '')
      // One row in the dialog is one request; "revoke everything I ticked" is
      // the same operation repeated, so it arrives as a list and is applied in
      // a single state write instead of one round-trip per row.
      const targets = Array.isArray(body.targets)
        ? body.targets.slice(0, 200).map((entry) => ({ itemId: String(entry?.itemId ?? ''), action: String(entry?.action ?? '') }))
        : [{ itemId: String(body.itemId ?? ''), action: String(body.action ?? '') }]
      const wantedTargets = targets.filter((entry) => entry.itemId)
      if (!wantedTargets.length || !agentName) return fail('itemId and agent required', 400)
      for (const entry of wantedTargets) {
        if (entry.action && !SECRET_ACTIONS.has(entry.action)) return fail('unknown action', 400)
      }
      // Only revoke grants that belong to the currently unlocked vault account.
      // Soft-revoke: capabilities keep revokedAt/revokedBy for status display;
      // the consume gate rejects them. An action on a target limits it to that
      // one action.
      const loaded = await loadState(env)
      for (const entry of wantedTargets) {
        // A capability minted by the consent page has no actionGrants row of its
        // own, so "grant not found" used to block the only button that could
        // take it back. Either record is enough to revoke.
        const existing = loaded.actionGrants?.[actionGrantKey(agentName, entry.itemId)]
        const capKeys = (entry.action ? [entry.action] : [...SECRET_ACTIONS])
          .map((action) => loaded.capabilities?.[capabilityKey(agentName, entry.itemId, action)])
          .filter((cap) => cap && !cap.revokedAt)
        if (!existing && !capKeys.length) return fail('grant not found', 404)
        const owner = (existing || capKeys[0])?.accountId
        if (owner && String(owner).toLowerCase() !== String(session.email).toLowerCase()) return fail('grant belongs to another account', 403)
      }
      const revoked = []
      await updateState(env, (state) => {
        const now = new Date().toISOString()
        for (const entry of wantedTargets) {
          const key = actionGrantKey(agentName, entry.itemId)
          const grant = state.actionGrants?.[key]
          const revokedActions = entry.action ? [entry.action] : (grant?.actions ?? [...SECRET_ACTIONS])
          for (const action of revokedActions) {
            const ckey = capabilityKey(agentName, entry.itemId, action)
            const cap = state.capabilities?.[ckey]
            if (cap) { cap.revokedAt = now; cap.revokedBy = 'admin:' + session.email }
            revoked.push({ itemId: entry.itemId, action, found: Boolean(cap), ckey, n: Object.keys(state.capabilities || {}).length })
          }
          if (!grant) continue
          if (!entry.action) delete state.actionGrants[key]
          else {
            const rest = (grant.actions ?? []).filter((a) => a !== entry.action)
            if (rest.length) grant.actions = rest
            else delete state.actionGrants[key]
          }
        }
        return state
      })
      await addAudit(env, { event: 'action-grant.revoke', agent: agentName, itemId: wantedTargets.length === 1 ? wantedTargets[0].itemId : '', items: wantedTargets.length, actions: revoked.map((entry) => entry.action) })
      return json({ ok: true, revoked, count: revoked.length })
    }
    // Admin-only read of geo events. Returns already-sanitised records from the
    // DO ring buffer; raw IPs, tokens and secret values are never stored, so
    // there is nothing sensitive to leak here.
    if (url.pathname === '/api/geo/events') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      if (!GEO_ENABLED(env)) return json({ ok: true, enabled: false, events: [], cursor: 0, hasMore: false, total: 0 })
      const range = String(url.searchParams.get('range') || '24h')
      const windowMs = range === '1h' ? 3600e3 : (range === '7d' ? 7 * 86400e3 : 24 * 3600e3)
      const sinceSeq = Number(url.searchParams.get('sinceSeq') || 0)
      const limit = Number(url.searchParams.get('limit') || 200)
      const response = await stateStub(env).fetch('https://state/geo/query', { method: 'POST', body: JSON.stringify({ windowMs, sinceSeq, limit }) })
      const payload = await response.json()
      let operator = null
      try {
        const opRes = await stateStub(env).fetch('https://state/geo/operator')
        operator = (await opRes.json()).operator ?? null
      } catch {}
      return json({ ok: true, enabled: true, range, operator, events: payload.events ?? [], cursor: payload.cursor ?? 0, hasMore: payload.hasMore === true, total: payload.total ?? 0 })
    }
    if (url.pathname === '/api/state') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const reminders = buildReminders(state)
      // Fire the notification batch opportunistically on admin page loads; the
      // helper de-duplicates per (agent, kind, threshold) so this cannot spam.
      try { await dispatchReminderBatch(env, state, url.origin, ctx) } catch {}
    const view = publicState(state)
    return json({ ...view, fillPolicies: { ...view.fillPolicies, executionLayer: Boolean(String(env.FILL_EXECUTION_TOKEN ?? '')) }, reminders, pendingCount: Object.keys(state.pending ?? {}).length })
    }
    // Read-only migration report: which agents still rely on legacy paths,
    // what would break, and current capability terms. Never mutates.
    if (url.pathname === '/api/migration-report' && request.method === 'GET') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      // Locked vault => no account scope => refuse rather than leak a global
      // cross-account report.
      if (!session) return fail('locked', 423)
      const state = await loadState(env)
      const account = (session?.email ?? '').toLowerCase()
      const report = { account: session?.email ?? '', agents: [], capabilities: [], legacyGrants: [] }
      for (const [name, agent] of Object.entries(state.agents ?? {})) {
        if (account && agent.account && String(agent.account).toLowerCase() !== account) continue
        const caps = Object.values(state.capabilities ?? {}).filter((c) => c.subjectId === name)
        const reads = caps.filter((c) => c.action === 'secret.read').map((c) => ({ status: capabilityStatus(c), expiresAt: c.expiresAt, maxUses: c.maxUses, usedCount: c.usedCount ?? 0 }))
        const uses = caps.filter((c) => c.action === 'secret.use').map((c) => ({ status: capabilityStatus(c), expiresAt: c.expiresAt, maxUses: c.maxUses, usedCount: c.usedCount ?? 0 }))
        report.agents.push({
          agent: name, legacy: agent.legacy === true, allowAll: agent.allowAll === true,
          needsUse: uses.length === 0, needsRead: reads.length === 0 && !agent.legacy,
          readTerms: reads, useTerms: uses,
        })
      }
      for (const cap of Object.values(state.capabilities ?? {})) {
        if (account && cap.accountId && String(cap.accountId).toLowerCase() !== account) continue
        report.capabilities.push({ id: cap.id, subjectId: cap.subjectId, itemId: cap.itemId, itemName: cap.itemName ?? '', action: cap.action, mode: cap.mode, status: capabilityStatus(cap), expiresAt: cap.expiresAt, maxUses: cap.maxUses, usedCount: cap.usedCount ?? 0, revokedAt: cap.revokedAt ?? null })
      }
      for (const grant of Object.values(state.grants ?? {})) {
        if (account && grant.account && String(grant.account).toLowerCase() !== account) continue
        report.legacyGrants.push({ agent: grant.agent, name: grant.name, mode: grant.mode, expiresAt: grant.expiresAt, maxReads: grant.maxReads, reads: grant.reads ?? 0, revokedAt: grant.revokedAt ?? null })
      }
      return json({ ok: true, report })
    }
    if (url.pathname === '/api/agents/create' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim()
      if (!/^[a-zA-Z0-9._-]{1,48}$/.test(name)) return fail('invalid agent name', 400)
      const token = randomToken()
      const session = await getSession(env)
      const account = session?.email || await vaultEmail(env, env.NODEWARDEN_DB, await loadState(env))
      let error = ''
      await updateState(env, (state) => {
        if (state.agents[name]) { error = 'agent already exists'; return state }
        // New agents are never legacy: only pre-existing records without an
        // explicit flag are treated as legacy by the loadState default.
        state.agents[name] = { hash: '', tokenWrapped: '', alias: String(body.alias ?? '').trim(), note: String(body.note ?? '').trim(), allow: Array.isArray(body.allow) ? body.allow : [], groups: Array.isArray(body.groups) ? body.groups : [], allowAll: body.allowAll === true, write: body.write === true, legacy: false, account, createdAt: nowIso() }
        return state
      })
      if (error) return fail(error, 409)
      const hash = await sha256Base64(token)
      const tokenWrapped = await wrapWithKek(encoder.encode(token), await kekBytes(env))
      await updateState(env, (state) => { state.agents[name].hash = hash; state.agents[name].tokenWrapped = tokenWrapped; return state })
      await addAudit(env, { event: 'agent.create', agent: name })
      return json({ ok: true, name, token })
    }
    if (url.pathname === '/api/agents/rotate' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '')
      if (!name) return fail('name required', 400)
      // graceHours lets the old token keep working while a running client is
      // updated. 0 (the default) cuts over immediately.
      const graceHours = Math.max(0, Math.min(24 * 30, Number(body.graceHours) || 0))
      const token = randomToken()
      const hash = await sha256Base64(token)
      const tokenWrapped = await wrapWithKek(encoder.encode(token), await kekBytes(env))
      let found = false
      let oldHash = ''
      await updateState(env, (state) => {
        const agent = state.agents[name]
        if (!agent) return state
        found = true
        oldHash = agent.hash
        if (graceHours > 0) agent.previous = { hash: agent.hash, tokenWrapped: agent.tokenWrapped, until: Date.now() + graceHours * 3600e3 }
        else delete agent.previous
        agent.hash = hash
        agent.tokenWrapped = tokenWrapped
        return state
      })
      if (!found) return fail('agent not found', 404)
      await addAudit(env, { event: 'agent.rotate', agent: name, graceHours: String(graceHours), oldHash: oldHash.slice(0, 8) })
      return json({ ok: true, name, token, graceHours })
    }
    if (url.pathname === '/api/agents/delete' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '')
      await updateState(env, (state) => {
        delete state.agents[name]
        for (const key of Object.keys(state.grants)) if (state.grants[key].agent === name) delete state.grants[key]
        for (const [id, entry] of Object.entries(state.pending)) if (entry.agent === name) delete state.pending[id]
        // Revoke (not delete) capabilities + drop actionGrants so a later
        // same-name recreate cannot silently inherit the old subject's grants.
        const now = new Date().toISOString()
        for (const cap of Object.values(state.capabilities ?? {})) {
          if (cap.subjectId === name && !cap.revokedAt) { cap.revokedAt = now; cap.revokedBy = 'agent-delete' }
        }
        for (const key of Object.keys(state.actionGrants ?? {})) if (state.actionGrants[key].subjectId === name) delete state.actionGrants[key]
        for (const [hash, token] of Object.entries(state.oauthTokens ?? {})) if (token.agent === name) delete state.oauthTokens[hash]
        return state
      })
      await addAudit(env, { event: 'agent.delete', agent: name })
      return json({ ok: true })
    }
    if (url.pathname === '/api/agents/rename' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '')
      const newName = String(body.newName ?? '').trim()
      if (!name || !newName || name === newName) return fail('name and newName required', 400)
      if (!/^[a-zA-Z0-9._:-]{1,64}$/.test(newName)) return fail('invalid newName', 400)
      let found = false
      let error = ''
      await updateState(env, (state) => {
        if (state.agents[newName]) { error = 'target agent already exists'; return state }
        if (state.agents[name]) {
          state.agents[newName] = state.agents[name]
          delete state.agents[name]
          found = true
        } else {
          const tokens = Object.values(state.oauthTokens ?? {}).filter((token) => token.agent === name)
          if (!tokens.length) return state
          if (state.agents[newName]) { error = 'target agent already exists'; return state }
          for (const token of tokens) token.agent = newName
          state.oauthAgentProfiles ??= {}
          if (state.oauthAgentProfiles[name]) {
            state.oauthAgentProfiles[newName] = state.oauthAgentProfiles[name]
            delete state.oauthAgentProfiles[name]
          }
          found = true
        }
        if (!found) return state
        const grants = state.grants ?? {}
        for (const [key, grant] of Object.entries(grants)) {
          if (grant.agent !== name) continue
          delete grants[key]
          grant.agent = newName
          grants[grantKey(newName, grant.name)] = grant
        }
        for (const entry of Object.values(state.pending ?? {})) if (entry.agent === name) entry.agent = newName
        for (const entry of Object.values(state.transfers ?? [])) if (entry.agent === name) entry.agent = newName
        // actionGrants are keyed by subjectId + itemId; a rename must carry
        // them across or every new-model grant silently detaches.
        for (const [key, grant] of Object.entries(state.actionGrants ?? {})) {
          if (grant.subjectId !== name) continue
          delete state.actionGrants[key]
          grant.subjectId = newName
          grant.id = actionGrantKey(newName, grant.itemId)
          state.actionGrants[actionGrantKey(newName, grant.itemId)] = grant
        }
        // capabilities are keyed by subjectId + itemId + action; same carry.
        for (const [key, cap] of Object.entries(state.capabilities ?? {})) {
          if (cap.subjectId !== name) continue
          delete state.capabilities[key]
          cap.subjectId = newName
          cap.id = capabilityKey(newName, cap.itemId, cap.action)
          state.capabilities[capabilityKey(newName, cap.itemId, cap.action)] = cap
        }
        return state
      })
      if (error) return fail(error, 409)
      if (!found) return fail('agent not found', 404)
      await addAudit(env, { event: 'agent.rename', agent: name, newName })
      return json({ ok: true, name: newName })
    }
    if (url.pathname === '/api/agents/update' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '')
      let found = false
      await updateState(env, (state) => {
        const agent = state.agents[name]
        if (agent) {
          found = true
          if (typeof body.alias === 'string') agent.alias = body.alias.trim()
          if (typeof body.note === 'string') agent.note = body.note.trim()
          if (Array.isArray(body.allow)) agent.allow = body.allow.map(String).filter(Boolean)
          if (Array.isArray(body.groups)) agent.groups = body.groups.map(String).filter(Boolean)
          if (typeof body.allowAll === 'boolean') agent.allowAll = body.allowAll
          if (typeof body.write === 'boolean') agent.write = body.write
          // Optional per-agent MCP surface. Empty/absent keeps today's behaviour
          // (every tool the token can reach); a non-empty list is an allowlist.
          if (Array.isArray(body.tools)) agent.tools = body.tools.map(String).map((tool) => tool.trim()).filter(Boolean).slice(0, 32)
          return state
        }
        const oauthExists = Object.values(state.oauthTokens ?? {}).some((token) => token.agent === name)
        if (!oauthExists) return state
        found = true
        state.oauthAgentProfiles ??= {}
        const profile = state.oauthAgentProfiles[name] ??= { alias: '', note: '', allow: [], groups: [], write: false }
        if (typeof body.alias === 'string') profile.alias = body.alias.trim()
        if (typeof body.note === 'string') profile.note = body.note.trim()
        if (Array.isArray(body.allow)) profile.allow = body.allow.map(String).filter(Boolean)
        if (Array.isArray(body.groups)) profile.groups = body.groups.map(String).filter(Boolean)
        if (typeof body.allowAll === 'boolean') profile.allowAll = body.allowAll
        if (typeof body.write === 'boolean') profile.write = body.write
        if (Array.isArray(body.tools)) profile.tools = body.tools.map(String).map((tool) => tool.trim()).filter(Boolean).slice(0, 32)
        return state
      })
      if (!found) return fail('agent not found', 404)
      return json({ ok: true })
    }
    // Manually extend an Agent's authorization window. Works for both static
    // Agents (state.agents[].expiresAt) and OAuth-connected Agents (every live
    // oauthTokens entry for that subject). Admin session required.
    if (url.pathname === '/api/agents/extend' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim()
      if (!name) return fail('name required', 400)
      // duration: number of days, or 'permanent' for no expiry.
      const raw = body.days ?? body.duration
      let expiresAt = null
      if (raw !== 'permanent') {
        const days = Number(raw)
        if (!Number.isFinite(days) || days <= 0 || days > 3650) return fail('days must be 1-3650 or "permanent"', 400)
        const current = Date.now()
        expiresAt = current + Math.floor(days * 86400e3)
      }
      let found = false
      let extendedTokens = 0
      await updateState(env, (state) => {
        const agent = state.agents?.[name]
        if (agent) {
          if (agent.account && String(agent.account).toLowerCase() !== String(session.email).toLowerCase()) return state
          agent.expiresAt = expiresAt === null ? null : expiresAt
          found = true
        }
        // OAuth subjects keep their window on the token records.
        for (const token of Object.values(state.oauthTokens ?? {})) {
          if (token.agent !== name) continue
          if (token.account && String(token.account).toLowerCase() !== String(session.email).toLowerCase()) continue
          token.expiresAt = expiresAt
          extendedTokens += 1
          found = true
        }
        return state
      })
      if (!found) return fail('agent not found', 404)
      await addAudit(env, { event: 'agent.extend', agent: name, expiresAt, days: raw === 'permanent' ? 'permanent' : Number(raw), tokens: extendedTokens })
      return json({ ok: true, name, expiresAt, permanent: expiresAt === null, oauthTokens: extendedTokens })
    }
    if (url.pathname === '/api/agents/token' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '')
      const state = await loadState(env)
      const agent = state.agents[name]
      if (!agent) return fail('agent not found', 404)
      if (!agent.tokenWrapped) return fail('this agent was created before token copy support; rotate it to get a new token', 409)
      try {
        const token = new TextDecoder().decode(await unwrapWithKek(agent.tokenWrapped, await kekBytes(env)))
        await addAudit(env, { event: 'agent.token-view', agent: name })
        return json({ ok: true, token })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/api/pending/decide' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const outcome = await decidePending(env, String(body.id ?? ''), String(body.decision ?? ''), 'web')
      if (!outcome) return fail('pending request not found', 404)
      return json({ ok: true, outcome })
    }
    if (url.pathname === '/api/grants/revoke' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      // An unlocked vault is the only trustworthy source of the account scope.
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const agentName = String(body.agent ?? '')
      const itemName = String(body.name ?? '')
      if (!agentName || !itemName) return fail('agent and name required', 400)
      const sessionAccount = String(session.email ?? '').trim()
      if (!isWellFormedAccountId(sessionAccount)) return fail('account scope unavailable', 403)
      const key = grantKey(agentName, itemName)
      let found = false
      let skippedOtherAccount = 0
      const revokedCapabilities = []
      let grantItemId = ''
      await updateState(env, (state) => {
        const grant = state.grants?.[key] ?? null
        if (grant) {
          // Refuse to touch a grant that belongs to a different vault account
          // instead of guessing: the caller cannot revoke across accounts.
          const grantAccount = typeof grant.account === 'string' ? grant.account.trim() : ''
          if (isWellFormedAccountId(grantAccount) && grantAccount.toLowerCase() !== sessionAccount.toLowerCase()) {
            skippedOtherAccount += 1
          } else if (!isWellFormedAccountId(grantAccount)) {
            // Legacy grant with no trustworthy account: refusing is the safe
            // action (we cannot prove it belongs to this vault).
            skippedOtherAccount += 1
          } else {
            grant.revokedAt = nowIso()
            found = true
            if (typeof grant.itemId === 'string') grantItemId = grant.itemId
          }
        }
        // Revoke capabilities migrated from this grant. Matching is by the
        // trusted session account plus a stable identity: the grant's itemId
        // when present, otherwise the recorded immutable name->itemId binding.
        // Subject+name alone would revoke a same-named item owned by another
        // account.
        const now = nowIso()
        const binding = state.legacyItemBindings?.[`${agentName}\u0000${itemName}`] ?? null
        const boundItemId = grantItemId || (binding && typeof binding.itemId === 'string' ? binding.itemId : '')
        for (const [ckey, cap] of Object.entries(state.capabilities ?? {})) {
          if (!cap || cap.revokedAt) continue
          if (cap.subjectId !== agentName) continue
          if (cap.itemName !== itemName) continue
          if (String(cap.accountId ?? '').toLowerCase() !== sessionAccount.toLowerCase()) continue
          if (boundItemId && cap.itemId !== boundItemId) continue
          cap.revokedAt = now
          cap.revokedBy = 'admin:grant-revoke'
          revokedCapabilities.push(ckey)
        }
        return state
      })
      if (!found && !revokedCapabilities.length) {
        if (skippedOtherAccount) return fail('grant belongs to another account', 403)
        return fail('grant not found', 404)
      }
      await addAudit(env, { event: 'grant.revoke', agent: agentName, name: itemName, account: sessionAccount, source: 'web', capabilities: revokedCapabilities.length })
      // A revoked authorisation ends the open tasks that depend on it.
      await cancelTasksFor(env, (task) => task.agent === agentName, 'capability-revoked')
      return json({ ok: true, revokedCapabilities: revokedCapabilities.length })
    }
    if (url.pathname === '/api/grants/sync' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const items = (Array.isArray(body.items) ? body.items : []).map(String).filter(Boolean)
      const selectedAgents = new Set((Array.isArray(body.agents) ? body.agents : []).map(String).filter(Boolean))
      if (!items.length) return fail('items required', 400)
      const seconds = Math.max(0, Number(body.seconds) || 0)
      const maxReads = body.maxReads == null || body.maxReads === '' ? null : Math.max(1, Number(body.maxReads) || 1)
      const targetFolder = String(body.targetFolder ?? '')
      const revokeUnselected = body.revokeUnselected === true
      const state = await loadState(env)
      const allAgents = new Set(Object.keys(state.agents ?? {}))
      for (const token of Object.values(state.oauthTokens ?? {})) if (token.agent) allAgents.add(token.agent)
      const queued = []
      const granted = []
      const revoked = []
      const errors = []
      for (const item of items) {
        for (const agentName of selectedAgents) {
          const agent = state.agents[agentName] ?? (() => {
            const token = Object.values(state.oauthTokens ?? {}).find((entry) => entry.agent === agentName)
            if (!token) return null
            const profile = state.oauthAgentProfiles?.[agentName] ?? {}
            return { account: token.account, allow: profile.allow ?? [], groups: profile.groups ?? [], write: profile.write === true, oauth: true }
          })()
          if (!agent) { errors.push({ agent: agentName, item, error: 'unknown agent' }); continue }
          if (agent.account && String(agent.account).toLowerCase() !== String(session.email).toLowerCase()) {
            try {
              const transfer = await queueTransfer(env, env.NODEWARDEN_DB, session, agentName, agent, item, targetFolder, { seconds, maxReads })
              queued.push({ agent: agentName, name: item, targetAccount: transfer.targetAccount, folder: transfer.folder })
            } catch (error) { errors.push({ agent: agentName, item, error: String(error.message ?? error) }) }
            continue
          }
          // seconds/maxReads are honored (not ignored): same-account shares
          // write both the legacy mirror and a preapproved read capability.
          const shareExpiresAt = seconds > 0 ? Date.now() + seconds * 1000 : null
          const shareMaxUses = maxReads
          const shareItemId = await ensureItemId(env, env.NODEWARDEN_DB, session, item)
          await updateState(env, (next) => {
            next.grants[grantKey(agentName, item)] = { agent: agentName, name: item, mode: 'share', createdAt: nowIso(), expiresAt: shareExpiresAt ?? 0, reads: 0, maxReads: shareMaxUses, revokedAt: null, noApproval: true, account: session.email, itemId: shareItemId }
            if (shareItemId) {
              next.capabilities ??= {}
              const ckey = capabilityKey(agentName, shareItemId, 'secret.read')
              next.capabilities[ckey] = { id: ckey, subjectId: agentName, accountId: session.email, itemId: shareItemId, itemName: item, action: 'secret.read', mode: 'preapproved', createdAt: nowIso(), createdBy: 'admin:' + session.email, expiresAt: shareExpiresAt, maxUses: shareMaxUses, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
            }
            // Sharing grants access but does not put the item in the Agent's
            // scope, and scope is what list_secrets filters on — so the Agent
            // could not even see the name it had just been given. Adding it here
            // is the piece that was missing.
            if (body.addToScope === true) {
              const owned = next.agents?.[agentName]
              if (owned) {
                owned.allow ??= []
                if (!owned.allow.includes(item)) owned.allow.push(item)
              } else {
                next.oauthAgentProfiles ??= {}
                const profile = next.oauthAgentProfiles[agentName]
                if (profile) {
                  profile.allow ??= []
                  if (!profile.allow.includes(item)) profile.allow.push(item)
                }
              }
            }
            return next
          })
          await addAudit(env, { event: 'grant.share', agent: agentName, name: item, account: session.email })
          granted.push({ agent: agentName, name: item })
        }
        if (revokeUnselected) {
          for (const agentName of allAgents) {
            if (selectedAgents.has(agentName)) continue
            const key = grantKey(agentName, item)
            const grant = state.grants?.[key]
            if (!grant || grant.revokedAt) continue
            await updateState(env, (next) => { if (next.grants[key]) next.grants[key].revokedAt = nowIso(); return next })
            await addAudit(env, { event: 'grant.revoke', agent: agentName, name: item, source: 'bulk-unselect' })
            revoked.push({ agent: agentName, name: item })
          }
        }
      }
      return json({ ok: true, queued, granted, revoked, errors })
    }
    if (url.pathname === '/api/grants/share' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim()
      const agents = Array.isArray(body.agents) ? body.agents.map(String).filter(Boolean) : []
      if (!name || agents.length === 0) return fail('name and agents required', 400)
      const seconds = Math.max(0, Number(body.seconds) || 0)
      const maxReads = body.maxReads == null || body.maxReads === '' ? null : Math.max(1, Number(body.maxReads) || 1)
      const state = await loadState(env)
      const queued = []
      const granted = []
      const errors = []
      for (const agentName of agents) {
        const agent = state.agents[agentName]
        if (!agent) { errors.push({ agent: agentName, error: 'unknown agent' }); continue }
        if (agent.account && String(agent.account).toLowerCase() !== String(session.email).toLowerCase()) {
          try {
            const transfer = await queueTransfer(env, env.NODEWARDEN_DB, session, agentName, agent, name, body.targetFolder, { seconds, maxReads })
            queued.push({ agent: agentName, name, targetAccount: transfer.targetAccount, folder: transfer.folder })
          } catch (error) { errors.push({ agent: agentName, error: String(error.message ?? error) }) }
          continue
        }
        const oneExpiresAt = seconds > 0 ? Date.now() + seconds * 1000 : null
        const oneItemId = await ensureItemId(env, env.NODEWARDEN_DB, session, name)
        await updateState(env, (next) => {
          next.grants[grantKey(agentName, name)] = { agent: agentName, name, mode: 'share', createdAt: nowIso(), expiresAt: oneExpiresAt ?? 0, reads: 0, maxReads, revokedAt: null, noApproval: true, account: session.email, itemId: oneItemId }
          if (oneItemId) {
            next.capabilities ??= {}
            const ckey = capabilityKey(agentName, oneItemId, 'secret.read')
            next.capabilities[ckey] = { id: ckey, subjectId: agentName, accountId: session.email, itemId: oneItemId, itemName: name, action: 'secret.read', mode: 'preapproved', createdAt: nowIso(), createdBy: 'admin:' + session.email, expiresAt: oneExpiresAt, maxUses, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
          }
          return next
        })
        await addAudit(env, { event: 'grant.share', name, agents: [agentName], account: session.email })
        granted.push({ agent: agentName, name })
      }
      return json({ ok: true, queued, granted, errors })
    }
    if (url.pathname === '/api/grants/restore' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const agentName = String(body.agent ?? '')
      const itemName = String(body.name ?? '')
      // 0 = permanent. Restoring used to force permanent for an expired grant,
      // which turned "give it back for an hour" into "give it back forever".
      const seconds = Math.max(0, Number(body.seconds) || 0)
      let found = false
      await updateState(env, (state) => {
        found = restoreGrantState(state, { agent: agentName, name: itemName, seconds })
        return state
      })
      if (!found) return fail('grant not found', 404)
      await addAudit(env, { event: 'grant.restore', agent: body.agent, name: body.name, seconds, source: 'web' })
      return json({ ok: true })
    }
    // Batch operations from the 授权 page. The per-grant routes take one key per
    // request, so a twenty-row selection was twenty round trips that could stop
    // halfway; one request over one state write either applies to every row or
    // reports the rows it could not find.
    if (url.pathname === '/api/grants/batch' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const action = String(body.action ?? '')
      if (action !== 'delete' && action !== 'restore') return fail('unknown action', 400)
      const keys = (Array.isArray(body.keys) ? body.keys : []).slice(0, 500)
        .map((entry) => ({ agent: String(entry?.agent ?? ''), name: String(entry?.name ?? '') }))
        .filter((entry) => entry.agent && entry.name)
      if (!keys.length) return fail('keys required', 400)
      const seconds = Math.max(0, Number(body.seconds) || 0)
      let changed = 0
      const missing = []
      await updateState(env, (state) => {
        for (const entry of keys) {
          if (action === 'delete') {
            if (state.grants?.[grantKey(entry.agent, entry.name)]) { delete state.grants[grantKey(entry.agent, entry.name)]; changed++ } else missing.push(entry)
            continue
          }
          if (restoreGrantState(state, { agent: entry.agent, name: entry.name, seconds })) changed++
          else missing.push(entry)
        }
        return state
      })
      await addAudit(env, { event: 'grant.batch', action, count: changed, seconds, source: 'web' })
      return json({ ok: true, changed, missing })
    }
    if (url.pathname === '/api/grants/update' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const key = grantKey(String(body.agent ?? ''), String(body.name ?? ''))
      let found = false
      await updateState(env, (state) => {
        const grant = state.grants[key]
        if (!grant) return state
        found = true
        if (typeof body.seconds === 'number') grant.expiresAt = body.seconds > 0 ? Date.now() + body.seconds * 1000 : 0
        if (body.maxReads === null || body.maxReads === '') grant.maxReads = null
        else if (body.maxReads != null) grant.maxReads = Math.max(1, Number(body.maxReads) || 1)
        return state
      })
      if (!found) return fail('grant not found', 404)
      await addAudit(env, { event: 'grant.update', agent: body.agent, name: body.name, source: 'web' })
      return json({ ok: true })
    }
    if (url.pathname === '/api/grants/delete' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const key = grantKey(String(body.agent ?? ''), String(body.name ?? ''))
      let found = false
      await updateState(env, (state) => { if (state.grants[key]) { delete state.grants[key]; found = true } return state })
      if (!found) return fail('grant not found', 404)
      await addAudit(env, { event: 'grant.delete', agent: body.agent, name: body.name, source: 'web' })
      return json({ ok: true })
    }
    if (url.pathname === '/api/stats') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const range = url.searchParams.get('range') ?? '24h'
      const state = await loadState(env)
      return json(statsFor(state, range))
    }
    if (url.pathname === '/api/audit') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const entries = state.audit ?? []
      if (url.searchParams.get('format') === 'csv') {
        // A BOM first, or Excel reads the Chinese fields as mojibake.
        const fields = ['time', 'event', 'agent', 'name', 'action', 'source', 'ok', 'account', 'targetOrigin', 'reason']
        const cell = (value) => {
          const text = value === undefined || value === null ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value))
          return /[",\n]/.test(text) ? '"' + text.split('"').join('""') + '"' : text
        }
        const csv = [fields.join(',')].concat(entries.map((entry) => fields.map((field) => cell(entry[field])).join(','))).join('\n')
        return new Response('\ufeff' + csv, {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="secrets-broker-audit.csv"',
            'cache-control': 'no-store',
          },
        })
      }
      return json({ entries })
    }
    if (url.pathname === '/api/audit/clear' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      await updateState(env, (state) => { state.audit = []; return state })
      return json({ ok: true })
    }
    if (url.pathname === '/api/accounts') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      try {
        const rows = await env.NODEWARDEN_DB.prepare('SELECT email FROM users ORDER BY created_at').all()
        return json({ accounts: (rows.results ?? []).map((row) => ({ email: row.email })) })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/api/profile/oidc/unbind' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      await updateState(env, (state) => { state.profile ??= {}; delete state.profile.oidcSub; delete state.profile.oidcEmail; return state })
      await addAudit(env, { event: 'profile.oidc-unbind' })
      return json({ ok: true })
    }
    if (url.pathname === '/api/notify/test' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      const notifications = state.settings?.notifications ?? {}
      if (body.simulateApproval === true) {
        const id = crypto.randomUUID()
        const entry = { id, agent: 'test-agent', name: '通知测试条目', account: await vaultEmail(env, env.NODEWARDEN_DB, state), createdAt: nowIso() }
        await updateState(env, (next) => { next.pending ??= {}; next.pending[id] = entry; return next })
        await notifyPending(env, new URL(request.url).origin, entry, {})
        await addAudit(env, { event: 'notify.test-approval', agent: 'test-agent', name: entry.name, id })
        return json({ ok: true, simulated: true, id, pending: entry })
      }
      const text = 'Secrets Broker 测试通知：通知渠道工作正常。'
      const results = {}
      if (notifications.telegram?.botToken && notifications.telegram?.chatId) {
        try { const response = await fetch(`https://api.telegram.org/bot${notifications.telegram.botToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: notifications.telegram.chatId, text }) }); results.telegram = response.status } catch (error) { results.telegram = String(error.message ?? error) }
      } else results.telegram = 'not configured'
      if (notifications.ntfy?.url && notifications.ntfy?.topic) {
        try { const response = await fetch(`${String(notifications.ntfy.url).replace(/\/$/, '')}/${encodeURIComponent(notifications.ntfy.topic)}`, { method: 'POST', headers: { title: 'Secrets Broker test' }, body: text }); results.ntfy = response.status } catch (error) { results.ntfy = String(error.message ?? error) }
      } else results.ntfy = 'not configured'
      if (notifications.gotify?.url && notifications.gotify?.token) {
        try { const response = await fetch(`${String(notifications.gotify.url).replace(/\/$/, '')}/message?token=${encodeURIComponent(notifications.gotify.token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Secrets Broker test', message: text, priority: 5 }) }); results.gotify = response.status } catch (error) { results.gotify = String(error.message ?? error) }
      } else results.gotify = 'not configured'
      if (notifications.wxpush?.url && notifications.wxpush?.token) {
        try { let response; if (notifications.wxpush.format === 'json') response = await fetch(notifications.wxpush.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${notifications.wxpush.token}` }, body: JSON.stringify({ title: 'Secrets Broker test', text, content: text }) }); else { const body = new URLSearchParams({ title: 'Secrets Broker test', content: text, token: notifications.wxpush.token }); response = await fetch(notifications.wxpush.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }) } results.wxpush = response.status } catch (error) { results.wxpush = String(error.message ?? error) }
      } else results.wxpush = 'not configured'
      return json({ ok: true, results })
    }
    // The model pickers. Workers AI comes from a bundled catalogue (a binding can
    // run a model but cannot list them); a custom endpoint is asked for its own
    // list, which is what turns "type the model name" into a dropdown.
    if (url.pathname === '/api/ai/models' && request.method === 'GET') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const fetchCustom = url.searchParams.get('fetch') === '1'
      const catalog = await aiModelCatalog(env, state.settings, { fetchCustom })
      return json({ ok: true, ...catalog })
    }
    // The assistant, and the facts it is given. Read-only: it can explain and
    // suggest, and it cannot change a thing. The snapshot is built here, on the
    // server, from state metadata — no credential value, username or TOTP seed
    // ever enters it, and the model never sees the vault.
    if (url.pathname === '/api/ai/ask' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const question = String(body.question ?? '').trim()
      if (!question) return fail('question required', 400)
      const state = await loadState(env)
      const session = await getSession(env)
      const snapshot = aiSnapshot(state, { vaultUnlocked: Boolean(session), scope: await vaultItemNames(env, env.NODEWARDEN_DB) })
      const history = Array.isArray(body.history) ? body.history : []
      const answer = await askAi(env, state.settings, { question, snapshot, history })
      await addAudit(env, { event: 'ai.ask', agent: 'admin', source: 'console', ok: answer.ok === true, provider: answer.provider ?? '' })
      if (!answer.ok) return json({ ok: false, error: answer.reason, insights: aiInsights(snapshot) }, 200)
      return json({ ok: true, text: answer.text, provider: answer.provider, insights: aiInsights(snapshot) })
    }
    // The deterministic attention list. Costs nothing, so the console can show it
    // on load without spending a model call.
    if (url.pathname === '/api/ai/insights' && request.method === 'GET') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const session = await getSession(env)
      return json({ ok: true, insights: aiInsights(aiSnapshot(state, { vaultUnlocked: Boolean(session), scope: await vaultItemNames(env, env.NODEWARDEN_DB) })) })
    }
    // ── The other broker, as the panel sees it ─────────────────────────────
    // Pasting a token into a terminal is a workaround, not the design. The
    // operator stores the peer here once; the token is wrapped with SESSION_KEK
    // and never comes back out — the panel only learns that one exists.
    if (url.pathname === '/api/sync/remote' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const raw = String(body.url ?? '').trim().replace(/\/+$/, '')
      if (!raw) return fail('需要一个地址，例如 https://broker.example.com', 400)
      let parsed
      try { parsed = new URL(raw) } catch { return fail('地址不合法', 400) }
      if (parsed.username || parsed.password) return fail('地址里不要带账号密码，令牌单独填', 400)
      const local = parsed.hostname === 'localhost' || isPrivateHost(parsed.hostname)
      if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
        return fail('只接受 https（本机地址可以用 http）', 400)
      }
      const token = String(body.token ?? '').trim()
      if (token.length < 16) return fail('令牌看起来不完整（至少 16 个字符）', 400)
      // Prove it works before storing anything: a 401 from the other side is a
      // better answer now than a mystery later.
      let reached
      try { reached = await pullRemote(raw, token) } catch (error) { return fail('连不上对面：' + error.message, 400) }
      await mutateState(env, [{ op: 'set', path: ['settings', 'remoteBroker'], value: { url: raw, label: String(body.label ?? '').trim().slice(0, 48), tokenWrapped: await wrapWithKek(encoder.encode(token), await kekBytes(env)), addedAt: nowIso(), lastCount: reached.count ?? 0, lastCompareAt: null } }])
      await addAudit(env, { event: 'sync.remote.set', url: raw, count: reached.count ?? 0 })
      return json({ ok: true, url: raw, count: reached.count ?? 0 })
    }
    if (url.pathname === '/api/sync/remote' && request.method === 'DELETE') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      await mutateState(env, [{ op: 'delete', path: ['settings', 'remoteBroker'] }])
      await addAudit(env, { event: 'sync.remote.clear' })
      return json({ ok: true })
    }
    if (url.pathname === '/api/sync/compare' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const remote = state.settings?.remoteBroker
      if (!remote?.url || !remote?.tokenWrapped) return fail('还没有配置远端，先填地址和令牌', 409)
      const session = await getSession(env)
      let account = session?.email || ''
      if (session && account !== (state.settings?.vaultEmail ?? '')) account = ''
      if (!account) account = await vaultEmail(env, env.NODEWARDEN_DB, state).catch(() => '')
      if (!account) return fail('这台 broker 还没有配置 vault 账户', 409)
      const mine = await vaultCipherRows(env, account)
      if (!mine) return fail('vault 数据库里没有这个用户（是不是还没初始化？）', 409)
      let peerToken = ''
      try { peerToken = decoder.decode(await unwrapWithKek(remote.tokenWrapped, await kekBytes(env))) } catch (error) { return fail('保存的远端令牌解不开（SESSION_KEK 换过？），请重新填一次', 409) }
      let theirs
      try { theirs = await pullRemote(remote.url, peerToken) } catch (error) {
        await addAudit(env, { event: 'sync.compare-deny', url: remote.url, reason: error.message.slice(0, 120) })
        return fail('远端没有给出结果：' + error.message, 502)
      }
      // Trash is not content. A row with deleted_at set is a deletion signal,
      // which apply refuses to act on, so counting it as "will pull" or as
      // unreadable made a vault whose trash came from another account look
      // broken while its live items were fine.
      const theirsLive = (theirs.items ?? []).filter((row) => !row?.deletedAt)
      const keyMatch = await syncKeyMatch(env, account, theirs)
      const summary = diffSummary(diffVaults(mine, theirsLive))
      // Same key check as apply, so the number on screen before pressing the
      // button already says whether the two vaults share a master key.
      let unreadable = 0
      if (session) for (const row of theirsLive) if (row?.name && !(await rowReadable(row, session))) unreadable += 1
      await mutateState(env, [{ op: 'set', path: ['settings', 'remoteBroker', 'lastCount'], value: theirs.count ?? theirsLive.length }, { op: 'set', path: ['settings', 'remoteBroker', 'lastCompareAt'], value: nowIso() }])
      await addAudit(env, { event: 'sync.compare', url: remote.url, counts: summary.counts })
      return json({ ok: true, local: { count: mine.length }, remote: { count: theirsLive.length, trashed: (theirs.items ?? []).length - theirsLive.length, account: theirs.account ?? '' }, unreadable, keyMatch, ...summary })
    }
    // Comparing told you what differs; this writes the half that comes this way.
    // It only ever adds or overwrites rows the peer has a newer version of: a
    // tombstone on the peer is reported, not applied, because deleting the only
    // copy of a credential on the strength of one comparison is how a sync bug
    // eats a vault.
    if (url.pathname === '/api/sync/apply' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      if (await vault2Context(env)) return fail('Vault 2.0 is the active store; use /api/v2/sync/push', 410)
      const state = await loadState(env)
      const remote = state.settings?.remoteBroker
      if (!remote?.url || !remote?.tokenWrapped) return fail('还没有配置远端，先填地址和令牌', 409)
      const session = await getSession(env)
      let account = session?.email || ''
      if (session && account !== (state.settings?.vaultEmail ?? '')) account = ''
      if (!account) account = await vaultEmail(env, env.NODEWARDEN_DB, state).catch(() => '')
      if (!account) return fail('这台 broker 还没有配置 vault 账户', 409)
      const mine = await vaultCipherRows(env, account)
      if (!mine) return fail('vault 数据库里没有这个用户（是不是还没初始化？）', 409)
      const owner = await env.NODEWARDEN_DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(account).first().catch(() => null)
      if (!owner) return fail('vault 数据库里没有这个用户（是不是还没初始化？）', 409)
      let peerToken = ''
      try { peerToken = decoder.decode(await unwrapWithKek(remote.tokenWrapped, await kekBytes(env))) } catch (error) { return fail('保存的远端令牌解不开（SESSION_KEK 换过？），请重新填一次', 409) }
      let theirs
      try { theirs = await pullRemote(remote.url, peerToken) } catch (error) {
        await addAudit(env, { event: 'sync.apply-deny', url: remote.url, reason: error.message.slice(0, 120) })
        return fail('远端没有给出结果：' + error.message, 502)
      }
      const localById = new Map(mine.map((row) => [row.id, row]))
      // Ciphertext travels, the key does not. A row from a vault with a different
      // master password decrypts to an empty name here, which used to land in the
      // list as "(未命名)" and read as corruption. Ask before writing: if the name
      // does not decrypt with this vault's key, the row is not ours to hold.
      if (!session) return fail('先解锁 vault 再同步：要验证对面的密文能不能用这台 broker 的钥匙解开', 423)
      const keyMatch = await syncKeyMatch(env, account, theirs)
      const wanted = []
      let unreadable = 0
      let trashed = 0
      for (const row of theirs.items ?? []) {
        if (!row?.id || !row.name || !row.data) continue
        // A tombstone on the peer is reported, never applied (see above), so it
        // must not be pulled either — and it must not be counted as a row this
        // vault cannot decrypt.
        if (row.deletedAt) { trashed += 1; continue }
        const here = localById.get(row.id)
        if (here) {
          if (!here.deletedAt && !(String(row.updatedAt ?? '') > String(here.updatedAt ?? ''))) continue
        }
        if (!(await rowReadable(row, session))) { unreadable += 1; continue }
        wanted.push(row)
      }
      if (!wanted.length && unreadable) {
        await addAudit(env, { event: 'sync.apply-deny', url: remote.url, reason: 'unreadable-ciphertext', count: unreadable, keyMatch })
        const verdict = keyMatch === false
          ? '对面的账户密钥和这台不一样（同一个邮箱在两个 broker 上各自初始化过，账户密钥就不同），密文不能互用。'
          : keyMatch === true
            ? '两边的账户密钥是一样的，所以这 ' + unreadable + ' 条多半是从别的账户带过来的旧数据。'
            : '对面没报账户密钥，判断不了是不是同一把钥匙。'
        return fail('远端的 ' + unreadable + ' 条密文用这台 broker 的主密码解不开——' + verdict + '没有写入任何条目。', 409)
      }
      const insert = env.NODEWARDEN_DB.prepare(
        'INSERT OR REPLACE INTO ciphers (id, user_id, type, folder_id, name, notes, data, key, favorite, reprompt, created_at, updated_at, deleted_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)',
      )
      let applied = 0
      const failed = []
      for (const row of wanted.slice(0, 500)) {
        try {
          await insert.bind(row.id, owner.id, row.type ?? 1, row.folderId ?? null, row.name, row.notes ?? null, row.data, row.key ?? null, row.createdAt ?? nowIso(), row.updatedAt ?? nowIso(), row.deletedAt ?? null, row.archivedAt ?? null).run()
          applied += 1
        } catch (error) {
          failed.push(row.id)
        }
      }
      const summary = diffSummary(diffVaults(mine, (theirs.items ?? []).filter((row) => !row?.deletedAt)))
      await mutateState(env, [
        { op: 'set', path: ['settings', 'remoteBroker', 'lastCount'], value: theirs.count ?? 0 },
        { op: 'set', path: ['settings', 'remoteBroker', 'lastCompareAt'], value: nowIso() },
      ])
      await addAudit(env, { event: 'sync.apply', url: remote.url, applied, failed: failed.length, unreadable, counts: summary.counts })
      return json({ ok: true, applied, failed, unreadable, trashed, keyMatch, pulled: wanted.length, total: (theirs.items ?? []).length, counts: summary.counts })
    }

    // Rows that cannot be decrypted with this vault's key are dead weight: they
    // show up as "(未命名)" and can never be read, so offer to sweep them out.
    if (url.pathname === '/api/sync/prune-unreadable' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('先解锁 vault 再清理', 423)
      const user = await env.NODEWARDEN_DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(session.email).first().catch(() => null)
      if (!user) return fail('vault 数据库里没有这个用户（是不是还没初始化？）', 409)
      const rows = await env.NODEWARDEN_DB.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ?').bind(user.id).all()
      const doomed = []
      for (const row of rows.results ?? []) if (!(await rowReadable(row, session))) doomed.push(row.id)
      const remove = env.NODEWARDEN_DB.prepare('DELETE FROM ciphers WHERE id = ? AND user_id = ?')
      let removed = 0
      for (const id of doomed) {
        try { await remove.bind(id, user.id).run(); removed += 1 } catch {}
      }
      await addAudit(env, { event: 'sync.prune-unreadable', removed })
      return json({ ok: true, removed })
    }

    // ── Sync devices ───────────────────────────────────────────────────────
    // The token below belongs to another broker installation, not to an agent.
    // It is handed out once (the panel shows it a single time), stored as a
    // hash, revocable on its own, and it can only reach /sync/pull.
    if (url.pathname === '/api/sync/devices' && request.method === 'GET') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      return json({ devices: syncDeviceList(state) })
    }
    if (url.pathname === '/api/sync/devices/create' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim().slice(0, 48)
      if (!/^[\w .-]{1,48}$/.test(name)) return fail('名称只能包含字母、数字、空格、点、横线和下划线（1-48 字）', 400)
      const state = await loadState(env)
      if (Object.keys(state.syncDevices ?? {}).length >= 20) return fail('同步设备最多 20 个', 400)
      const token = randomToken() + randomToken()
      const id = 'sdev_' + randomToken().slice(0, 10)
      const account = state.settings?.vaultEmail ?? ''
      await mutateState(env, [
        { op: 'set', path: ['syncDevices', id], value: { id, name, hash: await sha256Base64(token), account, createdAt: nowIso(), lastUsedAt: null, revokedAt: null } },
      ])
      await addAudit(env, { event: 'sync.device.create', name, device: id })
      // Shown once: only the hash is kept, so a second read cannot recover it.
      return json({ ok: true, device: { id, name }, token })
    }
    if (url.pathname === '/api/sync/devices/revoke' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const id = String(body.id ?? '')
      const state = await loadState(env)
      const device = state.syncDevices?.[id]
      if (!device) return fail('device not found', 404)
      await mutateState(env, [{ op: 'set', path: ['syncDevices', id, 'revokedAt'], value: nowIso() }])
      await addAudit(env, { event: 'sync.device.revoke', name: device.name, device: id })
      return json({ ok: true })
    }
    // Revoking stops the token; deleting forgets the row. Without this a revoked
    // device sat in the list forever, so a list that had grown to twenty (the
    // cap) could never be cleaned up and no new device could be created.
    if (url.pathname === '/api/sync/devices/delete' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const id = String(body.id ?? '')
      const state = await loadState(env)
      const device = state.syncDevices?.[id]
      if (!device) return fail('device not found', 404)
      // Deleting a live device would be an invisible revoke; make it explicit.
      if (!device.revokedAt) return fail('先撤销这个设备再删除', 409)
      await mutateState(env, [{ op: 'delete', path: ['syncDevices', id] }])
      await addAudit(env, { event: 'sync.device.delete', name: device.name, device: id })
      return json({ ok: true })
    }
    if (url.pathname === '/api/settings') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      if (request.method === 'GET') {
        const state = await loadState(env)
        const n = state.settings?.notifications ?? {}
        const effectiveOidc = await oidcConfig(env, request, state)
        return json({ notifications: {
          telegram: { enabled: n.telegram?.enabled !== false, chatId: n.telegram?.chatId ?? '', configured: Boolean(n.telegram?.botToken && n.telegram?.chatId) },
          ntfy: { enabled: n.ntfy?.enabled !== false, url: n.ntfy?.url ?? '', topic: n.ntfy?.topic ?? '', configured: Boolean(n.ntfy?.url && n.ntfy?.topic) },
          gotify: { enabled: n.gotify?.enabled !== false, url: n.gotify?.url ?? '', configured: Boolean(n.gotify?.url && n.gotify?.token) },
          wxpush: { enabled: n.wxpush?.enabled !== false, url: n.wxpush?.url ?? '', format: n.wxpush?.format ?? 'form', configured: Boolean(n.wxpush?.url && n.wxpush?.token) },
          templates: notificationTemplates(n),
        }, oidc: {
          issuer: effectiveOidc?.issuer ?? '',
          clientId: effectiveOidc?.clientId ?? '',
          redirectUri: effectiveOidc?.redirectUri ?? '',
          scope: effectiveOidc?.scope ?? '',
          authorizationEndpoint: effectiveOidc?.authorizationEndpoint ?? '',
          tokenEndpoint: effectiveOidc?.tokenEndpoint ?? '',
          userinfoEndpoint: effectiveOidc?.userinfoEndpoint ?? '',
          jwksUri: effectiveOidc?.jwksUri ?? '',
          configured: Boolean(effectiveOidc),
          secretConfigured: Boolean(state.settings?.oidc?.clientSecret || env.OIDC_CLIENT_SECRET),
        }, vaultFolder: state.settings?.vaultFolder ?? '', vaultEmail: state.settings?.vaultEmail ?? '', siteName: state.settings?.siteName ?? 'Secrets Broker', requireClassification: requireClassification(state), ...behaviourSettings(state),
        // Where the local bridge may write a credential. Absolute paths only;
        // a trailing separator means "anything under this directory".
        materializePaths: Array.isArray(state.settings?.materializePaths) ? state.settings.materializePaths : [],
        remoteBroker: state.settings?.remoteBroker ? { url: state.settings.remoteBroker.url, label: state.settings.remoteBroker.label ?? '', addedAt: state.settings.remoteBroker.addedAt ?? '', lastCount: state.settings.remoteBroker.lastCount ?? 0, lastCompareAt: state.settings.remoteBroker.lastCompareAt ?? null, configured: true } : { configured: false },
        // The key itself is never returned; only whether one is stored.
        ai: {
          enabled: state.settings?.ai?.enabled !== false,
          endpoint: state.settings?.ai?.endpoint ?? '',
          model: state.settings?.ai?.model ?? '',
          timeoutMs: state.settings?.ai?.timeoutMs ?? 25000,
          hasApiKey: Boolean(state.settings?.ai?.apiKey || env.AI_API_KEY),
        } })
      }
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const previousEmail = (await loadState(env)).settings?.vaultEmail ?? ''
        const incoming = body.notifications ?? {}
        await updateState(env, (state) => {
          state.settings ??= { notifications: {} }
          state.settings.notifications ??= {}
          // AI settings. An empty apiKey keeps the stored one (so saving the form
          // without retyping the key does not wipe it); a literal null clears it.
          if (body.ai && typeof body.ai === 'object') {
            const inc = body.ai
            state.settings.ai ??= {}
            const ai = state.settings.ai
            if (typeof inc.enabled === 'boolean') ai.enabled = inc.enabled
            if (typeof inc.endpoint === 'string') ai.endpoint = inc.endpoint.trim().slice(0, 300)
            if (typeof inc.model === 'string') ai.model = inc.model.trim().slice(0, 200)
            if (inc.timeoutMs != null) {
              const ms = Number(inc.timeoutMs)
              if (Number.isFinite(ms)) ai.timeoutMs = Math.max(5000, Math.min(60000, Math.floor(ms)))
            }
            if (inc.apiKey === null) delete ai.apiKey
            else if (typeof inc.apiKey === 'string' && inc.apiKey.trim()) ai.apiKey = inc.apiKey.trim().slice(0, 400)
          }
          if (Array.isArray(body.materializePaths)) {
            // Sanitised here, not at use time: what is stored is exactly what
            // materializeTarget will compare against, so a path that cannot be
            // used is never silently kept.
            state.settings.materializePaths = body.materializePaths
              .filter((entry) => typeof entry === 'string')
              .map((entry) => entry.trim().slice(0, 512))
              .filter((entry) => entry && /^(?:[A-Za-z]:[\/]|\/)/.test(entry))
              .slice(0, 50)
          }
          for (const channel of ['telegram', 'ntfy', 'gotify', 'wxpush']) {
            if (!incoming[channel]) continue
            const current = state.settings.notifications[channel] ?? {}
            const next = { ...current }
            for (const [key, value] of Object.entries(incoming[channel])) {
              if (value === null || value === '') {
                if (key === 'botToken' || key === 'token') continue
                delete next[key]
              } else {
                next[key] = value
              }
            }
            state.settings.notifications[channel] = next
          }
          if (incoming.templates && typeof incoming.templates === 'object') {
            // Template fields: a non-empty string replaces, '' clears back to
            // the built-in default (see notificationTemplates). Capped length.
            const stored = state.settings.notifications.templates ?? {}
            const nextTemplates = { approval: { ...(stored.approval ?? {}) }, reminder: { ...(stored.reminder ?? {}) } }
            for (const section of ['approval', 'reminder']) {
              const inc = incoming.templates[section]
              if (!inc || typeof inc !== 'object') continue
              for (const [key, value] of Object.entries(inc)) {
                if (key === 'labels' && section === 'approval' && value && typeof value === 'object') {
                  const labels = { ...(nextTemplates.approval.labels ?? {}) }
                  for (const [labelKey, labelValue] of Object.entries(value)) {
                    if (typeof labelValue !== 'string') continue
                    if (labelValue === '') delete labels[labelKey]
                    else labels[labelKey] = labelValue.slice(0, 100)
                  }
                  nextTemplates.approval.labels = labels
                } else if ((key === 'title' || key === 'body') && typeof value === 'string') {
                  if (value === '') delete nextTemplates[section][key]
                  else nextTemplates[section][key] = value.slice(0, 4000)
                }
              }
            }
            state.settings.notifications.templates = nextTemplates
          }
          if (body.oidc && typeof body.oidc === 'object') {
            const current = state.settings.oidc ?? {}
            const next = { ...current }
            for (const key of ['issuer', 'clientId', 'redirectUri', 'scope', 'authorizationEndpoint', 'tokenEndpoint', 'userinfoEndpoint', 'jwksUri']) {
              if (typeof body.oidc[key] === 'string') next[key] = body.oidc[key].trim()
            }
            if (typeof body.oidc.clientSecret === 'string' && body.oidc.clientSecret.length > 0) next.clientSecret = body.oidc.clientSecret
            if (body.oidc.clear === true) { delete next.issuer; delete next.clientId; delete next.clientSecret; delete next.redirectUri; delete next.scope }
            state.settings.oidc = next
          }
          if (typeof body.vaultFolder === 'string') {
            if (body.vaultFolder.trim()) state.settings.vaultFolder = body.vaultFolder.trim()
            else delete state.settings.vaultFolder
          }
          if (typeof body.vaultEmail === 'string' && body.vaultEmail.trim()) state.settings.vaultEmail = body.vaultEmail.trim()
          if (typeof body.siteName === 'string' && body.siteName.trim()) state.settings.siteName = body.siteName.trim().slice(0, 60)
          // Defaults to ON when absent, so nothing can turn it off by omission.
          if (typeof body.requireClassification === 'boolean') state.settings.requireClassification = body.requireClassification
          for (const key of ['webPlaintext', 'unclassifiedPlaintext', 'useAnyTarget']) if (typeof body[key] === 'boolean') state.settings[key] = body[key]
          return state
        })
        await addAudit(env, { event: 'settings.update', scope: 'notifications-oidc' })
        let latest = await loadState(env)
        if ((latest.settings?.vaultEmail ?? '') !== previousEmail) await stateStub(env).fetch('https://state/session', { method: 'DELETE' })
        const telegram = latest.settings?.notifications?.telegram
        if (telegram?.botToken) {
          if (!telegram.webhookSecret) {
            const secret = randomToken()
            await updateState(env, (state) => { state.settings.notifications.telegram.webhookSecret = secret; return state })
            latest = await loadState(env)
          }
          const current = latest.settings.notifications.telegram
          try {
            // Both update kinds: callback_query drives the approve/deny buttons,
            // and message is what lets the operator type /pending, /approve and
            // questions. Subscribing to only callback_query is why text
            // messages were silently dropped by Telegram.
            const hook = await fetch(`https://api.telegram.org/bot${current.botToken}/setWebhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `${url.origin}/telegram/webhook`, secret_token: current.webhookSecret, allowed_updates: ['callback_query', 'message'] }) })
            const hookBody = await hook.json().catch(() => ({}))
            // Register the command menu, so the operator sees the commands in
            // Telegram instead of having to remember them.
            if (hookBody?.ok) {
              await fetch(`https://api.telegram.org/bot${current.botToken}/setMyCommands`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ commands: [
                  { command: 'pending', description: '列出待审批请求' },
                  { command: 'approve', description: '批准：#1 或 #1 24h' },
                  { command: 'deny', description: '拒绝：#1' },
                  { command: 'grants', description: '列出授权' },
                  { command: 'extend', description: '延长：agent 条目 天数' },
                  { command: 'revoke', description: '撤销：agent 条目' },
                  { command: 'auto', description: '自动审批：agent 分钟 / off' },
                  { command: 'status', description: '概览' },
                  { command: 'help', description: '帮助' },
                ] }),
              }).catch(() => {})
            }
            if (!hookBody?.ok) return json({ ok: false, error: 'setWebhook failed: ' + (hookBody?.description ?? 'unknown') }, 502)
          } catch (error) { return json({ ok: false, error: String(error.message ?? error) }, 502) }
        }
        return json({ ok: true })
      }
    }
    if (url.pathname === '/approve') {
      const id = String(url.searchParams.get('id') ?? '')
      const decision = String(url.searchParams.get('d') ?? '')
      const exp = Number(url.searchParams.get('exp') ?? '0')
      const signature = String(url.searchParams.get('sig') ?? '')
      if (!id || !['once', '24h', 'always', 'deny'].includes(decision) || !Number.isFinite(exp) || exp < Date.now()) return new Response('链接已过期或无效', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      const expected = await hmacToken(await cookieKey(env), `${id}:${decision}:${exp}`)
      if (!constantTimeEqual(encoder.encode(expected), encoder.encode(signature))) return new Response('签名无效', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      const outcome = await decidePending(env, id, decision, String(url.searchParams.get('ch') ?? 'notification'))
      if (!outcome) return new Response('请求不存在或已处理', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      const message = outcome.denied ? `已拒绝：${outcome.agent} 读取「${outcome.name}」` : `已授权：${outcome.agent} 读取「${outcome.name}」（${outcome.mode}）`
      return htmlResponse(`<meta charset="utf-8"><title>Secrets Broker</title><h2>${escapeHtml(message)}</h2>`)
    }
    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      const state = await loadState(env)
      const telegram = state.settings?.notifications?.telegram ?? {}
      const secret = String(telegram.webhookSecret ?? '')
      if (!secret || request.headers.get('x-telegram-bot-api-secret-token') !== secret) return fail('invalid webhook secret', 401)
      const update = await request.json().catch(() => ({}))
      // A text message is a command. Only the configured chat may use it, so a
      // leaked bot token alone cannot drive the broker.
      const message = update.message
      if (message) {
        const fromChat = String(message.chat?.id ?? '')
        const allowed = String(telegram.chatId ?? '')
        if (!allowed || fromChat !== allowed) {
          await addAudit(env, { event: 'telegram.reject', source: 'telegram', reason: 'chat-not-allowed', chat: fromChat.slice(0, 40) })
          return json({ ok: true })
        }
        await handleTelegramMessage(env, message, telegram)
        return json({ ok: true })
      }
      const callback = update.callback_query
      if (!callback) return json({ ok: true })
      const data = String(callback.data ?? '')
      const [kind, id, mode] = data.split(':')
      const decision = kind === 'd' ? 'deny' : (mode || 'once')
      const outcome = await decidePending(env, id, decision, 'telegram')
      const token = telegram.botToken
      if (token) {
        const answer = outcome ? (outcome.denied ? '已拒绝' : '已授权') : '请求不存在或已处理'
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callback_query_id: callback.id, text: answer }) }).catch(() => {})
        if (callback.message?.chat?.id) {
          await fetch(`https://api.telegram.org/bot${token}/editMessageText`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: callback.message.chat.id, message_id: callback.message.message_id, text: `${callback.message.text ?? ''}\n\n${answer}`, reply_markup: { inline_keyboard: [] } }) }).catch(() => {})
        }
      }
      return json({ ok: true })
    }
    if (url.pathname === '/api/oauth/revoke' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      await updateState(env, (state) => {
        if (body.clientId) {
          delete state.oauthClients[body.clientId]
          for (const [hash, token] of Object.entries(state.oauthTokens ?? {})) if (token.clientId === body.clientId) delete state.oauthTokens[hash]
          for (const [code, entry] of Object.entries(state.oauthCodes ?? {})) if (entry.clientId === body.clientId) delete state.oauthCodes[code]
        }
        if (body.agent) {
          for (const [hash, token] of Object.entries(state.oauthTokens ?? {})) if (token.agent === body.agent) {
            delete state.oauthTokens[hash]
            // The registration existed for this connection only. Leaving it behind
            // was the one thing the removed OAuth-client page did.
            if (token.clientId) delete state.oauthClients?.[token.clientId]
          }
          delete state.oauthAgentProfiles?.[body.agent]
        }
        if (body.all === true) { state.oauthClients = {}; state.oauthTokens = {}; state.oauthCodes = {} }
        return state
      })
      await addAudit(env, { event: 'oauth.revoke', clientId: body.clientId ?? '', agent: body.agent ?? '' })
      return json({ ok: true })
    }
    // Unauthenticated OAuth diagnostics: counts and masked prefixes only, so an
    // operator can tell whether a client registration exists without exposing
    // tokens. Never returns hashes, secrets or full IDs.
    if (url.pathname === '/oauth/status') {
      const state = await loadState(env)
      const mask = (id) => String(id ?? '').slice(0, 12) + (String(id ?? '').length > 12 ? '…' : '')
      const clients = Object.values(state.oauthClients ?? {})
      const tokens = Object.values(state.oauthTokens ?? {})
      const now = Date.now()
      return json({
        clients: clients.length,
        clientPrefixes: clients.slice(0, 20).map((c) => ({ id: mask(c.clientId), name: String(c.clientName ?? '').slice(0, 40), redirects: (c.redirectUris ?? []).length })),
        tokens: tokens.length,
        liveTokens: tokens.filter((t) => !t.expiresAt || t.expiresAt > now).length,
        agents: Object.keys(state.agents ?? {}).length,
        // Live-globe counters so an operator can confirm the globe has traffic
        // without opening the console. Counts and agent names only.
        ...(await geoEventSummary(env)),
      })
    }
    if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      return json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin], scopes_supported: ['secrets.read'] })
    }
    if (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/oauth-authorization-server/mcp') {
      return json(oauthMetadata(url.origin))
    }
    if (url.pathname === '/oauth/register' && request.method === 'POST') {
      // Open registration is what lets a standard MCP client connect without the
      // operator copying an id out of a log first. A deployment that would rather
      // pre-approve every client can turn it off and hand out ids itself.
      const registerAllowed = String(env.OAUTH_ALLOW_REGISTER ?? '1').toLowerCase()
      if (registerAllowed === '0' || registerAllowed === 'false' || registerAllowed === 'off') {
        return json({ error: 'registration_disabled', error_description: 'this broker does not accept dynamic client registration' }, 403)
      }
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      if (Object.keys(state.oauthClients ?? {}).length >= 100) return fail('too many registered clients', 429)
      const redirectUris = (Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String).filter(Boolean) : []).slice(0, 5)
      if (!redirectUris.length) return fail('redirect_uris required', 400)
      if (redirectUris.some((value) => value.length > 2048)) return fail('redirect_uri too long', 400)
      const clientName = String(body.client_name ?? 'MCP client').slice(0, 80)
      const validRedirect = (value) => { try { const target = new URL(value); if (target.hash) return false; if (target.protocol === 'https:') return true; return target.protocol === 'http:' && (target.hostname === '127.0.0.1' || target.hostname === 'localhost' || target.hostname === '[::1]') } catch { return false } }
      if (!redirectUris.every(validRedirect)) return fail('redirect_uri must be https or a loopback http URL', 400)
      const clientId = 'mcp_' + base64Url(crypto.getRandomValues(new Uint8Array(18)))
      // Register atomically: a concurrent state write must not drop the record
      // it was created to hold (that surfaces later as "unknown client").
      const written = await mutateState(env, [{
        op: 'set',
        path: ['oauthClients', clientId],
        value: { clientId, clientName, redirectUris, createdAt: nowIso(), trustedAt: null },
      }])
      if (!written?.ok) return fail('could not persist client registration', 500)
      // Registration is open (that is what makes standard MCP clients work) but it
      // grants nothing: a client still needs the operator to approve it on the
      // consent page, which mints the only token-issuing code. Recorded so a
      // registration nobody recognises is visible rather than silent.
      await addAudit(env, { event: 'oauth.client-register', clientId, clientName: body.client_name ?? '', source: 'registration' })
      return json({ client_id: clientId, client_name: body.client_name ?? 'MCP client', redirect_uris: redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }, 201)
    }
    if (url.pathname === '/oauth/authorize') {
      const state = await loadState(env)
      const params = request.method === 'POST' ? new URLSearchParams(await request.text()) : url.searchParams
      // Cross-site POST defence. The admin cookie is SameSite=None so the consent
      // form works from a third-party page; that also means any site the operator
      // visits can POST this endpoint with their cookie attached. A same-origin
      // check on the Origin header (and the browser's own Sec-Fetch-Site verdict)
      // keeps a form on evil.example from approving an attacker's client.
      if (request.method === 'POST') {
        const origin = request.headers.get('origin')
        const fetchSite = String(request.headers.get('sec-fetch-site') ?? '').toLowerCase()
        if (fetchSite === 'cross-site') {
          await addAudit(env, { event: 'oauth.consent-deny', reason: 'cross-site', clientId: String(params.get('client_id') ?? '').slice(0, 40) }).catch(() => {})
          return new Response('跨站提交被拒绝：请从本站打开授权页。', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } })
        }
        if (origin) {
          let sameOrigin = false
          try { sameOrigin = new URL(origin).origin === new URL(request.url).origin } catch {}
          // A sandboxed frame, and a browser driven over the debug protocol,
          // can submit a same-origin form with "Origin: null". Sec-Fetch-Site
          // still reports same-origin in that case, so fall back to it rather
          // than rejecting a consent the browser itself vouches for.
          if (!sameOrigin && String(origin).toLowerCase() === 'null' && fetchSite === 'same-origin') sameOrigin = true
          if (!sameOrigin) {
            await addAudit(env, { event: 'oauth.consent-deny', reason: 'origin-mismatch', origin: String(origin).slice(0, 120) }).catch(() => {})
            return new Response('跨站提交被拒绝：来源与本站不一致。', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } })
          }
        }
      }
      const clientId = String(params.get('client_id') ?? '')
      const redirectUri = String(params.get('redirect_uri') ?? '')
      const client = state.oauthClients[clientId]
      if (!client) {
        // The client registration is gone (revoked, cleared, or lost before
        // registrations were written atomically). A bare JSON 400 leaves the
        // user with no way forward, so explain and offer the manual retry page.
        const known = Object.keys(state.oauthClients ?? {}).length
        return new Response(
          '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>OAuth 客户端未注册</title>' +
          '<div style="font:14px/1.7 system-ui;max-width:560px;margin:40px auto;padding:0 16px;color:#152033">' +
          '<h2 style="font-size:18px">这个客户端 ID 已失效</h2>' +
          '<p>服务端找不到 <code style="background:#eef1f6;padding:2px 5px;border-radius:5px">' + escapeHtml(clientId.slice(0, 40) || '(空)') + '</code>，所以无法继续授权。</p>' +
          '<p style="color:#6b7890;font-size:13px">常见原因：客户端早前注册过，但注册记录在升级前丢失，或被管理员撤销。</p>' +
          '<p><strong>解决办法：在客户端里断开这个连接，重新发起一次授权。</strong>客户端会重新注册一个新的 ID，就能正常授权了。</p>' +
          '<p style="color:#6b7890;font-size:13px">当前已注册客户端数量：' + known + '</p>' +
          '</div>',
          { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
        )
      }
      if (!client.redirectUris.includes(redirectUri)) return fail('invalid redirect_uri', 400)
      if (!params.get('code_challenge') || params.get('code_challenge_method') !== 'S256') return fail('PKCE S256 is required', 400)
      const cookieCheck = await validCookieDetailed(request, env)
      if (!cookieCheck.ok) {
        // Clear a stale/legacy cookie before bouncing, otherwise the same bad
        // value is presented on every retry and the loop never ends.
        const clearHeaders = cookieCheck.clearable ? { 'set-cookie': COOKIE_CLEAR_HEADER } : {}
        // Bounce through the login page and come back to this exact authorize
        // request. For POST the form parameters live in the BODY, so rebuilding
        // the return target from url.search alone yields a bare
        // /oauth/authorize (no client_id) — after logging in the user then sees
        // a bogus "client ID invalid" page. Rebuild from the actual params and
        // resume with GET, which carries everything in the query string; the
        // user simply re-confirms on the consent page.
        let returnTo
        if (request.method === 'POST') {
          // Form parameters live in the body; rebuild a query string once.
          const resume = new URLSearchParams()
          for (const [key, value] of params.entries()) {
            if (key === 'decision') continue
            resume.append(key, value)
          }
          returnTo = url.pathname + (resume.toString() ? '?' + resume.toString() : '')
        } else {
          // GET already carries a correctly encoded query string. Rebuilding it
          // through URLSearchParams would double-encode every %XX (notably
          // redirect_uri -> %253A), so pass it through untouched.
          returnTo = url.pathname + url.search
        }
        const loginUrl = new URL('/login', url.origin)
        loginUrl.searchParams.set('next', returnTo)
        if (request.method === 'POST') {
          const body = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<p style="font:14px/1.7 system-ui;max-width:560px;margin:40px auto;padding:0 16px">登录状态已过期。' +
            '<a href="' + escapeHtml(loginUrl.pathname + loginUrl.search) + '">点此登录</a>，登录后会自动回到授权页，再点一次「允许」即可。' +
            '<br><span style="font-size:12px;color:#6b7890">旧的登录凭据已自动清除。</span></p>'
          return new Response(body, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', ...clearHeaders } })
        }
        // Build the redirect manually: Response.redirect() yields immutable
        // headers, so a stale cookie could not be cleared alongside it.
        return new Response(null, { status: 302, headers: { location: loginUrl.toString(), ...clearHeaders } })
      }
      if (request.method === 'POST' && params.get('decision') === 'deny') {
        const target = new URL(redirectUri); target.searchParams.set('error', 'access_denied'); if (params.get('state')) target.searchParams.set('state', params.get('state'))
        return Response.redirect(target.toString(), 302)
      }
      if (request.method === 'POST' && params.get('decision') === 'allow') {
        const challenge = String(params.get('code_challenge') ?? '')
        const method = String(params.get('code_challenge_method') ?? '')
        if (!challenge || method !== 'S256') return fail('PKCE S256 is required', 400)
        const session = await getSession(env)
        const account = session?.email || await vaultEmail(env, env.NODEWARDEN_DB, state)
        const code = randomToken()
        // What the operator ticked on the consent page. It is carried in the
        // code, not the token, so a code that is never exchanged grants nothing.
        const grantItems = params.getAll('grant_items').map((value) => String(value)).filter(Boolean)
        const grantGroups = params.getAll('grant_groups').map((value) => String(value)).filter(Boolean)
        const grantAll = params.get('grant_all') === '1'
        const grantPlaintext = params.get('grant_plaintext') === '1'
        const grantHours = Math.max(1, Math.min(720, Number(params.get('grant_hours')) || 24))
        const rememberApp = params.get('remember_app') === '1'
        if (rememberApp && !client.trustedAt) {
          await mutateState(env, [{ op: 'set', path: ['oauthClients', clientId, 'trustedAt'], value: nowIso() }])
          await addAudit(env, { event: 'oauth.client-trust', clientId, clientName: client.clientName ?? '' })
        }
        await updateState(env, (next) => {
          next.oauthCodes[code] = { clientId, redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256', scope: String(params.get('scope') ?? 'secrets.read'), account, createdAt: nowIso(), expiresAt: Date.now() + 5 * 60 * 1000, grantItems, grantGroups, grantAll, grantPlaintext, grantHours }
          return next
        })
        await addAudit(env, { event: 'oauth.authorize', clientId, agent: 'oauth:' + clientId, items: grantItems.length, groups: grantGroups.length, all: grantAll, plaintext: grantPlaintext, hours: grantPlaintext ? grantHours : 0, source: 'console' })
        const target = new URL(redirectUri); target.searchParams.set('code', code); if (params.get('state')) target.searchParams.set('state', params.get('state'))
        return Response.redirect(target.toString(), 302)
      }
      return htmlResponse(oauthConsentPage(url.origin, params, client, await consentCatalog(env, env.NODEWARDEN_DB)))
    }
    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      const form = new URLSearchParams(await request.text())
      if (form.get('grant_type') !== 'authorization_code') return json({ error: 'unsupported_grant_type' }, 400)
      const code = String(form.get('code') ?? '')
      const state = await loadState(env)
      const entry = state.oauthCodes[code]
      // Every rejection is audited so a failed client exchange is diagnosable
      // instead of looking like the authorization silently did nothing.
      const reject = async (description) => {
        const who = 'oauth:' + String(entry?.clientId ?? form.get('client_id') ?? '')
        await addAudit(env, { event: 'oauth.token-deny', agent: who, reason: description }).catch(() => {})
        return json({ error: 'invalid_grant', error_description: description }, 400)
      }
      if (!entry || entry.expiresAt < Date.now()) return reject('code missing or expired')
      if (String(form.get('client_id') ?? '') !== entry.clientId) return reject('client_id mismatch')
      if (String(form.get('redirect_uri') ?? '') !== entry.redirectUri) return reject('redirect_uri mismatch')
      if (!entry.codeChallenge || entry.codeChallengeMethod !== 'S256') return reject('PKCE S256 is required')
      {
        const verifier = String(form.get('code_verifier') ?? '')
        if (!verifier) return reject('code_verifier missing')
        const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))))
        if (challenge !== entry.codeChallenge) return reject('PKCE verification failed')
      }
      const accessToken = randomToken() + randomToken()
      const hash = await sha256Base64(accessToken)
      const agentName = 'oauth:' + entry.clientId
      const expiresAt = Date.now() + 24 * 3600 * 1000
      const session = await getSession(env)
      const account = entry.account || session?.email || await vaultEmail(env, env.NODEWARDEN_DB, state)
      // `state.itemIds` is an append-only name->id cache: it keeps names from
      // vaults the operator has since switched away from. Minting "everything"
      // from that cache handed a brand new OAuth client plaintext grants for
      // another account's credentials, which then appeared in the Agent dialog
      // as rows nobody approved and went live again after an account switch.
      // Bound the mint to the items that exist in the vault unlocked right now,
      // and take the ids from that live list rather than from the cache.
      const liveIds = new Map()
      try {
        const unlocked = session && String(session.email).toLowerCase() === String(account).toLowerCase() ? session : null
        if (unlocked) for (const item of await listCiphers(env, env.NODEWARDEN_DB, unlocked)) liveIds.set(item.name, item.id)
      } catch {}
      await updateState(env, (next) => {
        delete next.oauthCodes[code]
        next.oauthTokens[hash] = { hash, agent: agentName, clientId: entry.clientId, account, createdAt: nowIso(), expiresAt }
        next.oauthAgentProfiles ??= {}
        const profile = next.oauthAgentProfiles[agentName] ??= { alias: next.oauthClients?.[entry.clientId]?.clientName ?? '', note: entry.clientId, allow: [], groups: [], allowAll: false, write: false, legacy: false }
        if (!profile.note) profile.note = entry.clientId
        // The consent choices become this Agent's scope, so the read it was
        // connected for works on the first call instead of failing with
        // "not allowed to read this item" and sending the operator back to the
        // console. A re-authorisation replaces the choices rather than merging,
        // because the operator just answered the question again.
        if (entry.grantAll === true) profile.allowAll = true
        if (Array.isArray(entry.grantItems) && entry.grantItems.length) profile.allow = [...new Set([...(profile.allow ?? []), ...entry.grantItems])]
        if (Array.isArray(entry.grantGroups) && entry.grantGroups.length) profile.groups = [...new Set([...(profile.groups ?? []), ...entry.grantGroups])]
        // Scope alone only permits a request; it does not clear the read guard.
        // The plaintext policy is written only when the operator ticked it, and
        // for the window they picked. The capability is always minted so the
        // Agent can read once approved — a scope grant is not a month-long
        // authority by accident.
        next.plaintextReadPolicies ??= {}
        const wanted = new Set()
        for (const name of entry.grantItems ?? []) if (liveIds.has(name)) wanted.add(name)
        if (entry.grantAll === true) for (const name of liveIds.keys()) wanted.add(name)
        const livedMs = (Number(entry.grantHours) || 24) * 3600e3
        next.capabilities ??= {}
        for (const name of wanted) {
          const itemId = liveIds.get(name)
          if (!itemId) continue
          // A web credential is fill-only by design and must never gain a
          // plaintext read policy, so choosing one here cannot weaken that rule.
          if (next.credentialKinds?.[itemId] === 'web') continue
          if (entry.grantPlaintext === true) {
            next.plaintextReadPolicies[itemId] = { itemId, accountId: account, expiresAt: Date.now() + livedMs, updatedAt: nowIso() }
          }
          // Without the plaintext tick the operator granted scope, not a read:
          // the Agent may ask for this item, and the answer comes from the
          // approval page. Minting the capability anyway is what made "I never
          // allowed plaintext" and "everything was readable" both true.
          if (entry.grantPlaintext !== true) continue
          const ckey = capabilityKey(agentName, itemId, 'secret.read')
          if (!next.capabilities[ckey]?.revokedAt) {
            next.capabilities[ckey] = {
              id: ckey, subjectId: agentName, accountId: account, itemId, itemName: name, action: 'secret.read',
              mode: 'preapproved', createdAt: nowIso(), createdBy: 'oauth-consent:' + account,
              // The operator's own answer to "may this Agent read the value".
              // Without the tick a grant only lets the Agent ask: reading
              // still goes through the approval page.
              plaintext: entry.grantPlaintext === true,
              expiresAt: Date.now() + (entry.grantPlaintext === true ? livedMs : 24 * 3600e3),
              maxUses: null, usedCount: 0,
              revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1,
            }
          }
        }
        return next
      })
      await addAudit(env, { event: 'oauth.token-issue', agent: agentName, clientId: entry.clientId, items: (entry.grantItems ?? []).length, groups: (entry.grantGroups ?? []).length, all: entry.grantAll === true })
      return json({ access_token: accessToken, token_type: 'Bearer', expires_in: 86400, scope: entry.scope })
    }
    // ── Sync (stage 1: read-only) ──────────────────────────────────────────
    // A sibling broker asks for the encrypted rows so the operator's browser or
    // CLI can compare the two vaults. Nothing here is decrypted: `data` and
    // `name` are the same Bitwarden blobs that sit in D1, so a stolen sync token
    // costs a list of ids and timestamps, not a credential. Off unless the
    // deployment says SYNC_ENABLED=1, because it does expose vault shape.
    if (url.pathname === '/sync/pull' && (request.method === 'GET' || request.method === 'POST')) {
      if (String(env.SYNC_ENABLED ?? '') !== '1') return fail('sync is not enabled on this broker (set SYNC_ENABLED=1)', 404)
      // Only two callers: a broker holding a sync-device token, or the operator
      // in this very panel. An agent token is neither — an agent's scope is
      // curated item by item, so letting it enumerate the vault would undo the
      // one promise this broker makes.
      let account = ''
      const probe = await loadState(env)
      const device = await resolveSyncDevice(request, env, probe)
      if (device) {
        account = device.account || ''
        await mutateState(env, [{ op: 'set', path: ['syncDevices', device.id, 'lastUsedAt'], value: nowIso() }])
      } else if (request.headers.get('authorization')) {
        return fail('this token is not a sync device', 403)
      } else if (await adminAuthorized(request, env)) {
        const session = await getSession(env)
        account = session?.email || ''
      } else {
        return fail('unauthorized', 401)
      }
      const state = await loadState(env)
      if (!account) account = await vaultEmail(env, env.NODEWARDEN_DB, state).catch(() => '')
      if (!account) return fail('no vault account is configured on this broker', 409)
      // ciphers.user_id is the vault user id, not the email: resolve it the same
      // way every other read path does, or sync would silently compare nothing.
      const items = await vaultCipherRows(env, account)
      if (!items) return fail('no vault user matches ' + account + ' (is the vault database initialised?)', 409)
      // A fingerprint of the account's wrapped key answers "are these two vaults
      // the same vault?" without handing over the key or a plaintext. Hashing a
      // ciphertext blob reveals nothing, and two brokers that hold the same
      // account data hold the same string, so the comparison is exact instead of
      // the guess the panel used to print.
      const userRow = await env.NODEWARDEN_DB.prepare('SELECT key FROM users WHERE lower(email) = lower(?)').bind(account).first().catch(() => null)
      const keyCheck = userRow?.key ? await sha256Base64(String(userRow.key)) : ''
      const live = items.filter((row) => !row?.deletedAt)
      await addAudit(env, { event: 'sync.pull', agent: device ? 'device:' + device.name : 'admin', device: device?.id, count: live.length, account })
      // Superseded by the v2 revision cursor, which carries tombstones and needs
      // no NodeWarden key on this side. Kept one release so an old broker can
      // still pull while both ends move over.
      return new Response(JSON.stringify({ ok: true, account, count: live.length, trashed: items.length - live.length, keyCheck, items, deprecated: true, replacement: '/api/v2/items?since=<revision>' }), {
        headers: {
          'content-type': 'application/json',
          deprecation: 'true',
          link: '</api/v2/items>; rel="successor-version"',
          warning: '299 - "deprecated: use /api/v2/items?since=<revision>"',
        },
      })
    }
// MCP clients show annotations and titles in their approval prompts; without
// them a destructive call looks the same as a read.
const TOOL_META = {
  list_secrets: { title: '列出密钥条目', readOnlyHint: true },
  request_access: { title: '申请读取授权', readOnlyHint: false, destructiveHint: false },
  explain_access: { title: '解释权限判定', readOnlyHint: true },
  get_secret: { title: '读取明文', readOnlyHint: true },
  get_credential: { title: '读取登录凭据', readOnlyHint: true },
  request_fill: { title: '请求网页填充', readOnlyHint: false, destructiveHint: false },
  materialize: { title: '写入本地文件', readOnlyHint: false, destructiveHint: true },
  materialize_redeem: { title: '兑换一次性写入任务', readOnlyHint: false, destructiveHint: true },
  request_credential: { title: '创建一次性填写链接', readOnlyHint: false, destructiveHint: false },
  put_secret: { title: '写入密钥（需审批）', readOnlyHint: false, destructiveHint: true },
  http_request: { title: '代调外部 API', readOnlyHint: false, openWorldHint: true },
}
    if (url.pathname === '/health' && (request.method === 'GET' || request.method === 'HEAD')) return json({ ok: true })
    // A browser-side MCP client (and any Streamable-HTTP probe) sends a CORS
    // preflight first; without this answer the endpoint looked missing.
    if (url.pathname === '/mcp' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': request.headers.get('origin') ?? '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
        'access-control-max-age': '86400',
      } })
    }
    // This server has no SSE stream; GET must say so instead of 404.
    if (url.pathname === '/mcp' && request.method === 'GET') {
      return new Response(JSON.stringify({ error: 'this endpoint accepts POST only' }), { status: 405, headers: { 'content-type': 'application/json', allow: 'POST, OPTIONS' } })
    }
    if (url.pathname === '/mcp' && request.method === 'POST') {
      const resolved = await resolveAgent(request, env)
      if (!resolved) return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized' } }), { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' } })
      // A malformed body is a parse error, not an unknown method: -32601 sent
      // clients looking for a method they had spelled correctly.
      let body
      try { body = JSON.parse(await request.text()) } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) }
      if (Array.isArray(body)) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'batch requests are not supported; send one message per request' } })
      // No id means a notification: a response would be a protocol violation.
      if (body.id === undefined) return new Response(null, { status: 202 })
      const rpcError = (message, code = -32601) => json({ jsonrpc: '2.0', id: body.id ?? null, error: { code, message } })
      const result = (value) => json({ jsonrpc: '2.0', id: body.id ?? null, result: value })
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
      if (body.method === 'ping') return result({})
      if (body.method === 'initialize') {
        // Echo a version only when it is one we speak; otherwise answer with ours
        // rather than agreeing to a date that does not exist.
        const asked = String(body.params?.protocolVersion ?? '')
        const protocolVersion = ['2024-11-05', '2025-03-26', '2025-06-18'].includes(asked) ? asked : '2024-11-05'
        return result({ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'secrets-broker', version: '0.1.0' }, instructions: 'Use this server for every credential. Call list_secrets to discover items, get_secret for a value, get_credential for username/password/TOTP, http_request to call an API with the secret injected server-side, or request_credential to create a one-time link when the vault is missing a key. Never ask the user for passwords or API keys. If pending approval, present the approval URL and retry. Never print secret values in chat or logs.' })
      }
      if (body.method === 'tools/list') {
        return result({ tools: [
          { name: 'list_secrets', description: 'List secret item names available to this agent (no values), sorted by name, each with its kind so you know whether to call get_secret or request_fill.', inputSchema: { type: 'object', properties: { filter: { type: 'string', description: 'Only names containing this text (case-insensitive)' }, limit: { type: 'number', description: 'Maximum entries, default 200' } }, additionalProperties: false } },
          { name: 'request_access', description: 'Request approval to read a secret by name. Returns an approval URL if pending.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' } }, required: ['name'] } },
          { name: 'explain_access', description: 'Explain, without returning any value, why this agent can or cannot use a credential: its kind, the account it belongs to, the grant that exists and the rule that decides. Use it when a tool answers "not allowed" and you need to know whether to request access, ask for a fill, or stop.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' }, action: { type: 'string', enum: ['secret.read', 'secret.use', 'secret.fill', 'secret.materialize'], description: 'Action to explain (default secret.read)' }, origin: { type: 'string', description: 'Target origin, for secret.fill' }, url: { type: 'string', description: 'Target URL, for secret.use' } }, required: ['name'], additionalProperties: false } },
          { name: 'get_secret', description: 'Read a secret value after approval. Disabled unless MCP_ALLOW_READ=1.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' } }, required: ['name'] } },
          { name: 'get_credential', description: 'Read username, password and TOTP for a login item after approval.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' } }, required: ['name'] } },
          { name: 'request_fill', description: 'Ask a browser executor to fill a stored website login into an allowed origin. The agent never receives the value; it learns whether the request was approved and, if so, the task id.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Item name' }, origin: { type: 'string', description: 'Exact https origin the credential may be filled into' }, action: { type: 'string', description: 'Fill action, currently login', enum: ['login'] } }, required: ['name', 'origin'], additionalProperties: false } },
          { name: 'materialize', description: 'Ask to write a stored credential into a file the operator has pre-approved (settings.materializePaths). The value never returns from this call: an approval records a one-shot job that the local bridge redeems once.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Item name' }, path: { type: 'string', description: 'Absolute target file path, on the allowlist' }, key: { type: 'string', description: 'Variable name to write, e.g. OPENAI_API_KEY' } }, required: ['name', 'path', 'key'], additionalProperties: false } },
          { name: 'materialize_redeem', description: 'Redeem an approved materialize job once. Returns the value for the local bridge to write; the job cannot be redeemed twice.', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Job id from the pending approval' } }, required: ['id'], additionalProperties: false } },
          { name: 'request_credential', description: 'Create a secure one-time link for a human to fill in a missing credential; the broker stores it and grants this agent access.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Suggested item name' }, description: { type: 'string', description: 'What the credential is for' } }, required: ['name'] } },
          { name: 'put_secret', description: 'Store or update a credential. Requires human approval: the first call returns pending-approval with an approvalUrl and stores nothing; after the operator approves, call it again with the same arguments within 10 minutes to actually write. Pass only the fields you are changing.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Item name (exact, trimmed)' }, value: { type: 'string', description: 'Secret value; omit to keep the stored one' }, username: { type: 'string' }, totp: { type: 'string', description: 'Base32 TOTP secret' }, url: { type: 'string' }, notes: { type: 'string' }, group: { type: 'string', description: 'Folder/group, required to create an item in a group' } }, required: ['name'], additionalProperties: false } },
          { name: 'http_request', description: 'Make an HTTPS request with a secret injected server-side. Method allowlist (default GET/POST, extend via HTTP_ALLOW_METHODS; max 16 chars). Path prefix allowlist via HTTP_ALLOW_PATHS (empty = no path restriction). headerName allowlist: Authorization, X-Api-Key, Api-Key, X-Auth-Token (case-insensitive); authPrefix max 32 chars, no CR/LF. Custom headers sanitized (name /^[A-Za-z0-9-]+$/, value <=4KB, max 20; host/content-length/connection/cookie/set-cookie/authorization and other sensitive hops filtered). Body <=64KB as string; GET/HEAD must not send body. Only https, no userinfo, default port 443 or HTTP_ALLOWED_PORTS. The secret is never returned to the caller.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' }, url: { type: 'string', description: 'HTTPS target URL (no userinfo; path must match HTTP_ALLOW_PATHS prefixes when set; port 443 or HTTP_ALLOWED_PORTS)' }, method: { type: 'string', description: 'HTTP method, uppercased (default GET; non-GET/POST requires HTTP_ALLOW_METHODS; max 16 chars)' }, headers: { type: 'object', description: 'Extra headers (sanitized: name /^[A-Za-z0-9-]+$/, value <=4KB, max 20; sensitive/hop headers filtered and cannot override the injected secret header)' }, body: { type: 'string', description: 'Request body as string (<=64KB; GET/HEAD must not include body)' }, headerName: { type: 'string', description: 'Header to inject the secret into (allowlist: Authorization, X-Api-Key, Api-Key, X-Auth-Token; default Authorization)' }, authPrefix: { type: 'string', description: 'Prefix before the secret (default "Bearer ", max 32 chars, no CR/LF)' } }, required: ['name', 'url'] } },
        ].filter((tool) => !Array.isArray(resolved.agent.tools) || !resolved.agent.tools.length || resolved.agent.tools.includes(tool.name)).map((tool) => ({ ...tool, annotations: TOOL_META[tool.name] ?? {} })) })
      }
      if (body.method === 'tools/call') {
        const name = body.params?.name
        const args = body.params?.arguments ?? {}
        // Trailing spaces are the most common reason a correct name reads as "no access".
        const argName = () => String(args['name'] ?? '').trim()
        const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) })
        // A pending answer is not a value and not a failure: say what it is, give the
        // request id, and tell the model to retry the same call after approval.
        const pendingText = (access) => text({ status: 'pending-approval', requestId: access.requestId ?? '', approvalUrl: access.approvalUrl ?? '', retryAfterSeconds: 5, next: '批准后重新调用同一个工具即可取到值；不需要再申请一次', message: 'pending approval: ' + (access.approvalUrl ?? '') })
        const session = await getSession(env)
        if (!session) return result(text('vault locked; open the broker page or run unlock.mjs', true))
        // Per-agent MCP surface. An empty list means "every tool", so agents created
        // before this setting keep working; a non-empty list is an allowlist.
        const allowedTools = Array.isArray(resolved.agent.tools) && resolved.agent.tools.length ? resolved.agent.tools : null
        if (allowedTools && !allowedTools.includes(name)) return result(text('this agent is restricted to: ' + allowedTools.join(', ') + ' — ' + name + ' is not allowed', true))
        try {
          if (name === 'put_secret') {
            const itemName = argName()
            if (!itemName) return result(text('name is required', true))
            const fields = {}
            for (const key of ['value', 'username', 'totp', 'url', 'notes', 'group']) if (typeof args[key] === 'string') fields[key] = args[key]
            if (!Object.keys(fields).length) return result(text('nothing to write: pass value, username, totp, url, notes or group', true))
            const ticketKey = grantKey(resolved.name, itemName)
            const ticket = resolved.state.writeTickets?.[ticketKey] ?? null
            const ticketLive = Boolean(ticket) && Number(ticket.expiresAt ?? 0) > Date.now()
              && String(ticket.account ?? '').toLowerCase() === String(session.email).toLowerCase()
            if (!ticketLive) {
              // Same pending shape as a read request, so the console, Telegram and
              // the push notifications surface a write without a second code path.
              let pendingId = findPending(resolved.state, resolved.name, itemName, 'secret.write')
              if (!pendingId) {
                pendingId = crypto.randomUUID()
                await updateState(env, (next) => { next.pending[pendingId] = { id: pendingId, agent: resolved.name, name: itemName, account: session.email, action: 'secret.write', createdAt: nowIso(), targetOrigin: '' }; return next })
                await addAudit(env, { event: 'request.create', agent: resolved.name, name: itemName, action: 'secret.write' })
                await notifyPending(env, url.origin, { id: pendingId, agent: resolved.name, name: itemName, action: 'secret.write', createdAt: nowIso() }, ctx).catch(() => {})
              }
              return result(pendingText({ requestId: pendingId, approvalUrl: url.origin + '/#pending' }))
            }
            if (!agentInScope(resolved.agent, resolved.state.itemGroups, itemName, fields.group)) return result(text('agent not allowed to write this item: it is outside the agent scope', true))
            // A new item needs a value; metadata alone would create an empty entry
            // every later read has to special-case.
            const existing = await findCipherRow(env, env.NODEWARDEN_DB, session, itemName)
            if (!existing && !fields.value) return result(text('value is required to create a new item', true))
            // One approval, one write. The ticket is spent before the write so a
            // crash cannot replay it later with a different value.
            await updateState(env, (next) => { delete next.writeTickets?.[ticketKey]; return next })
            if (existing) await updateCipher(env, env.NODEWARDEN_DB, session, itemName, fields)
            else await createCipher(env, env.NODEWARDEN_DB, session, { name: itemName, ...fields })
            await addAudit(env, { event: 'secret.write', agent: resolved.name, name: itemName, action: 'secret.write', source: 'approval' })
            return result(text({ status: 'written', name: itemName, updated: Boolean(existing) }))
          }
          if (name === 'explain_access') {
            const explained = await explainAccess(env, { resolved, session, name: argName(), action: String(args.action ?? 'secret.read'), origin: args.origin ? String(args.origin) : '', url: args.url ? String(args.url) : '' })
            return result(text(explained))
          }
          if (name === 'list_secrets') {
            if (resolved.agent.account && String(resolved.agent.account).toLowerCase() !== String(session.email).toLowerCase()) return result(text('agent is bound to another vault account', true))
            const items = await listCiphers(env, env.NODEWARDEN_DB, session)
            const filter = String(args.filter ?? '').trim().toLowerCase()
            const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 200, 1), 500)
            const visible = items
              .filter((item) => resolved.agent.allowAll === true || (resolved.agent.allow ?? []).includes(item.name) || (resolved.agent.groups ?? []).includes(item.group))
              .filter((item) => !filter || String(item.name).toLowerCase().includes(filter))
              .sort((a, b) => String(a.name).localeCompare(String(b.name)))
              .slice(0, limit)
              // `kind` is what tells the caller to use get_secret (api) or
              // request_fill (web); without it a web login looks like a struck name.
              .map((item) => ({ name: item.name, kind: credentialKind(resolved.state, item.id) || 'unclassified', noApproval: item.noApproval === true, url: item.url }))
            return result(text(visible))
          }
          if (name === 'request_access') {
            const secretName = argName()
            if (!secretName) return result(text('name is required', true))
            // The same authority checks as the real use, minus the counter:
            // the DO still validates the identity binding, so a legacy grant
            // without one is reported here instead of at read time.
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx, consumeRead: false })
            const label = accessStatusLabel(access)
            if (label.status === 'allowed') return result(text(label.message))
            if (label.status === 'pending') return result(text(label.message))
            return result(text(label.message, true))
          }
          if (name === 'get_secret') {
            if (env.MCP_ALLOW_READ !== '1') return result(text('get_secret is disabled; set MCP_ALLOW_READ=1 to expose values', true))
            const secretName = argName()
            if (!secretName) return result(text('name is required', true))
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx })
            if (access.status === 'pending') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: resolved.agent.oauth ? 'oauth' : 'token', action: 'secret.read', ok: false })
              return result(pendingText(access))
            }
            if (access.status === 'forbidden' || access.status === 'notfound') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: resolved.agent.oauth ? 'oauth' : 'token', action: 'secret.read', ok: false })
              return result(text(access.error, true))
            }
            // Second layer: the same guard already ran inside agentAccess, where
            // the real item id is known. A website login is refused here; only an
            // api credential with an explicit read policy passes, unless the item
            // is marked no-approval (the operator accepted the risk per item).
            const readGuard = plaintextReadAllowed(resolved.state, access.itemId ?? '', { agent: resolved.name, noApproval: resolved.state.policies?.[secretName]?.noApproval === true, granted: access.status === 'allowed' ? { subject: resolved.name, accountId: session.email } : null })
            if (!readGuard.ok) {
              await addAudit(env, { event: 'secret.read-deny', agent: resolved.name, name: secretName, reason: readGuard.reason })
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: resolved.agent.oauth ? 'oauth' : 'token', action: 'secret.read', ok: false })
              return result(text('不能读明文：' + readGuardMessage(readGuard.reason), true))
            }
            await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: resolved.agent.oauth ? 'oauth' : 'token', action: 'secret.read', ok: true })
            return result(text(access.value))
          }
          if (name === 'get_credential') {
            if (env.MCP_ALLOW_READ !== '1') return result(text('get_credential is disabled; set MCP_ALLOW_READ=1', true))
            const secretName = argName()
            if (!secretName) return result(text('name is required', true))
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx })
            const credKind = resolved.agent.oauth ? 'oauth' : 'token'
            if (access.status === 'pending') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: credKind, action: 'secret.read', ok: false })
              return result(pendingText(access))
            }
            if (access.status === 'forbidden' || access.status === 'notfound') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: credKind, action: 'secret.read', ok: false })
              return result(text(access.error, true))
            }
            // A website login is fill-only: its username/password/totp must never
            // reach the Agent. An api key needs an explicit read policy, unless
            // the item is marked no-approval.
            const readGuard = plaintextReadAllowed(resolved.state, access.itemId ?? '', { agent: resolved.name, noApproval: resolved.state.policies?.[secretName]?.noApproval === true, granted: access.status === 'allowed' ? { subject: resolved.name, accountId: session.email } : null })
            if (!readGuard.ok) {
              await addAudit(env, { event: 'secret.read-deny', agent: resolved.name, name: secretName, reason: readGuard.reason })
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: credKind, action: 'secret.read', ok: false })
              return result(text('不能读明文：' + readGuardMessage(readGuard.reason), true))
            }
            const found = await readSecretFromRows(env, env.NODEWARDEN_DB, session, secretName)
            if (!found) {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: credKind, action: 'secret.read', ok: false })
              return result(text('not found', true))
            }
            await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: credKind, action: 'secret.read', ok: true })
            return result(text(JSON.stringify({ username: found.username, password: found.value, totp: found.totp })))
          }
          // materialize: the value never travels back through this call. An
          // approval records a one-shot job that only the same subject can
          // redeem, and the path must be on the operator's allowlist.
          if (name === 'materialize') {
            const secretName = argName().trim()
            if (!secretName) return result(text('name is required', true))
            const dest = materializeTarget(resolved.state, { path: args.path, key: args.key })
            if (!dest) {
              await addAudit(env, { event: 'materialize.deny', agent: resolved.name, name: secretName, path: String(args.path ?? '').slice(0, 200), key: String(args.key ?? '').slice(0, 64), reason: 'target-not-allowed' })
              return result(text('target path is not on the materialize allowlist; add it in 设置 → 安全 first', true))
            }
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx, action: 'secret.materialize', target: dest })
            // The request id is the job id once approved, so the caller can poll
            // materialize_redeem with it instead of asking again (asking again
            // would just queue another approval).
            if (access.status === 'pending') return result(text(JSON.stringify({ status: 'pending', id: access.requestId, approvalUrl: access.approvalUrl, path: dest.path, key: dest.key })))
            if (access.status === 'forbidden' || access.status === 'notfound') return result(text(access.error, true))
            if (access.status !== 'materialize-ok') return result(text('materialize was not authorized', true))
            return result(text(JSON.stringify({ status: 'approved', path: dest.path, key: dest.key })))
          }
          if (name === 'materialize_redeem') {
            // Redeeming hands the plaintext to the bridge over MCP, so it is a
            // read: the switch that says "no tool returns a value" must gate it
            // too, or materialize becomes a way around that switch.
            if (env.MCP_ALLOW_READ !== '1') return result(text('materialize_redeem is disabled; set MCP_ALLOW_READ=1 to expose values', true))
            const jobId = String(args.id ?? '').trim()
            const live = await loadState(env)
            const job = live.materializeJobs?.[jobId]
            // One answer for "no such job" and "not yours": the id must not
            // become an oracle for what other agents asked for.
            if (!job || job.agent !== resolved.name) return result(text('unknown materialize request', true))
            if (job.redeemedAt) return result(text('this request was already redeemed', true))
            if (Number(job.expiresAt ?? 0) < Date.now()) return result(text('this request expired', true))
            if (String(job.account).toLowerCase() !== String(session.email).toLowerCase()) return result(text('unknown materialize request', true))
            // Re-check the allowlist at redemption: removing a path must revoke
            // approvals that were granted while it was listed.
            if (!materializeTarget(live, job.target)) {
              await addAudit(env, { event: 'materialize.deny', agent: resolved.name, name: job.name, path: job.target?.path ?? '', reason: 'target-not-allowed' })
              return result(text('that target is no longer on the materialize allowlist', true))
            }
            const found = await readSecretFromRows(env, env.NODEWARDEN_DB, session, job.name)
            if (!found) return result(text('not found', true))
            // Writing a password into a file is still a plaintext read, so it
            // passes the same guard: a website login stays fill-only.
            const guard = plaintextReadAllowed(live, found.id || job.itemId, { agent: resolved.name, noApproval: live.policies?.[job.name]?.noApproval === true, granted: { subject: resolved.name, accountId: session.email } })
            if (!guard.ok) {
              await addAudit(env, { event: 'materialize.deny', agent: resolved.name, name: job.name, path: job.target?.path ?? '', reason: guard.reason })
              return result(text('不能读明文：' + readGuardMessage(guard.reason), true))
            }
            let won = false
            await updateState(env, (next) => {
              won = false
              const entry = next.materializeJobs?.[jobId]
              if (!entry || entry.redeemedAt) return next
              entry.redeemedAt = nowIso()
              won = true
              return next
            })
            if (!won) return result(text('this request was already redeemed', true))
            await addAudit(env, { event: 'secret.materialize', agent: resolved.name, name: job.name, itemId: job.itemId, path: job.target?.path ?? '', key: job.target?.key ?? '', via: 'agent' })
            return result(text(JSON.stringify({ path: job.target?.path ?? '', key: job.target?.key ?? '', value: found.value })))
          }
          // request_fill: ask for a website credential to be filled in. The Agent
          // never receives the value; it only learns whether the request was
          // approved and, if so, the short-lived authorization handed to the
          // execution layer. Without a configured execution layer this fails
          // closed and returns no secret material. The older name is kept so a
          // client that already calls secret.fill keeps working.
          if (name === 'request_fill' || name === 'secret.fill') {
            const secretName = argName().trim()
            if (!secretName) return result(text('name is required', true))
            const requestedOrigin = normalizeOrigin(args.origin)
            if (!requestedOrigin) return result(text('a valid https origin is required', true))
            const access = await agentAccess(env, {
              session, agentName: resolved.name, agent: resolved.agent, state: resolved.state,
              name: secretName, origin: url.origin, ctx, action: 'secret.fill',
              target: { host: requestedOrigin.host, port: requestedOrigin.port, method: 'POST', pathname: '/', origin: requestedOrigin.origin, action: String(args.action ?? 'login') },
            })
            const fillKind = resolved.agent.oauth ? 'oauth' : 'token'
            if (access.status === 'pending') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: fillKind, action: 'secret.fill', ok: false })
              return result(pendingText(access))
            }
            if (access.status === 'forbidden' || access.status === 'notfound') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: fillKind, action: 'secret.fill', ok: false })
              return result(text(access.error, true))
            }
            if (access.status !== 'fill-ok') return result(text('fill was not authorized', true))
            // Policy check happens after authorization so an unauthorized agent
            // cannot probe which credentials exist.
            const policy = fillPolicyFor(resolved.state, access.itemId ?? '', requestedOrigin.origin)
            if (!policy.ok) {
              await addAudit(env, { event: 'fill.deny', agent: resolved.name, name: secretName, origin: requestedOrigin.origin, reason: policy.reason })
              return result(text('fill is not permitted for this credential and origin: ' + policy.reason, true))
            }
            if (!policy.actions.includes(String(args.action ?? 'login'))) {
              await addAudit(env, { event: 'fill.deny', agent: resolved.name, name: secretName, origin: requestedOrigin.origin, reason: 'action-not-allowed' })
              return result(text('fill action is not allowed by the policy', true))
            }
            // Rate limits: one agent may not flood the executor queue.
            const rateState = await loadState(env)
            const agentLimited = await fillRateLimited(env, 'agent:' + resolved.name, FILL_RATE_LIMITS.agentTasksPerMinute, 60000)
            if (agentLimited) {
              await addAudit(env, { event: 'fill.deny', agent: resolved.name, name: secretName, origin: requestedOrigin.origin, reason: 'rate-limited' })
              return result(text('too many fill requests, slow down', true))
            }
            // Concurrency caps: one account and one credential may only have
            // a few tasks open at a time.
            const openAccount = await countOpenTasks(env, (task) => task.accountId === session.email)
            if (openAccount >= FILL_RATE_LIMITS.accountConcurrent) return result(text('too many open fill tasks for this account', true))
            const openCredential = await countOpenTasks(env, (task) => task.cipherId === access.itemId)
            if (openCredential >= FILL_RATE_LIMITS.credentialConcurrent) return result(text('too many open fill tasks for this credential', true))
            // The task is routed to a registered executor. Without one the
            // request fails closed: the Agent never receives the value and there
            // is nothing that could redeem a credential.
            const executors = Object.values(rateState.fillExecutors ?? {}).filter((entry) => entry && !entry.revokedAt)
            if (!executors.length) {
              await addAudit(env, { event: 'fill.deny', agent: resolved.name, name: secretName, origin: requestedOrigin.origin, reason: 'no-execution-layer' })
              return result(text('fill execution layer is not configured', true))
            }
            const executor = executors.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
            const task = await createFillTask(env, {
              agent: resolved.name, accountId: session.email, cipherId: access.itemId ?? '', itemName: secretName,
              origin: requestedOrigin.origin, action: String(args.action ?? 'login'),
              policyRevision: String(policy.policy?.policyRevision ?? ''), executorId: executor.executorId,
            })
            if (!task.ok) return result(text('the fill task could not be created', true))
            await addAudit(env, { event: 'fill.authorize', agent: resolved.name, name: secretName, origin: requestedOrigin.origin, approval: access.approval ?? 'policy', taskId: task.task.taskId })
            await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: fillKind, action: 'secret.fill', ok: true })
            // The Agent learns the task id and the target origin. It never
            // receives the task credential, which only the executor can read.
            return result(text(JSON.stringify({
              taskId: task.task.taskId, origin: requestedOrigin.origin,
              state: task.task.state, expiresInSeconds: Math.floor((task.task.expiresAt - Date.now()) / 1000),
            })))
            }
          if (name === 'request_credential') {
            const secretName = argName().trim()
            if (!secretName) return result(text('name is required', true))
            const id = crypto.randomUUID()
            const entry = { id, agent: resolved.name, account: session.email, name: secretName, description: String(args.description ?? '').slice(0, 500), createdAt: nowIso() }
            await updateState(env, (next) => { next.credentialRequests ??= {}; next.credentialRequests[id] = entry; return next })
            await addAudit(env, { event: 'credential.request', agent: resolved.name, name: secretName })
            return result(text(`credential request created: ${url.origin}/connect?id=${id}`))
          }
          if (name === 'http_request') {
            const secretName = argName()
            if (!secretName) return result(text('name is required', true))
            // secret.use is a distinct action from secret.read: it never
            // returns plaintext and requires a per-item target policy.
            const useTarget = useTargetOf(args.url, args.method)
            if (!useTarget) return result(text('invalid url', true))
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx, action: 'secret.use', target: useTarget })
            const useKind = resolved.agent.oauth ? 'oauth' : 'token'
            if (access.status === 'pending') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: useKind, action: 'secret.use', ok: false })
              return result(pendingText(access))
            }
            if (access.status === 'forbidden' || access.status === 'notfound') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: useKind, action: 'secret.use', ok: false })
              return result(text(access.error, true))
            }
            if (access.status !== 'use-ok') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: useKind, action: 'secret.use', ok: false })
              return result(text('secret.use denied', true))
            }
            const method = String(args.method ?? 'GET').trim().toUpperCase()
            if (!method || method.length > 16) return result(text('invalid method (max 16 chars)', true))
            const secretHeaderAllow = { authorization: 'Authorization', 'x-api-key': 'X-Api-Key', 'api-key': 'Api-Key', 'x-auth-token': 'X-Auth-Token' }
            const rawHeaderName = String(args.headerName ?? 'Authorization').trim()
            const headerName = secretHeaderAllow[rawHeaderName.toLowerCase()]
            if (!headerName) return result(text('headerName is not allowed (use Authorization, X-Api-Key, Api-Key or X-Auth-Token)', true))
            const authPrefix = String(args.authPrefix ?? 'Bearer ')
            if (authPrefix.length > 32 || /[\r\n]/.test(authPrefix)) return result(text('invalid authPrefix (max 32 chars, no CR/LF)', true))
            const rawHeaders = args.headers && typeof args.headers === 'object' ? args.headers : {}
            if (Object.keys(rawHeaders).length > 20) return result(text('too many headers (max 20)', true))
            const blockedHeaders = new Set(['host', 'content-length', 'connection', 'cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'proxy-authenticate', 'x-api-key', 'api-key', 'x-auth-token', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'keep-alive', 'expect'])
            const headers = Object.create(null)
            for (const [rawKey, rawValue] of Object.entries(rawHeaders)) {
              const key = String(rawKey)
              const value = String(rawValue ?? '')
              if (!/^[A-Za-z0-9-]+$/.test(key)) return result(text(`invalid header name (allowed: /^[A-Za-z0-9-]+$/): ${key.slice(0, 64)}`, true))
              if (blockedHeaders.has(key.toLowerCase())) continue
              if (value.length > 4096) return result(text(`header value too long (max 4KB): ${key.slice(0, 64)}`, true))
              headers[key] = value
              if (Object.keys(headers).length > 20) return result(text('too many headers (max 20)', true))
            }
            let reqBody = null
            if (args.body != null) {
              reqBody = String(args.body)
              if (reqBody.length > 65536) return result(text('body too large (max 64KB)', true))
              if (['GET', 'HEAD'].includes(method) && reqBody.length > 0) return result(text('GET/HEAD must not include a body', true))
            }
            let target
            try { target = new URL(String(args.url ?? '')) } catch { return result(text('invalid url', true)) }
            if (target.protocol !== 'https:') return result(text('only https targets are allowed', true))
            if (target.username || target.password) return result(text('userinfo in target url is not allowed', true))
            const port = String(target.port ?? '')
            const allowPaths = [] // per-item usePolicies are the authority now
            const pathAllowed = (pathname, prefix) => pathname === prefix || (prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname.startsWith(prefix + '/'))
            if (allowPaths.length > 0 && !allowPaths.some((prefix) => pathAllowed(target.pathname, prefix))) return result(text('target path is not allowed', true))
            const host = target.hostname.toLowerCase()
            const normHost = host.endsWith('.') ? host.slice(0, -1).toLowerCase() : host
            const deBracket = normHost.startsWith('[') && normHost.endsWith(']') ? normHost.slice(1, -1).toLowerCase() : normHost
            const isAllNumericIp = (() => {
              const parts = normHost.split('.')
              if (parts.length >= 1 && parts.length <= 4 && parts.every((part) => /^(0x[0-9a-f]+|0[0-7]*|[0-9]+)$/i.test(part) && part.length > 0)) return true
              return false
            })()
            const isMappedV6 = deBracket === '::1' || deBracket === '::' || deBracket.startsWith('::ffff:') || deBracket.startsWith('0:0:0:0:0:ffff:') || deBracket.startsWith('fe80:') || deBracket.startsWith('fc00:') || deBracket.startsWith('fd00:')
            if (isAllNumericIp || isMappedV6) return result(text('private/local targets are not allowed', true))
            if (normHost === 'localhost' || normHost.endsWith('.local') || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(normHost) || normHost === '::1' || normHost === '[::1]') return result(text('private/local targets are not allowed', true))
            const allowedHosts = new Set(String(env.HTTP_ALLOWED_HOSTS ?? '').split(',').map((value) => { const v = value.trim().toLowerCase(); return v.endsWith('.') ? v.slice(0, -1) : v }).filter(Boolean))
            // Per-item usePolicies already authorized the exact host above.
            // HTTP_ALLOWED_HOSTS stays as an optional operator-level extra
            // restriction when configured (intersection, not replacement).
            if (allowedHosts.size > 0 && !allowedHosts.has(normHost)) return result(text('target host is not allowed by HTTP_ALLOWED_HOSTS', true))
            // Broker-side decrypt for injection only. This value is never
            // serialized into the MCP response.
            const material = await readSecretFromRows(env, env.NODEWARDEN_DB, session, secretName)
            if (!material || !material.value) return result(text('credential unavailable', true))
            headers[headerName] = authPrefix + material.value
            const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) }
            if (reqBody != null && !['GET', 'HEAD'].includes(method)) init.body = reqBody
            let response
            try { response = await fetch(target.toString(), init) } catch (error) {
              // Record the real outcome: the call was authorized but the upstream
              // request itself failed.
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: useKind, action: 'secret.use', ok: false })
              return result(text(error?.name === 'TimeoutError' ? 'upstream request timed out (15s)' : `upstream fetch failed: ${String(error?.message ?? error).slice(0, 200)}`, true))
            }
            const rawBody = (await response.text()).slice(0, 8000)
            // Defense-in-depth only: strip the exact injected value and common
            // echo forms. This is NOT a guarantee against arbitrary encoding,
            // transforms or partial echoes - see SECURITY.md.
            const scrub = (input) => {
              if (typeof input !== 'string' || !material.value) return input
              let out = input
              out = out.split(material.value).join('[REDACTED]')
              out = out.split(authPrefix + material.value).join('[REDACTED]')
              out = out.split(encodeURIComponent(material.value)).join('[REDACTED]')
              out = out.split(Buffer.from(material.value).toString('base64')).join('[REDACTED]')
              return out
            }
            const responseBody = scrub(rawBody)
            await addAudit(env, { event: 'secret.use', agent: resolved.name, name: secretName, via: 'http_request', method, host: normHost, path: target.pathname.slice(0, 200), status: response.status })
            // A completed upstream call counts as a successful use regardless of
            // the upstream status code: the broker did its job.
            await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: useKind, action: 'secret.use', ok: true })
            return result(text(JSON.stringify({ status: response.status, ok: response.ok, body: responseBody })))
          }
          return rpcError('unknown tool')
        } catch (error) {
          return result(text(String(error.message ?? error), true))
        }
      }
      return rpcError('unknown method')
    }
    if (url.pathname === '/agent/items/save' && request.method === 'POST') {
      const resolved = await resolveAgent(request, env)
      if (!resolved) return fail('unauthorized', 401)
      if (resolved.agent.write !== true) return fail('agent is not allowed to write', 403)
      const session = await getSession(env)
      if (!session) return fail('vault locked', 423)
      if (resolved.agent.account && String(resolved.agent.account).toLowerCase() !== String(session.email).toLowerCase()) return fail('agent is bound to another vault account', 403)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim()
      if (!name) return fail('name required', 400)
      const forbid = async (reason, audit) => {
        await addAudit(env, { event: 'secret.write-deny', agent: resolved.name, name: audit?.name ?? name, reason })
        return fail(reason, 403)
      }
      // write=true only permits the write operation; item/group scope still
      // applies, using the same agentInScope rule as reads.
      const inWriteScope = (targetName, groupOverride) => agentInScope(resolved.agent, resolved.state.itemGroups, targetName, groupOverride)
      try {
        const found = await findCipherRow(env, env.NODEWARDEN_DB, session, name)
        if (found) {
          if (!inWriteScope(name)) return forbid('agent not allowed to write this item', { name })
          const rawNewName = typeof body.newName === 'string' ? body.newName.trim() : ''
          if (rawNewName && rawNewName !== name && !inWriteScope(rawNewName, typeof body.group === 'string' ? body.group.trim() : (resolved.state.itemGroups?.[rawNewName] ?? ''))) return forbid('agent not allowed to write this item', { name: rawNewName })
          const currentGroup = resolved.state.itemGroups?.[name] ?? ''
          const nextGroup = typeof body.group === 'string' ? body.group.trim() : currentGroup
          if (nextGroup !== currentGroup) {
            const targetForGroup = rawNewName && rawNewName !== name ? rawNewName : name
            if (!inWriteScope(targetForGroup, nextGroup)) return forbid('agent not allowed to move this item to the target group', { name: targetForGroup })
          }
          // Explicit field allowlist: never forward Agent-controlled permission
          // or identity keys (allow/allowAll/groups/noApproval/id/...) into
          // the cipher helpers. Rename/move is expressed via newName/group.
          await updateCipher(env, env.NODEWARDEN_DB, session, name, {
            newName: typeof body.newName === 'string' ? body.newName : undefined,
            group: typeof body.group === 'string' ? body.group : undefined,
            value: typeof body.value === 'string' ? body.value : undefined,
            username: typeof body.username === 'string' ? body.username : undefined,
            totp: typeof body.totp === 'string' ? body.totp : undefined,
            url: typeof body.url === 'string' ? body.url : undefined,
            notes: typeof body.notes === 'string' ? body.notes : undefined,
          })
          return json({ ok: true, name, updated: true })
        }
        const targetGroup = typeof body.group === 'string' ? body.group.trim() : ''
        if (!inWriteScope(name, targetGroup)) return forbid('agent not allowed to create this item', { name })
        const created = await createCipher(env, env.NODEWARDEN_DB, session, {
          name,
          value: typeof body.value === 'string' ? body.value : undefined,
          username: typeof body.username === 'string' ? body.username : undefined,
          totp: typeof body.totp === 'string' ? body.totp : undefined,
          url: typeof body.url === 'string' ? body.url : undefined,
          notes: typeof body.notes === 'string' ? body.notes : undefined,
          group: typeof body.group === 'string' ? body.group : undefined,
        })
        await addAudit(env, { event: 'secret.write', agent: resolved.name, name })
        return json({ ok: true, name: created.name, created: true })
      } catch (error) { return fail(String(error.message ?? error), error.status ?? 500) }
    }
    // Reading a stored password out of the admin panel is the most direct way to
    // turn one stolen session cookie into every credential in the vault, so it is
    // gated on the second factor rather than on the cookie alone. Without TOTP
    // there is nothing to gate on, and the panel tells the operator to enrol it.
    if (url.pathname === '/api/secret/reveal' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('vault locked', 423)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim()
      if (!name) return fail('name required', 400)
      const refused = await secondFactorWall(request, env, 'secret.view', body.code)
      if (refused) return refused
      const result = await readSecretFromRows(env, env.NODEWARDEN_DB, session, name)
      if (!result) return fail('not found', 404)
      await addAudit(env, { event: 'secret.view', name, via: 'web', totp: true })
      return json({ value: result.value, username: result.username, totp: result.totp })
    }
    if (url.pathname === '/secret') {
      // Agents only. The panel reads a password through /api/secret/reveal,
      // which asks for a second factor; this route never did, so a stolen
      // session cookie could read any plaintext here and the second factor
      // protected nothing. A browser cookie is not an agent token, and the
      // README only ever documents the Bearer form for this route.
      const resolved = await resolveAgent(request, env)
      if (!resolved) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('vault locked', 423)
      const name = url.searchParams.get('name') ?? ''
      if (!name) return fail('name required', 400)
      try {
        const access = await agentAccess(env, {
          session, agentName: resolved.name, agent: resolved.agent, state: resolved.state,
          name, origin: url.origin, ctx,
        })
        if (access.status === 'pending') return json({ status: 'pending', requestId: access.requestId, approvalUrl: access.approvalUrl }, 202)
        if (access.status === 'forbidden') return fail(access.error, 403)
        if (access.status === 'notfound') return fail(access.error, 404)
        // Second layer: the same guard already ran inside agentAccess. A
        // website login is refused; only an api credential with an explicit
        // read policy passes, unless the item is marked no-approval.
        // The item name here is `name`; `secretName` only exists in the /mcp
        // tools scope, and referring to it made every successful /secret call
        // throw a ReferenceError and answer 500.
        const readGuard = plaintextReadAllowed(resolved.state, access.itemId ?? '', { agent: resolved.name, noApproval: resolved.state.policies?.[name]?.noApproval === true, granted: access.status === 'allowed' ? { subject: resolved.name, accountId: session.email } : null })
        if (!readGuard.ok) {
          await addAudit(env, { event: 'secret.read-deny', agent: resolved.name, name, reason: readGuard.reason })
          return fail('不能读明文：' + readGuardMessage(readGuard.reason), 403)
        }
        return json({ value: access.value })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    // The v2 vault. Admin session required: device tokens arrive with /pair in
    // the next step, and until then the browser is the only caller.
    // Device-side push: the rows arrive already sealed, so this is write access
    // without read access. Only a device a human approved in a browser may do it.
    if (url.pathname === '/api/v2/push' && request.method === 'POST') {
      const bearer = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
      const device = bearer ? await vault2DeviceByToken(env, bearer) : null
      if (!device) return fail('a device token is required', 401)
      if (!device.canWrite) return fail('this device may read but not write', 403)
      if (await vault2RekeyPending(env)) return fail('vault is being re-encrypted, retry shortly', 503)
      const body = await request.json().catch(() => ({}))
      const result = await vault2Push(env, body.items)
      await addAudit(env, { event: 'vault.push', agent: device.name, name: String(result.written) })
      return json(result)
    }
    // Device-code pairing, request half: a machine that cannot open a browser
    // asks for a short code. Nothing is granted here — the poll token only lets
    // that machine collect what an admin approves in the browser.
    if (url.pathname === '/api/v2/pair/request' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim().slice(0, 60)
      const jwk = body.publicJwk && typeof body.publicJwk === 'object' ? body.publicJwk : null
      if (!name) return fail('name is required', 400)
      if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) return fail('publicJwk must be a P-256 public key', 400)
      if (!(await vault2Status(env)).initialized) return fail('vault is not initialised', 409)
      // No O/0 or I/1: the code gets read off a terminal and typed into a phone.
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      const chunk = (count) => [...crypto.getRandomValues(new Uint8Array(count))].map((byte) => alphabet[byte % alphabet.length]).join('')
      const code = chunk(4) + '-' + chunk(4)
      const pollToken = base64Url(crypto.getRandomValues(new Uint8Array(32)))
      const expiresAt = Date.now() + 5 * 60 * 1000
      const fingerprint = await publicKeyFingerprint(jwk)
      await stateStub(env).fetch('https://state/pair', {
        method: 'POST',
        body: JSON.stringify({ op: 'request', code, name, jwk, fingerprint, pollHash: await sha256Base64(pollToken), expiresAt }),
      })
      return json({ code, pollToken, url: url.origin + '/pair?code=' + encodeURIComponent(code), fingerprint, expiresAt })
    }
    // Poll half. The token, never the code, proves this is the machine that asked.
    if (url.pathname === '/api/v2/pair/poll' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const pollToken = String(body.pollToken ?? '')
      if (pollToken.length < 16) return fail('pollToken is required', 400)
      const response = await stateStub(env).fetch('https://state/pair', {
        method: 'POST',
        body: JSON.stringify({ op: 'poll', pollHash: await sha256Base64(pollToken) }),
      })
      const result = await response.json().catch(() => ({}))
      if (!result.ok) return fail('pairing not found or expired', 410)
      if (result.status !== 'approved') return json({ status: 'pending' }, 202)
      return json({
        status: 'approved',
        deviceId: result.approved.deviceId,
        token: result.approved.token,
        envelope: result.approved.envelope,
        keygen: result.approved.keygen,
        fingerprint: result.approved.fingerprint,
      })
    }
    // The approval page. Behind the admin session, and it shows the same key
    // fingerprint the terminal printed, so a swapped key cannot be approved.
    if (url.pathname === '/pair' && request.method === 'GET') {
      const code = String(url.searchParams.get('code') ?? '').toUpperCase()
      if (!(await adminAuthorized(request, env))) return new Response(null, { status: 302, headers: { location: '/login?next=' + encodeURIComponent('/pair?code=' + code) } })
      const peek = await (await stateStub(env).fetch('https://state/pair', {
        method: 'POST',
        body: JSON.stringify({ op: 'lookup', code }),
      })).json().catch(() => ({}))
      return htmlResponse(pairPage({ code, entry: peek.ok ? peek.entry : null }))
    }
    if (url.pathname.startsWith('/api/v2/')) {
      const isAdmin = await adminAuthorized(request, env)
      const route = url.pathname.slice('/api/v2/'.length)
      // While a rekey is in flight the rows sit under two keys at once. Let nobody
      // read or write until it finishes, or a peer caches a row it cannot open.
      const rekey = await vault2RekeyPending(env).catch(() => null)
      if (rekey && (route === 'items' || route.startsWith('items/'))) {
        return new Response(JSON.stringify({ error: 'rekey in progress', rekey }), { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '30' } })
      }
      // A paired device may pull ciphertext while the vault is locked: it holds
      // the data key locally, so the server never has to decrypt for it. This is
      // the only surface a device token reaches; everything else needs the admin
      // session.
      if (!isAdmin && (route === 'items' || route === 'device/self') && request.method === 'GET') {
        const bearer = request.headers.get('authorization') ?? ''
        const presented = (bearer.match(/^Bearer\s+(.+)$/i) ?? [])[1] ?? ''
        const device = await vault2DeviceByToken(env, presented).catch(() => null)
        if (!device) return fail('unauthorized', 401)
        if (route === 'device/self') {
          const self = await vault2DeviceSelf(env, device.id)
          if (!self) return fail('this device has no keyring any more', 404)
          return json({ name: device.name, ...self })
        }
        return json({ ...(await vault2List(env, Number(url.searchParams.get('since') ?? 0))), device: device.name })
      }
      if (!isAdmin) return fail('unauthorized', 401)
      const keyCall = async (method, body) => {
        const response = await stateStub(env).fetch('https://state/v2-key', {
          method,
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
        return response.json().catch(() => ({}))
      }
      const unlockedKey = async () => {
        const cached = await keyCall('GET')
        return cached.ok ? Uint8Array.from(cached.dek) : null
      }
      try {
        if (route === 'status' && request.method === 'GET') {
          const status = await vault2Status(env)
          const cached = await keyCall('GET')
          return json({ ...status, unlocked: Boolean(cached.ok), keyExpiresAt: cached.expiresAt ?? null })
        }
        if (route === 'init' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}))
          const password = String(body.password ?? '')
          if (password.length < 12) return fail('password must be at least 12 characters', 400)
          const { dek, fingerprint } = await vault2Init(env, password)
          await keyCall('PUT', { dek: [...dek] })
          await addAudit(env, { event: 'vault.init', agent: 'admin', name: fingerprint })
          return json({ ok: true, fingerprint })
        }
        if (route === 'unlock' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}))
          let opened = null
          try {
            opened = await vault2Unlock(env, String(body.password ?? ''))
          } catch {
            await addAudit(env, { event: 'vault.unlock-deny', agent: 'admin', reason: 'wrong-password' })
            return fail('wrong password', 401)
          }
          await keyCall('PUT', { dek: [...opened.dek], ttlMs: body.ttlMs })
          await addAudit(env, { event: 'vault.unlock', agent: 'admin', name: opened.fingerprint })
          return json({ ok: true, fingerprint: opened.fingerprint })
        }
        if (route === 'lock' && request.method === 'POST') {
          await keyCall('DELETE')
          return json({ ok: true })
        }
        // Rekey: the only way to take a key back from a device we already handed it
        // to. Needs the master password, because the new key is wrapped under it and
        // an interrupted run has to be resumable with it.
        if (route === 'rekey' && request.method === 'POST') {
          const dek = await unlockedKey()
          if (!dek) return fail('vault is locked', 423)
          const body = await request.json().catch(() => ({}))
          const password = String(body.password ?? '')
          if (password.length < 12) return fail('the master password is required to rekey', 400)
          let result = null
          try {
            result = await vault2Rekey(env, dek, password)
          } catch (error) { return fail(String(error.message ?? error), 400) }
          await keyCall('PUT', { dek: [...result.dek] })
          await addAudit(env, { event: 'vault.rekey', agent: 'admin', name: result.fingerprint, reason: `items=${result.converted} tombstones=${result.wiped} devices=${result.devices}` })
          return json({ ok: true, fingerprint: result.fingerprint, converted: result.converted, wiped: result.wiped, devices: result.devices })
        }
        // Pairing hands this device the same data key, wrapped to its own public
        // key. The token comes back once and is stored only as a hash.
        if (route === 'pair' && request.method === 'POST') {
          const dek = await unlockedKey()
          if (!dek) return fail('vault is locked', 423)
          const body = await request.json().catch(() => ({}))
          let paired = null
          try {
            paired = await vault2Pair(env, dek, body)
          } catch (error) { return fail(String(error.message ?? error), 400) }
          await addAudit(env, { event: 'vault.pair', agent: 'admin', name: paired.name })
          return json(paired, 201)
        }
        if (route === 'devices' && request.method === 'GET') {
          return json({ devices: await vault2Devices(env) })
        }
        if (route.startsWith('devices/') && request.method === 'PATCH') {
          const id = route.slice('devices/'.length)
          const body = await request.json().catch(() => ({}))
          const result = await vault2SetDeviceWrite(env, id, body.canWrite === true)
          if (!result) return fail('device not found', 404)
          if (result.error) return fail(result.error, 409)
          await addAudit(env, { event: 'vault.device-write', agent: 'admin', name: result.id, canWrite: result.canWrite })
          return json(result)
        }
        if (route.startsWith('devices/') && request.method === 'DELETE') {
          const id = route.slice('devices/'.length)
          if (url.searchParams.get('purge') === '1') {
            const purged = await vault2PurgeDevice(env, id)
            if (!purged) return fail('device not found', 404)
            if (purged.error) return fail(purged.error, 409)
            await addAudit(env, { event: 'vault.device-purge', agent: 'admin', name: id })
            return json(purged)
          }
          const revoked = await vault2RevokeDevice(env, id)
          if (!revoked) return fail('device not found', 404)
          await addAudit(env, { event: 'vault.device-revoke', agent: 'admin', name: id })
          return json(revoked)
        }
        if (route === 'pair/approve' && request.method === 'POST') {
          const dek = await unlockedKey()
          if (!dek) return fail('vault is locked', 423)
          const body = await request.json().catch(() => ({}))
          const code = String(body.code ?? '').trim().toUpperCase()
          const peek = await (await stateStub(env).fetch('https://state/pair', {
            method: 'POST',
            body: JSON.stringify({ op: 'lookup', code }),
          })).json().catch(() => ({}))
          if (!peek.ok) return fail('pairing not found or expired', 410)
          if (peek.entry.approved) return fail('this code was already approved', 409)
          const paired = await vault2Pair(env, dek, { name: peek.entry.name, publicJwk: peek.entry.jwk })
          const keygen = String((await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'keygen'").first())?.value ?? '')
          await stateStub(env).fetch('https://state/pair', {
            method: 'POST',
            body: JSON.stringify({ op: 'approve', code, deviceId: paired.id, token: paired.token, envelope: paired.envelope, keygen, fingerprint: paired.fingerprint }),
          })
          await addAudit(env, { event: 'vault.device', agent: 'admin', name: paired.name })
          return json({ ok: true, deviceId: paired.id, name: paired.name, fingerprint: paired.fingerprint })
        }
        if (route === 'items' && request.method === 'GET') {
          if (url.searchParams.get('plain') === '1') {
            const dek = await unlockedKey()
            if (!dek) return fail('vault is locked', 423)
            return json(await vault2ListPlain(env, dek, Number(url.searchParams.get('since') ?? 0)))
          }
          return json(await vault2List(env, Number(url.searchParams.get('since') ?? 0)))
        }
        if (route === 'items' && request.method === 'POST') {
          const dek = await unlockedKey()
          if (!dek) return fail('vault is locked', 423)
          const body = await request.json().catch(() => ({}))
          const created = await vault2Create(env, dek, body)
          await addAudit(env, { event: 'vault.item.create', agent: 'admin', name: String(body.payload?.name ?? created.id) })
          return json(created, 201)
        }
        // Import copies the cipher vault into this one. Both have to be open:
        // each row is decrypted with the cipher key and sealed again with the
        // v2 data key, so neither key on its own is enough. The row id is kept
        // as the item id, which makes a second run collide on the primary key
        // instead of duplicating everything.
        // shortcut: one pass over at most 2000 rows, upgrade to a resumable job
        // if a vault ever exceeds that.
        if (route === 'import' && request.method === 'POST') {
          const dek = await unlockedKey()
          if (!dek) return fail('vault is locked', 423)
          const session = await getSession(env)
          if (!session) return fail('the cipher vault is locked', 423)
          const user = await vaultUser(env, env.NODEWARDEN_DB, session)
          const rows = await env.NODEWARDEN_DB.prepare('SELECT id, type, name, notes, data FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 2000').bind(user.id).all()
          const state = await loadState(env)
          let imported = 0
          let skipped = 0
          for (const row of rows.results ?? []) {
            let decrypted = null
            try { decrypted = await decryptCipherRow(row, session) } catch { skipped += 1; continue }
            const payload = {
              name: decrypted.name || '(untitled)',
              username: extractUsername(decrypted),
              password: extractSecret(decrypted),
              totp: extractTotp(decrypted),
              url: cipherUrl(decrypted.data),
              notes: decrypted.notes || '',
            }
            const kind = state.credentialKinds?.[row.id] === 'web' ? 'web' : 'api'
            try { await vault2Create(env, dek, { id: row.id, kind, payload }); imported += 1 } catch { skipped += 1 }
          }
          await addAudit(env, { event: 'vault.import', agent: 'admin', name: String(imported), reason: 'skipped ' + skipped })
          return json({ ok: true, imported, skipped, total: (rows.results ?? []).length })
        }
        if (route.startsWith('items/')) {
          const id = route.slice('items/'.length)
          if (request.method === 'GET') {
            const dek = await unlockedKey()
            if (!dek) return fail('vault is locked', 423)
            const item = await vault2Read(env, dek, id)
            if (!item) return fail('item not found', 404)
            return json(item)
          }
          if (request.method === 'PUT') {
            const dek = await unlockedKey()
            if (!dek) return fail('vault is locked', 423)
            const updated = await vault2Update(env, dek, id, await request.json().catch(() => ({})))
            if (!updated) return fail('item not found', 404)
            await addAudit(env, { event: 'vault.item.update', agent: 'admin', name: id })
            return json(updated)
          }
          if (request.method === 'DELETE') {
            const deleted = await vault2Delete(env, id)
            if (!deleted) return fail('item not found', 404)
            await addAudit(env, { event: 'vault.item.delete', agent: 'admin', name: id })
            return json(deleted)
          }
        }
        return fail('not found', 404)
      } catch (error) { return fail(String(error.message ?? error), 400) }
    }
    return fail('not found', 404)
  },
}
