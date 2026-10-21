import { DurableObject } from 'cloudflare:workers'
import { uiHtml } from './ui.js'
import { LOGO_PNG_B64, FAVICON_ICO_B64 } from './logo.js'
import {
  b64ToBytes, cipherKeys, constantTimeEqual, decryptCipherRow, decryptStr, encryptStr, extractSecret, extractUsername, extractTotp,
  hmacToken, pbkdf2, sha256Base64, unwrapWithKek, wrapWithKek, bytesToB64,
} from './crypto.js'
import { parseJwt, verifyJwtSignature, validateIdTokenClaims, checkUserinfoSub } from './oidc.js'

const encoder = new TextEncoder()
const SESSION_COOKIE = 'broker_admin'
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers })
const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
}
const htmlResponse = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...securityHeaders } })
const fail = (message, status = 400) => json({ error: message }, status)
const nowIso = () => new Date().toISOString()

const emptyState = () => ({ agents: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {} } })

export class BrokerState extends DurableObject {
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
    if (url.pathname === '/grant/consume' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const state = (await this.ctx.storage.get('state')) ?? null
      const key = `${String(body.agent ?? '')}\u0000${String(body.name ?? '')}`
      const grant = state?.grants?.[key]
      if (!grant || grant.revokedAt) return json({ ok: false, reason: 'no-grant' })
      if (grant.expiresAt && grant.expiresAt < Date.now()) return json({ ok: false, reason: 'expired' })
      if (grant.maxReads != null && (grant.reads ?? 0) >= grant.maxReads) return json({ ok: false, reason: 'exhausted' })
      grant.reads = (grant.reads ?? 0) + 1
      if (grant.maxReads != null && grant.reads >= grant.maxReads) delete state.grants[key]
      await this.ctx.storage.put('state', state)
      return json({ ok: true, reads: grant.reads })
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
        await txn.put('state', store)
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
        record.consumedAt = Date.now()
        ledger[nonce] = record
        await txn.put('fillAuthorizations', ledger)
        return { ok: true, record }
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
        await txn.put('state', store)
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
        await txn.put('state', store)
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
      if (parts.length < 6) return json({ ok: false, reason: 'invalid' })
      const signature = parts.pop()
      const expires = Number(parts.pop())
      const next = parts.pop()
      const nonce = parts.pop()
      const verifier = parts.pop()
      const state = parts.join('|')
      if (!state || state !== returned) return json({ ok: false, reason: 'mismatch' })
      const payload = `${state}|${verifier}|${nonce}|${next}|${expires}`
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
        await txn.put('state', store)
        return true
      })
      if (!marked) return json({ ok: false, reason: 'replay' })
      return json({ ok: true, state, verifier, nonce, next, expires })
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
const STATE_WRITE_ATTEMPTS = 8
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
    // Lost the race: back off briefly and re-apply the mutation to fresh state.
    await new Promise((resolve) => setTimeout(resolve, 5 + attempt * 10))
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

async function oidcConfig(env, request, state) {
  const stored = state?.settings?.oidc ?? {}
  const issuer = String(stored.issuer || env.OIDC_ISSUER || '').replace(/\/$/, '')
  const clientId = String(stored.clientId || env.OIDC_CLIENT_ID || '')
  const clientSecret = String(stored.clientSecret || env.OIDC_CLIENT_SECRET || '')
  const redirectUri = String(stored.redirectUri || env.OIDC_REDIRECT_URI || `${new URL(request.url).origin}/oidc/callback`)
  if (!issuer || !clientId) return null
  return {
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

async function oidcStateCookie(env, state, verifier, next = '', nonce = '') {
  const expires = Date.now() + 10 * 60 * 1000
  const payload = `${state}|${verifier}|${nonce}|${next}|${expires}`
  const signature = await hmacToken(await cookieKey(env), payload)
  return encodeURIComponent(`${payload}|${signature}`)
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
      try { if (new URL(origin).origin !== new URL(request.url).origin) return false } catch { return false }
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
    if (!constantTimeEqual(encoder.encode(agent.hash), encoder.encode(hash))) continue
    // Static agents may carry an authorization window (set via
    // /api/agents/extend). expiresAt null/undefined = permanent.
    if (typeof agent.expiresAt === 'number' && agent.expiresAt < Date.now()) return null
    return { name, agent, state }
  }
  for (const tokenEntry of Object.values(state.oauthTokens ?? {})) {
    if (tokenEntry.expiresAt && tokenEntry.expiresAt < Date.now()) continue
    if (constantTimeEqual(encoder.encode(tokenEntry.hash ?? ''), encoder.encode(hash))) {
      const profile = state.oauthAgentProfiles?.[tokenEntry.agent] ?? {}
      return { name: tokenEntry.agent, agent: { allow: profile.allow ?? [], groups: profile.groups ?? [], allowAll: profile.allowAll === true, write: profile.write === true, oauth: true, account: tokenEntry.account ?? '', alias: profile.alias ?? '', note: profile.note ?? '' }, state }
    }
  }
  return null
}

function grantKey(agent, name) { return `${agent}\u0000${name}` }

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

async function listCiphers(env, db, session) {
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
        username: extractUsername(decrypted), totp: extractTotp(decrypted),
        group: state.itemGroups?.[name] ?? '',
        noApproval: state.policies[name]?.noApproval === true,
      })
    } catch {}
  }
  return items
}

async function readSecretFromRows(env, db, session, name) {
  const user = await vaultUser(env, db, session)
  const state = await loadState(env)
  let folderId = null
  if (state.settings?.vaultFolder) folderId = (await listFolders(env, db, session)).find((entry) => entry.name === state.settings.vaultFolder)?.id ?? null
  if (state.settings?.vaultFolder && !folderId) return null
  const rows = await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(user.id).all()
  for (const candidate of rows.results ?? []) {
    if (folderId && candidate.folder_id !== folderId) continue
    const decrypted = await decryptCipherRow(candidate, session)
    if (decrypted.name !== name) continue
    return { value: extractSecret(decrypted), username: extractUsername(decrypted), totp: extractTotp(decrypted), type: decrypted.type, url: cipherUrl(decrypted.data), id: candidate.id }
  }
  return null
}

async function findCipherRow(env, db, session, name) {
  const user = await vaultUser(env, db, session)
  const state = await loadState(env)
  let folderId = null
  if (state.settings?.vaultFolder) folderId = (await listFolders(env, db, session)).find((entry) => entry.name === state.settings.vaultFolder)?.id ?? null
  if (state.settings?.vaultFolder && !folderId) return null
  const rows = await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(user.id).all()
  for (const candidate of rows.results ?? []) {
    if (folderId && candidate.folder_id !== folderId) continue
    const decrypted = await decryptCipherRow(candidate, session)
    if (decrypted.name === name) return { row: candidate, decrypted }
  }
  return null
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

async function updateCipher(env, db, session, currentName, changes) {
  const found = await findCipherRow(env, db, session, currentName)
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
  if (typeof changes.totp === 'string') {
    if (!data || typeof data !== 'object') data = {}
    data.login = data.login && typeof data.login === 'object' ? data.login : {}
    data.login.totp = changes.totp ? await encryptStr(changes.totp, keys.itemEnc, keys.itemMac) : ''
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

async function deleteCipher(env, db, session, name) {
  const found = await findCipherRow(env, db, session, name)
  if (!found) return false
  await db.prepare('UPDATE ciphers SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(nowIso(), nowIso(), found.row.id).run()
  await updateState(env, (state) => {
    delete state.policies?.[name]
    delete state.itemGroups?.[name]
    for (const key of Object.keys(state.grants ?? {})) if (state.grants[key].name === name) delete state.grants[key]
    for (const [id, entry] of Object.entries(state.pending ?? {})) if (entry.name === name) delete state.pending[id]
    return state
  })
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

function publicState(state) {
  const agents = Object.entries(state.agents).map(([name, agent]) => ({ name, alias: agent.alias ?? '', note: agent.note ?? '', allow: agent.allow ?? [], groups: agent.groups ?? [], allowAll: agent.allowAll === true, write: agent.write === true, account: agent.account ?? '', oauth: false, createdAt: agent.createdAt ?? '', expiresAt: typeof agent.expiresAt === 'number' ? agent.expiresAt : null }))
  const seen = new Set(agents.map((agent) => agent.name))
  const now = Date.now()
  for (const token of Object.values(state.oauthTokens ?? {})) {
    if (!token.agent || seen.has(token.agent)) continue
    if (token.expiresAt && token.expiresAt <= now) continue
    seen.add(token.agent)
    const profile = state.oauthAgentProfiles?.[token.agent] ?? {}
    agents.push({ name: token.agent, alias: profile.alias ?? '', note: profile.note ?? '', allow: profile.allow ?? [], groups: profile.groups ?? [], allowAll: profile.allowAll === true, write: profile.write === true, account: token.account ?? '', oauth: true, createdAt: token.createdAt ?? '', expiresAt: typeof token.expiresAt === 'number' ? token.expiresAt : null })
  }
  return {
    agents,
    policies: state.policies ?? {},
    itemGroups: state.itemGroups ?? {},
    profile: state.profile ?? {},
    grants: Object.values(state.grants ?? {}),
    pending: Object.values(state.pending ?? {}),
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
  }
}

// Approval durations for temporary capabilities. 'always' maps to a
// permanent capability (expiresAt null); the legacy grant mirror keeps its
// old expiresAt: 0 convention for backward compatibility.
const APPROVAL_DURATIONS = { once: 0, '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, always: null }
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
    // Legacy entries created before action binding have no action (and often
    // no account/itemId). Approving one would mint a capability whose action
    // is a guess, so refuse and require a fresh request.
    if (!SECRET_ACTIONS.has(String(entry.action ?? ''))) {
      outcome = { agent: entry.agent, name: entry.name, denied: true, error: 'legacy-pending-without-action' }
      return state
    }
    const mode = ['once', '1h', '24h', '7d', 'always'].includes(decision) ? decision : 'once'
    const expiresAt = mode === '1h' ? Date.now() + 3600e3 : mode === '24h' ? Date.now() + 86400e3 : mode === '7d' ? Date.now() + 7 * 86400e3 : 0
    state.grants[grantKey(entry.agent, entry.name)] = { agent: entry.agent, name: entry.name, mode, createdAt: nowIso(), expiresAt, reads: 0, maxReads: mode === 'once' ? 1 : null, revokedAt: null, account: entry.account ?? '' }
    // Temporary capability bound to the pending entry's action. Approving
    // secret.use never mints secret.read and vice versa.
    const entryAction = entry.action === 'secret.use' ? 'secret.use' : 'secret.read'
    const itemId = entry.itemId || state.itemIds?.[entry.name] || ''
    // A capability must never be issued without a concrete account: the consume
    // gate treats a blank accountId as "no account restriction". Refuse instead
    // of minting an account-agnostic grant.
    const entryAccount = typeof entry.account === 'string' ? entry.account.trim() : ''
    if (!isWellFormedAccountId(entryAccount)) {
      outcome = { agent: entry.agent, name: entry.name, mode, action: entryAction, error: 'account-missing' }
      return state
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

async function notifyPending(env, origin, entry, ctx) {
  const state = await loadState(env)
  const notifications = state.settings?.notifications ?? {}
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
    const kind = r.oauth ? 'OAuth' : 'Token'
    if (r.kind === 'expired') return '- ' + r.agent + ' (' + kind + ')：授权已过期'
    if (r.kind === 'expiring') return '- ' + r.agent + ' (' + kind + ')：' + r.message + '，剩余 ' + r.daysLeft + ' 天'
    return '- ' + r.agent + ' (' + kind + ')：' + r.message
  })
  return { title: tpl.title, text: renderTemplate(tpl.body, { lines: lines.join('\n'), origin }) }
}

// Send once per (agent, kind, threshold) so a 5-day reminder does not repeat on
// every page load. State lives under state.reminderSent.
async function dispatchReminderBatch(env, state, origin, ctx, now = Date.now()) {
  const reminders = buildReminders(state, now)
  if (!reminders.length) return { sent: 0, reminders: 0 }
  const sentMap = state.reminderSent ?? {}
  const TTL = 20 * 3600e3
  const fresh = reminders.filter((r) => {
    const key = r.agent + '\u0000' + r.kind + '\u0000' + (r.kind === 'expiring' ? r.daysLeft : 'idle')
    const last = sentMap[key]
    return !(typeof last === 'number' && now - last < TTL)
  })
  if (!fresh.length) return { sent: 0, reminders: reminders.length }
  const notifications = state.settings?.notifications ?? {}
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
    path: ['reminderSent', r.agent + '\u0000' + r.kind + '\u0000' + (r.kind === 'expiring' ? r.daysLeft : 'idle')],
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
function normalizeOrigin(value) {
  let url
  try { url = new URL(String(value)) } catch { return null }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return null
  const port = url.port ? String(url.port) : '443'
  return { origin: 'https://' + host + (port === '443' ? '' : ':' + port), host, port }
}

function credentialKind(state, itemId) {
  return state.credentialKinds?.[itemId] ?? null
}

// A policy is applicable only when the item is classified as a web
// credential and the request origin is listed verbatim. Any ambiguity (more
// than one policy claiming the item, or an item with no policy) is not
// auto-approved: the caller turns it into a pending request.
function fillPolicyFor(state, itemId, origin) {
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
  return { ok: true, policy, origin, actions, kind }
}
// Plaintext read guard. A credential classified as 'web' is a website login:
// its value must never travel back to an Agent, it may only be filled into a
// page by the execution layer. An 'api' credential may still be read, but only
// when the admin enabled that explicitly for the item.
function plaintextReadAllowed(state, itemId) {
  const kind = credentialKind(state, itemId)
  if (kind === 'web') return { ok: false, reason: 'web-credential-is-fill-only' }
  if (kind === 'api') {
    const policy = state.plaintextReadPolicies?.[itemId] ?? null
    if (!policy) return { ok: false, reason: 'no-plaintext-read-policy' }
    if (policy.accountId && policy.accountId && state.settings?.vaultEmail &&
        String(policy.accountId).toLowerCase() !== String(state.settings?.vaultEmail).toLowerCase()) {
      return { ok: false, reason: 'account-mismatch' }
    }
    if (policy.expiresAt && policy.expiresAt < Date.now()) return { ok: false, reason: 'policy-expired' }
    return { ok: true, policy }
  }
  // An unclassified credential keeps the previous behaviour: the existing
  // capability and approval flow already decides. Classification only adds
  // the stricter rules for the items the admin has labelled.
  return { ok: true }
}
// How long a fill authorization stays valid. Kept short on purpose: the
// execution layer redeems it immediately.
function fillAuthTtlMs(env) {
  const configured = Number(env.FILL_AUTH_TTL_MS ?? 0)
  if (Number.isFinite(configured) && configured > 0) return Math.min(15 * 60 * 1000, configured)
  return 10 * 60 * 1000
}
// ── Fill authorization ledger ─────────────────────────────────────────────
// Stored under its own top-level key so the main state shape is untouched.
// The DO transaction is the only place an authorization can be redeemed, so a
// replayed nonce or a concurrent second request cannot both succeed.
async function issueFillAuthorization(env, { nonce, agent, itemId, itemName, accountId, origin, action, ttlMs }) {
  const now = Date.now()
  const expiresAt = now + ttlMs
  const record = { nonce, agent, itemId, itemName: itemName ?? '', accountId, origin, action, issuedAt: now, expiresAt, consumedAt: 0 }
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
const SECRET_ACTIONS = new Set(['secret.read', 'secret.use', 'secret.fill'])

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
  if (!policy) return null
  if (policy.accountId && accountId && String(policy.accountId).toLowerCase() !== String(accountId).toLowerCase()) return null
  return policy
}

function targetAllowed(policy, target) {
  if (!policy || !target) return false
  const host = String(target.host ?? '').toLowerCase().replace(/\.$/, '')
  const port = String(target.port ?? '443')
  const method = String(target.method ?? 'GET').toUpperCase()
  const pathname = String(target.pathname ?? '/')
  const hosts = (policy.hosts ?? []).map((v) => String(v).toLowerCase().replace(/\.$/, ''))
  if (!hosts.includes(host)) return false
  if (!(policy.methods ?? []).map((v) => String(v).toUpperCase()).includes(method)) return false
  if ((policy.ports ?? ['443']).map(String).includes(port) === false) return false
  const prefixes = policy.pathPrefixes ?? []
  if (prefixes.length > 0 && !prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'))) return false
  return true
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
      else { ok = true; reason = 'capability' }
    }
    else {
      const policy = usePolicyFor(state, itemId, accountId)
      if (!policy) { ok = false; reason = 'no-use-policy' }
      else if (!targetAllowed(policy, target)) { ok = false; reason = 'target-denied' }
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
  const capabilityDecisive = Boolean(cap) && (reason !== 'capability')
  if (capabilityDecisive) { ok = false; if (!reason || reason === 'no-capability') reason = capabilityStatus(cap) }
  // Capability-eligible but not yet issued (actionGrant without approval
  // state): the approval gate in agentAccess must see this as pending, not
  // as a hard deny — EXCEPT target-policy violations, which stay hard denies
  // so mis-scoped use can never be approved into existence.
  const grant = actionGrantFor(state, subjectId, itemId)
  let grantEligible = Boolean(grant && (grant.actions ?? []).includes(action)
    && (!grant.accountId || !accountId || String(grant.accountId).toLowerCase() === String(accountId).toLowerCase()))
  if (grantEligible && action === 'secret.use') {
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
  return { ok, reason, legacy: legacyDecision, grant: null, capability: cap, capabilityKey: key, grantEligible, capabilityDecisive }
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
  return found?.row?.id ?? ''
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
  if (!decision.ok) {
    if (decision.reason === 'no-use-policy' || decision.reason === 'target-denied') return { status: 'forbidden', error: `secret.use denied: ${decision.reason}` }
    // A capability that exists but is expired/revoked/exhausted/cross-account
    // is decisive. Never fall through to approval, legacy grants or legacy
    // scope — that would resurrect access the operator already withdrew.
    if (decision.capabilityDecisive) return { status: 'forbidden', error: `capability ${decision.reason}: access denied` }
    // Not capability-eligible at all -> hard deny. Eligible-but-unapproved
    // falls through to the approval gate below (pending), never a bypass.
    if (!decision.grantEligible && !decision.legacy) return { status: 'forbidden', error: 'agent not allowed to read this item' }
  }
  const policy = state.policies?.[name]
  // Approval gate.
  //   secret.read: a noApproval item or a live legacy grant may satisfy it.
  //   secret.use : NEVER satisfied by a legacy read grant or by noApproval;
  //                it needs an explicit use capability (which only an
  //                approval or an admin pre-grant mints).
  const legacyGrant = action === 'secret.read' ? activeGrant(state, agentName, name) : null
  const noApprovalSatisfies = action === 'secret.read' && policy?.noApproval === true
  if (!noApprovalSatisfies && !decision.capability && !legacyGrant) {
    let pendingId = findPending(state, agentName, name, action)
    if (!pendingId) {
      pendingId = crypto.randomUUID()
      // The pending request records the target origin so the approver can see
      // which site the credential would be filled into. A fill request without
      // an origin is never approvable.
      const entry = { id: pendingId, agent: agentName, name, account: session.email, action, createdAt: nowIso(), targetOrigin: action === 'secret.fill' ? String(target?.origin ?? '') : '' }
      await updateState(env, (next) => { next.pending[pendingId] = entry; if (itemId) { next.itemIds ??= {}; next.itemIds[name] = itemId } return next })
      await addAudit(env, { event: 'request.create', agent: agentName, name })
      await notifyPending(env, origin, entry, ctx)
    }
    return { status: 'pending', requestId: pendingId, approvalUrl: `${origin}/#/grants`, itemId, targetOrigin: String(target?.origin ?? '') }
  }
  // Unified atomic consume: capability is the sole counter. Checks passed
  // above; consume now, before decrypt/fetch, inside the DO transaction.
  // Failed upstream calls still count (no infinite failure-retry bypass).
  // Whenever a capability exists it is the sole counter — including for
  // legacy agents. The legacy path never skips consumption.
  if (consumeRead && decision.capability) {
    // Resolve a lazily-migrated (not yet persisted) capability through the DO
    // first, so the record and its counter exist before the consume step.
    if (decision.capability.__pendingMigration) {
      const ensured = await ensureCapability(env, { subjectId: agentName, itemId, action, accountId: session.email, legacyName: name })
      if (!ensured?.ok) return { status: 'forbidden', error: `capability migration rejected: ${ensured?.reason ?? 'unknown'}` }
    }
    const consumed = await consumeCapability(env, decision.capabilityKey, session.email, action)
    if (!consumed?.ok) return { status: 'forbidden', error: `capability no longer valid: ${consumed?.reason ?? 'unknown'}` }
  } else if (legacyGrant && consumeRead) {
    const consumed = await consumeGrant(env, agentName, name)
    if (!consumed?.ok) return { status: 'forbidden', error: 'grant is no longer valid' }
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
  const result = await readSecretFromRows(env, env.NODEWARDEN_DB, session, name)
  if (!result) return { status: 'notfound', error: 'not found' }
  await addAudit(env, { event: 'secret.read', agent: agentName, name, mode: policy?.noApproval ? 'no-approval' : 'grant', via: 'agent', legacy: decision.legacy === true })
  return { status: 'ok', value: result.value, url: result.url }
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

function oauthConsentPage(origin, params, client) {
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const field = (name) => '<input type="hidden" name="' + name + '" value="' + escape(params.get(name)) + '">'
  return '<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP 授权</title><style>body{font:14px/1.6 system-ui;background:#f3f6fb;margin:0;padding:40px;color:#152033}.card{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e9f2;border-radius:16px;padding:24px}button{border:0;border-radius:9px;padding:10px 16px;font:inherit;cursor:pointer;margin-right:8px}.primary{background:#0f9d8a;color:#fff}.muted{color:#6b7890;font-size:12px}code{background:#eef1f6;padding:2px 5px;border-radius:5px}</style><div class="card"><h2>Secrets Broker · MCP 授权</h2><p>客户端 <code>' + escape(client?.clientName ?? params.get('client_id')) + '</code> 请求访问你的密钥库。</p><p class="muted">Scope: ' + escape(params.get('scope') ?? 'secrets.read') + '</p><form method="post" action="/oauth/authorize">' + field('client_id') + field('redirect_uri') + field('state') + field('code_challenge') + field('code_challenge_method') + field('scope') + '<button class="primary" name="decision" value="allow">允许</button><button name="decision" value="deny">拒绝</button></form></div></html>'
}

function standaloneLoginPage(next) {
  const target = next.startsWith('/') ? next : '/'
  return String.raw`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><title>登录 · Secrets Broker</title><style>body{font:14px/1.6 system-ui;background:#f3f6fb;color:#152033;margin:0;padding:40px 16px}.card{max-width:420px;margin:0 auto;background:#fff;border:1px solid #e3e9f2;border-radius:16px;padding:24px}h1{font-size:20px;margin:0 0 4px}.hint{color:#6b7890;font-size:12px;margin-bottom:18px}label{display:block;font-size:12px;color:#6b7890;margin:12px 0 4px}input{width:100%;box-sizing:border-box;border:1px solid #d8e0ec;border-radius:9px;padding:10px;font:inherit}button{width:100%;margin-top:16px;border:0;border-radius:9px;padding:10px;font:inherit;background:#0f9d8a;color:#fff;cursor:pointer}.status{font-size:12px;min-height:18px;margin-top:8px;color:#c0392b}.oidc{display:block;text-align:center;margin-top:12px;font-size:12px;color:#0f9d8a}</style></head><body><div class="card"><h1>Secrets Broker</h1><div class="hint">管理登录（不是 Bitwarden 主密码）</div><label>管理密码</label><input id="password" type="password" autocomplete="current-password"><div id="totp" style="display:none"><label>两步验证码</label><input id="code" inputmode="numeric" placeholder="6 位验证码"></div><button id="go">登录</button><div id="status" class="status"></div><a class="oidc" href="/oidc/login?next=${encodeURIComponent(target)}">使用 OIDC 登录</a></div><script>const next=${JSON.stringify(target)};const go=document.getElementById('go');async function submit(){const status=document.getElementById('status');status.textContent='';try{const response=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value,code:document.getElementById('code').value})});const data=await response.json();if(!response.ok){if(data.totpRequired){document.getElementById('totp').style.display='block';status.textContent=data.error||'请输入验证码'}else status.textContent=data.error||'登录失败';return}location.href=next}catch(error){status.textContent=String(error.message||error)}}go.onclick=submit;document.getElementById('code').addEventListener('keydown',e=>{if(e.key==='Enter')submit()})</script></body></html>`
}

function connectPage(request) {
  const item = request
  return String.raw`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><title>连接密钥 · Secrets Broker</title><style>body{font:14px/1.6 system-ui;background:#f3f6fb;color:#152033;margin:0;padding:40px 16px}.card{max-width:520px;margin:0 auto;background:#fff;border:1px solid #e3e9f2;border-radius:16px;padding:24px}h1{font-size:20px;margin:0 0 4px}.hint{color:#6b7890;font-size:12px;margin-bottom:14px}.agent{background:#eef6f4;border:1px solid #cfe8e2;border-radius:10px;padding:10px;font-size:12px;margin-bottom:12px}label{display:block;font-size:12px;color:#6b7890;margin:12px 0 4px}input{width:100%;box-sizing:border-box;border:1px solid #d8e0ec;border-radius:9px;padding:10px;font:inherit}button{width:100%;margin-top:16px;border:0;border-radius:9px;padding:10px;font:inherit;background:#0f9d8a;color:#fff;cursor:pointer}.status{font-size:12px;min-height:18px;margin-top:8px;color:#c0392b}</style></head><body><div class="card"><h1>连接密钥</h1><div class="hint">这个密钥会保存到当前解锁的 vault，并授权给请求的 Agent。</div><div class="agent"><b>${escapeHtml(item.agent || 'Agent')}</b> 需要：<code>${escapeHtml(item.name || '')}</code>${item.description ? '<br><span class="hint">' + escapeHtml(item.description) + '</span>' : ''}</div><label>名称</label><input id="name" value="${escapeHtml(item.name || '')}"><label>用户名（可选）</label><input id="username" placeholder="登录用户名"><label>密钥值</label><input id="value" type="password" autocomplete="off" placeholder="粘贴 API key / 密码"><label>分组（可选）</label><input id="group" placeholder="例如 api/prod"><button id="save">保存并授权</button><div id="status" class="status"></div></div><script>const id=${JSON.stringify(item.id)};document.getElementById('save').onclick=async()=>{const status=document.getElementById('status');const value=document.getElementById('value').value;if(!value){status.textContent='请填写密钥值';return}status.textContent='保存中…';try{const response=await fetch('/api/connect/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,name:document.getElementById('name').value,username:document.getElementById('username').value,value,group:document.getElementById('group').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'保存失败');status.style.color='#0f9d8a';status.textContent='已保存并授权，可以关闭此页面';setTimeout(()=>location.href='/',1200)}catch(error){status.style.color='#c0392b';status.textContent=String(error.message||error)}}</script></body></html>`
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


    if (url.pathname === '/login' && request.method === 'GET') {
      const nextTarget = String(url.searchParams.get('next') ?? '/')
      // Already signed in: honour the return target instead of always going home.
      if (await adminAuthorized(request, env)) return Response.redirect(new URL(nextTarget, url).toString(), 302)
      return htmlResponse(standaloneLoginPage(nextTarget))
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
      const name = String(body.name ?? item.name).trim()
      if (!name || !body.value) return fail('name and value required', 400)
      try {
        await createCipher(env, env.NODEWARDEN_DB, session, { name, username: String(body.username ?? ''), value: String(body.value), url: '', notes: item.description ?? '', group: String(body.group ?? '') }, state.settings?.vaultFolder ?? '')
        await updateState(env, (next) => {
          delete next.credentialRequests[String(body.id)]
          next.grants[grantKey(item.agent, name)] = { agent: item.agent, name, mode: 'credential-request', createdAt: nowIso(), expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: session.email }
          next.itemGroups ??= {}
          if (String(body.group ?? '').trim()) next.itemGroups[name] = String(body.group).trim()
          return next
        })
        await addAudit(env, { event: 'credential.connect', agent: item.agent, name, via: 'connect-page' })
        return json({ ok: true, name })
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
      return json({ pending: Object.values(state.pending ?? {}).map((entry) => ({ id: entry.id, agent: entry.agent, name: entry.name, createdAt: entry.createdAt })), count: Object.keys(state.pending ?? {}).length })
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
      const name = String(body.name ?? item.name).trim()
      if (!name || !body.value) return fail('name and value required', 400)
      try {
        await createCipher(env, env.NODEWARDEN_DB, session, { name, username: String(body.username ?? ''), value: String(body.value), url: '', notes: item.description ?? '', group: String(body.group ?? '') }, state.settings?.vaultFolder ?? '')
        await updateState(env, (next) => {
          delete next.credentialRequests[String(body.id)]
          next.grants[grantKey(item.agent, name)] = { agent: item.agent, name, mode: 'credential-request', createdAt: nowIso(), expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: session.email }
          return next
        })
        await addAudit(env, { event: 'credential.connect', agent: item.agent, name, via: 'dsh-plugin' })
        return json({ ok: true, name })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/api/plugin/credential-requests' && request.method === 'GET') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const state = await loadState(env)
      return json({ requests: Object.values(state.credentialRequests ?? {}).map((entry) => ({ id: entry.id, agent: entry.agent, name: entry.name, description: entry.description ?? '', createdAt: entry.createdAt })) })
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
      const cookie = await createAdminCookie(env, request)
      await addAudit(env, { event: 'admin.login', ip })
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
        return json({ profile: state.profile ?? {}, oidcEnabled: Boolean(oidc), oidcIssuer: oidc?.issuer ?? '', oidcLoginUrl: oidc ? '/oidc/login' : '' })
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
    if (url.pathname === '/api/oidc/status') {
      const state = await loadState(env)
      const oidc = await oidcConfig(env, request, state)
      return json({ enabled: Boolean(oidc), issuer: oidc?.issuer ?? '' })
    }
    if (url.pathname === '/oidc/login') {
      const state = await loadState(env)
      const oidc = await oidcConfig(env, request, state)
      if (!oidc) return fail('OIDC is not configured (OIDC_ISSUER / OIDC_CLIENT_ID)', 503)
      try {
        const endpoints = await oidcEndpoints(oidc)
        if (!endpoints.authorization) return fail('OIDC authorization endpoint missing', 502)
        const state = randomToken()
        const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
        const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))))
        const nonce = randomToken()
        const next = url.searchParams.get('next') === 'profile' ? 'profile' : ''
        const cookie = await oidcStateCookie(env, state, verifier, next, nonce)
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
        return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': `oidc_state=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } })
      } catch (error) { return fail(String(error.message ?? error), 502) }
    }
    if (url.pathname === '/oidc/callback') {
      const clearOidcCookie = 'oidc_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
      const failOidc = (message, status = 400) => json({ error: message }, status, { 'set-cookie': clearOidcCookie })
      const oidc = await oidcConfig(env, request, await loadState(env))
      if (!oidc) return fail('OIDC is not configured', 503)
      const returned = url.searchParams.get('state') ?? ''
      const consumed = await consumeOidcState(env, readCookie(request, 'oidc_state'), returned)
      if (!consumed?.ok) {
        const reason = String(consumed?.reason ?? 'invalid')
        if (reason === 'replay') return failOidc('OIDC state already used (replay)', 400)
        if (reason === 'expired') return failOidc('OIDC state expired', 400)
        return new Response('<meta charset="utf-8"><h2>OIDC 状态校验失败</h2><p>这个链接是回调地址，不能直接打开；请从「个人资料 → 使用 OIDC 登录 / 绑定」重新发起。</p><p><a href="/?view=profile">回到个人资料</a></p>', { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': clearOidcCookie } })
      }
      const stateData = { state: consumed.state, verifier: consumed.verifier, nonce: consumed.nonce, next: consumed.next }
      const state = await loadState(env)
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
        const boundIssuer = String(state.profile?.oidcIssuer ?? '')
        if (boundIssuer && boundIssuer !== oidc.issuer) return failOidc('OIDC issuer 与已绑定身份不一致', 403)
        const boundSub = String(state.profile?.oidcSub ?? '')
        if (boundSub && claims.sub !== boundSub) return failOidc('OIDC 身份与已绑定账户不一致', 403)
        if (!boundSub && !isAdmin) {
          const allowedSub = String(env.OIDC_ALLOWED_SUB ?? '')
          const allowedEmail = String(env.OIDC_ALLOWED_EMAIL ?? '')
          if (!allowedSub && !allowedEmail) return failOidc('首次 OIDC 登录需要管理员先登录绑定，或配置 OIDC_ALLOWED_SUB / OIDC_ALLOWED_EMAIL', 403)
          if (allowedSub && claims.sub !== allowedSub) return failOidc('OIDC 身份不在允许列表', 403)
          if (allowedEmail && String(user.email ?? '').toLowerCase() !== allowedEmail.toLowerCase()) return failOidc('OIDC 邮箱不在允许列表', 403)
        }
        await updateState(env, (next) => {
          next.profile ??= {}
          next.profile.oidcIssuer = oidc.issuer
          next.profile.oidcSub = claims.sub
          next.profile.oidcEmail = String(user.email ?? next.profile.email ?? '')
          next.profile.name = String(user.name ?? user.preferred_username ?? next.profile.name ?? '')
          next.profile.email = String(user.email ?? next.profile.email ?? '')
          next.profile.avatarUrl = String(user.picture ?? next.profile.avatarUrl ?? '')
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
        return json({ ok: true, name: nextName })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/api/items/delete' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '')
      try {
        const deleted = await deleteCipher(env, env.NODEWARDEN_DB, session, name)
        if (!deleted) return fail('item not found', 404)
        return json({ ok: true })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/api/items/create' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      try { return json({ ok: true, ...(await createCipher(env, env.NODEWARDEN_DB, session, body)) }) } catch (error) { return fail(String(error.message ?? error), 400) }
    }
    if (url.pathname === '/api/items/import' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      const body = await request.json().catch(() => ({}))
      const entries = Array.isArray(body) ? body : Array.isArray(body.items) ? body.items : []
      const created = []
      const skipped = []
      for (const entry of entries) {
        try { created.push((await createCipher(env, env.NODEWARDEN_DB, session, entry)).name) } catch (error) { skipped.push({ name: entry?.name, error: String(error.message ?? error) }) }
      }
      return json({ ok: true, created, skipped })
    }
    if (url.pathname === '/api/items/export') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      try {
        const user = await vaultUser(env, env.NODEWARDEN_DB, session)
        const rows = await env.NODEWARDEN_DB.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(user.id).all()
        const state = await loadState(env)
        const items = []
        for (const row of rows.results ?? []) {
          const decrypted = await decryptCipherRow(row, session)
          items.push({ name: decrypted.name, url: cipherUrl(decrypted.data), notes: decrypted.notes, value: extractSecret(decrypted), group: state.itemGroups?.[decrypted.name] ?? '', noApproval: state.policies?.[decrypted.name]?.noApproval === true })
        }
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
      const state = await updateState(env, (next) => {
        next.policies ??= {}
        if (body.noApproval === true) next.policies[name] = { noApproval: true }
        else delete next.policies[name]
        return next
      })
      await addAudit(env, { event: 'policy.update', name, noApproval: body.noApproval === true })
      return json({ ok: true, state: publicState(state) })
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
    // Admin: classify a credential and configure its fill policy. The kind is an
    // explicit admin decision; the NodeWarden item type is never consulted.
    // The only endpoint that hands a plaintext value to a caller. It requires
    // the execution layer's own token, which is never given to an Agent, and a
    // one-shot authorization bound to this exact item, account and origin.
    if (url.pathname === '/api/fill/execute' && request.method === 'POST') {
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
      await updateState(env, (state) => {
        state.credentialKinds ??= {}
        state.credentialKinds[itemId] = kind
        if (kind === 'web') {
          state.fillPolicies ??= {}
          state.fillPolicies[itemId] = {
            itemId, accountId: session.email, origins, actions,
            autoApprove: body.autoApprove === true, updatedAt: nowIso(),
          }
        } else {
          // An api credential has no fill policy: it is not a website login.
          delete state.fillPolicies?.[itemId]
        }
        return state
      })
      await addAudit(env, { event: 'fill-policy.update', name: itemName, itemId, kind, origins, actions })
      return json({ ok: true, itemId, kind, origins, actions })
    }
    if (url.pathname === '/api/fill/policies' && request.method === 'GET') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const state = await loadState(env)
      const kinds = state.credentialKinds ?? {}
      const policies = state.fillPolicies ?? {}
      const items = Object.entries(kinds).map(([itemId, kind]) => ({
        itemId, kind, origins: policies[itemId]?.origins ?? [], actions: policies[itemId]?.actions ?? [],
        autoApprove: policies[itemId]?.autoApprove === true, accountId: policies[itemId]?.accountId ?? '',
      }))
      return json({ items, executionLayer: Boolean(String(env.FILL_EXECUTION_TOKEN ?? '')) })
    }
    // Admin: allow or revoke plaintext reads for an api credential.
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
      const itemId = String(body.itemId ?? '')
      const agentName = String(body.agent ?? '')
      if (!itemId || !agentName) return fail('itemId and agent required', 400)
      // Only revoke grants that belong to the currently unlocked vault account.
      // Soft-revoke: capabilities keep revokedAt/revokedBy for status display;
      // the consume gate rejects them. Optional body.action limits to one action.
      const loaded = await loadState(env)
      const existing = loaded.actionGrants?.[actionGrantKey(agentName, itemId)]
      if (!existing) return fail('grant not found', 404)
      if (existing.accountId && String(existing.accountId).toLowerCase() !== String(session.email).toLowerCase()) return fail('grant belongs to another account', 403)
      const onlyAction = String(body.action ?? '')
      if (onlyAction && !SECRET_ACTIONS.has(onlyAction)) return fail('unknown action', 400)
      const revokedActions = onlyAction ? [onlyAction] : (existing.actions ?? [])
      await updateState(env, (state) => {
        const now = new Date().toISOString()
        for (const action of revokedActions) {
          const ckey = capabilityKey(agentName, itemId, action)
          const cap = state.capabilities?.[ckey]
          if (cap) { cap.revokedAt = now; cap.revokedBy = 'admin:' + session.email }
        }
        if (!onlyAction && state.actionGrants?.[actionGrantKey(agentName, itemId)]) delete state.actionGrants[actionGrantKey(agentName, itemId)]
        else if (onlyAction && state.actionGrants?.[actionGrantKey(agentName, itemId)]) {
          const rest = (state.actionGrants[actionGrantKey(agentName, itemId)].actions ?? []).filter((a) => a !== onlyAction)
          if (rest.length) state.actionGrants[actionGrantKey(agentName, itemId)].actions = rest
          else delete state.actionGrants[actionGrantKey(agentName, itemId)]
        }
        return state
      })
      await addAudit(env, { event: 'action-grant.revoke', agent: agentName, itemId, actions: revokedActions })
      return json({ ok: true, revoked: revokedActions })
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
      return json({ ...publicState(state), reminders, pendingCount: Object.keys(state.pending ?? {}).length })
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
      const token = randomToken()
      const hash = await sha256Base64(token)
      const tokenWrapped = await wrapWithKek(encoder.encode(token), await kekBytes(env))
      let found = false
      await updateState(env, (state) => { if (state.agents[name]) { state.agents[name].hash = hash; state.agents[name].tokenWrapped = tokenWrapped; found = true } return state })
      if (!found) return fail('agent not found', 404)
      await addAudit(env, { event: 'agent.rotate', agent: name })
      return json({ ok: true, name, token })
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
          const shareItemId = state.itemIds?.[item] ?? ''
          await updateState(env, (next) => {
            next.grants[grantKey(agentName, item)] = { agent: agentName, name: item, mode: 'share', createdAt: nowIso(), expiresAt: shareExpiresAt ?? 0, reads: 0, maxReads: shareMaxUses, revokedAt: null, noApproval: true, account: session.email }
            if (shareItemId) {
              next.capabilities ??= {}
              const ckey = capabilityKey(agentName, shareItemId, 'secret.read')
              next.capabilities[ckey] = { id: ckey, subjectId: agentName, accountId: session.email, itemId: shareItemId, itemName: item, action: 'secret.read', mode: 'preapproved', createdAt: nowIso(), createdBy: 'admin:' + session.email, expiresAt: shareExpiresAt, maxUses: shareMaxUses, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
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
        const oneItemId = state.itemIds?.[name] ?? ''
        await updateState(env, (next) => {
          next.grants[grantKey(agentName, name)] = { agent: agentName, name, mode: 'share', createdAt: nowIso(), expiresAt: oneExpiresAt ?? 0, reads: 0, maxReads, revokedAt: null, noApproval: true, account: session.email }
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
      const key = grantKey(String(body.agent ?? ''), String(body.name ?? ''))
      let found = false
      await updateState(env, (state) => {
        const grant = state.grants[key]
        if (!grant) return state
        found = true
        grant.revokedAt = null
        if (grant.expiresAt && grant.expiresAt <= Date.now()) grant.expiresAt = 0
        grant.reads = 0
        return state
      })
      if (!found) return fail('grant not found', 404)
      await addAudit(env, { event: 'grant.restore', agent: body.agent, name: body.name, source: 'web' })
      return json({ ok: true })
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
      return json({ entries: state.audit ?? [] })
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
    if (url.pathname === '/api/settings') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      if (request.method === 'GET') {
        const state = await loadState(env)
        const n = state.settings?.notifications ?? {}
        const effectiveOidc = await oidcConfig(env, request, state)
        return json({ notifications: {
          telegram: { chatId: n.telegram?.chatId ?? '', configured: Boolean(n.telegram?.botToken && n.telegram?.chatId) },
          ntfy: { url: n.ntfy?.url ?? '', topic: n.ntfy?.topic ?? '', configured: Boolean(n.ntfy?.url && n.ntfy?.topic) },
          gotify: { url: n.gotify?.url ?? '', configured: Boolean(n.gotify?.url && n.gotify?.token) },
          wxpush: { url: n.wxpush?.url ?? '', format: n.wxpush?.format ?? 'form', configured: Boolean(n.wxpush?.url && n.wxpush?.token) },
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
        }, vaultFolder: state.settings?.vaultFolder ?? '', vaultEmail: state.settings?.vaultEmail ?? '', siteName: state.settings?.siteName ?? 'Secrets Broker' })
      }
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const previousEmail = (await loadState(env)).settings?.vaultEmail ?? ''
        const incoming = body.notifications ?? {}
        await updateState(env, (state) => {
          state.settings ??= { notifications: {} }
          state.settings.notifications ??= {}
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
            await fetch(`https://api.telegram.org/bot${current.botToken}/setWebhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `${url.origin}/telegram/webhook`, secret_token: current.webhookSecret, allowed_updates: ['callback_query'] }) })
          } catch {}
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
          for (const [hash, token] of Object.entries(state.oauthTokens ?? {})) if (token.agent === body.agent) delete state.oauthTokens[hash]
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
        value: { clientId, clientName, redirectUris, createdAt: nowIso() },
      }])
      if (!written?.ok) return fail('could not persist client registration', 500)
      await addAudit(env, { event: 'oauth.client-register', clientId, clientName: body.client_name ?? '' })
      return json({ client_id: clientId, client_name: body.client_name ?? 'MCP client', redirect_uris: redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }, 201)
    }
    if (url.pathname === '/oauth/authorize') {
      const state = await loadState(env)
      const params = request.method === 'POST' ? new URLSearchParams(await request.text()) : url.searchParams
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
        await updateState(env, (next) => {
          next.oauthCodes[code] = { clientId, redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256', scope: String(params.get('scope') ?? 'secrets.read'), account, createdAt: nowIso(), expiresAt: Date.now() + 5 * 60 * 1000 }
          return next
        })
        await addAudit(env, { event: 'oauth.authorize', clientId, agent: 'oauth:' + clientId })
        const target = new URL(redirectUri); target.searchParams.set('code', code); if (params.get('state')) target.searchParams.set('state', params.get('state'))
        return Response.redirect(target.toString(), 302)
      }
      return htmlResponse(oauthConsentPage(url.origin, params, client))
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
      await updateState(env, (next) => {
        delete next.oauthCodes[code]
        next.oauthTokens[hash] = { hash, agent: agentName, clientId: entry.clientId, account, createdAt: nowIso(), expiresAt }
        next.oauthAgentProfiles ??= {}
        if (!next.oauthAgentProfiles[agentName]) {
          // The readable client name becomes the alias; the opaque client id
          // goes to the note so nobody has to retype a long identifier.
          next.oauthAgentProfiles[agentName] = { alias: next.oauthClients?.[entry.clientId]?.clientName ?? '', note: entry.clientId, allow: [], groups: [], allowAll: false, write: false, legacy: false }
        } else if (!next.oauthAgentProfiles[agentName].note) {
          next.oauthAgentProfiles[agentName].note = entry.clientId
        }
        return next
      })
      await addAudit(env, { event: 'oauth.token-issue', agent: agentName, clientId: entry.clientId })
      return json({ access_token: accessToken, token_type: 'Bearer', expires_in: 86400, scope: entry.scope })
    }
    if (url.pathname === '/mcp' && request.method === 'POST') {
      const resolved = await resolveAgent(request, env)
      if (!resolved) return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized' } }), { status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' } })
      const body = await request.json().catch(() => ({}))
      const rpcError = (message, code = -32601) => json({ jsonrpc: '2.0', id: body.id ?? null, error: { code, message } })
      const result = (value) => json({ jsonrpc: '2.0', id: body.id ?? null, result: value })
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
      if (body.method === 'ping') return result({})
      if (body.method === 'initialize') {
        return result({ protocolVersion: body.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'secrets-broker', version: '0.1.0' }, instructions: 'Use this server for every credential. Call list_secrets to discover items, get_secret for a value, get_credential for username/password/TOTP, http_request to call an API with the secret injected server-side, or request_credential to create a one-time link when the vault is missing a key. Never ask the user for passwords or API keys. If pending approval, present the approval URL and retry. Never print secret values in chat or logs.' })
      }
      if (body.method === 'tools/list') {
        return result({ tools: [
          { name: 'list_secrets', description: 'List secret item names available to this agent (no values).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
          { name: 'request_access', description: 'Request approval to read a secret by name. Returns an approval URL if pending.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' } }, required: ['name'] } },
          { name: 'get_secret', description: 'Read a secret value after approval. Disabled unless MCP_ALLOW_READ=1.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' } }, required: ['name'] } },
          { name: 'get_credential', description: 'Read username, password and TOTP for a login item after approval.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' } }, required: ['name'] } },
          { name: 'request_credential', description: 'Create a secure one-time link for a human to fill in a missing credential; the broker stores it and grants this agent access.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Suggested item name' }, description: { type: 'string', description: 'What the credential is for' } }, required: ['name'] } },
          { name: 'http_request', description: 'Make an HTTPS request with a secret injected server-side. Method allowlist (default GET/POST, extend via HTTP_ALLOW_METHODS; max 16 chars). Path prefix allowlist via HTTP_ALLOW_PATHS (empty = no path restriction). headerName allowlist: Authorization, X-Api-Key, Api-Key, X-Auth-Token (case-insensitive); authPrefix max 32 chars, no CR/LF. Custom headers sanitized (name /^[A-Za-z0-9-]+$/, value <=4KB, max 20; host/content-length/connection/cookie/set-cookie/authorization and other sensitive hops filtered). Body <=64KB as string; GET/HEAD must not send body. Only https, no userinfo, default port 443 or HTTP_ALLOWED_PORTS. The secret is never returned to the caller.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' }, url: { type: 'string', description: 'HTTPS target URL (no userinfo; path must match HTTP_ALLOW_PATHS prefixes when set; port 443 or HTTP_ALLOWED_PORTS)' }, method: { type: 'string', description: 'HTTP method, uppercased (default GET; non-GET/POST requires HTTP_ALLOW_METHODS; max 16 chars)' }, headers: { type: 'object', description: 'Extra headers (sanitized: name /^[A-Za-z0-9-]+$/, value <=4KB, max 20; sensitive/hop headers filtered and cannot override the injected secret header)' }, body: { type: 'string', description: 'Request body as string (<=64KB; GET/HEAD must not include body)' }, headerName: { type: 'string', description: 'Header to inject the secret into (allowlist: Authorization, X-Api-Key, Api-Key, X-Auth-Token; default Authorization)' }, authPrefix: { type: 'string', description: 'Prefix before the secret (default "Bearer ", max 32 chars, no CR/LF)' } }, required: ['name', 'url'] } },
        ] })
      }
      if (body.method === 'tools/call') {
        const name = body.params?.name
        const args = body.params?.arguments ?? {}
        const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) })
        const session = await getSession(env)
        if (!session) return result(text('vault locked; open the broker page or run unlock.mjs', true))
        try {
          if (name === 'list_secrets') {
            if (resolved.agent.account && String(resolved.agent.account).toLowerCase() !== String(session.email).toLowerCase()) return result(text('agent is bound to another vault account', true))
            const items = await listCiphers(env, env.NODEWARDEN_DB, session)
            const visible = items.filter((item) => resolved.agent.allowAll === true || (resolved.agent.allow ?? []).includes(item.name) || (resolved.agent.groups ?? []).includes(item.group))
            return result(text(visible.map((item) => ({ name: item.name, url: item.url, noApproval: item.noApproval }))))
          }
          if (name === 'request_access') {
            const secretName = String(args.name ?? '')
            if (!secretName) return result(text('name is required', true))
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx, consumeRead: false })
            if (access.status === 'pending') return result(text(`pending approval: ${access.approvalUrl}`))
            if (access.status === 'forbidden') return result(text(access.error, true))
            if (access.status === 'notfound') return result(text(access.error, true))
            return result(text('access already allowed; use get_secret'))
          }
          if (name === 'get_secret') {
            if (env.MCP_ALLOW_READ !== '1') return result(text('get_secret is disabled; set MCP_ALLOW_READ=1 to expose values', true))
            const secretName = String(args.name ?? '')
            if (!secretName) return result(text('name is required', true))
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx })
            if (access.status === 'pending') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: resolved.agent.oauth ? 'oauth' : 'token', action: 'secret.read', ok: false })
              return result(text(`pending approval: ${access.approvalUrl}`))
            }
            if (access.status === 'forbidden' || access.status === 'notfound') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: resolved.agent.oauth ? 'oauth' : 'token', action: 'secret.read', ok: false })
              return result(text(access.error, true))
            }
            // Plaintext only leaves the broker for an api credential the admin
            // explicitly allowed. Website logins and unclassified items are
            // refused: they are fill-only.
            const readGuard = plaintextReadAllowed(resolved.state, access.itemId ?? '')
            if (!readGuard.ok) {
              await addAudit(env, { event: 'secret.read-deny', agent: resolved.name, name: secretName, reason: readGuard.reason })
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: resolved.agent.oauth ? 'oauth' : 'token', action: 'secret.read', ok: false })
              return result(text('plaintext read is not allowed for this credential: ' + readGuard.reason, true))
            }
            await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: resolved.agent.oauth ? 'oauth' : 'token', action: 'secret.read', ok: true })
            return result(text(access.value))
          }
          if (name === 'get_credential') {
            if (env.MCP_ALLOW_READ !== '1') return result(text('get_credential is disabled; set MCP_ALLOW_READ=1', true))
            const secretName = String(args.name ?? '')
            if (!secretName) return result(text('name is required', true))
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx })
            const credKind = resolved.agent.oauth ? 'oauth' : 'token'
            if (access.status === 'pending') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: credKind, action: 'secret.read', ok: false })
              return result(text(`pending approval: ${access.approvalUrl}`))
            }
            if (access.status === 'forbidden' || access.status === 'notfound') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: credKind, action: 'secret.read', ok: false })
              return result(text(access.error, true))
            }
            // A website login is fill-only: its username/password/totp must never
            // reach the Agent. An api key needs an explicit read policy.
            const readGuard = plaintextReadAllowed(resolved.state, access.itemId ?? '')
            if (!readGuard.ok) {
              await addAudit(env, { event: 'secret.read-deny', agent: resolved.name, name: secretName, reason: readGuard.reason })
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: credKind, action: 'secret.read', ok: false })
              return result(text('plaintext read is not allowed for this credential: ' + readGuard.reason, true))
            }
            const found = await readSecretFromRows(env, env.NODEWARDEN_DB, session, secretName)
            if (!found) {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: credKind, action: 'secret.read', ok: false })
              return result(text('not found', true))
            }
            await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: credKind, action: 'secret.read', ok: true })
            return result(text(JSON.stringify({ username: found.username, password: found.value, totp: found.totp })))
          }
          // secret.fill: ask for a website credential to be filled in. The Agent
          // never receives the value; it only learns whether the request was
          // approved and, if so, the short-lived authorization handed to the
          // execution layer. Without a configured execution layer this fails
          // closed and returns no secret material.
          if (name === 'secret.fill') {
            const secretName = String(args.name ?? '').trim()
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
              return result(text('pending approval: ' + access.approvalUrl))
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
            // No execution layer configured: fail closed. The Agent must not
            // receive the value, and there is nothing that can redeem a token.
            if (!String(env.FILL_EXECUTION_TOKEN ?? '')) {
              await addAudit(env, { event: 'fill.deny', agent: resolved.name, name: secretName, origin: requestedOrigin.origin, reason: 'no-execution-layer' })
              return result(text('fill execution layer is not configured', true))
            }
            const nonce = base64Url(crypto.getRandomValues(new Uint8Array(24)))
            const issued = await issueFillAuthorization(env, {
              nonce, agent: resolved.name, itemId: access.itemId ?? '', itemName: secretName, accountId: session.email,
              origin: requestedOrigin.origin, action: String(args.action ?? 'login'), ttlMs: fillAuthTtlMs(env),
            })
            if (!issued?.ok) return result(text('fill authorization could not be issued', true))
            await addAudit(env, { event: 'fill.authorize', agent: resolved.name, name: secretName, origin: requestedOrigin.origin, approval: access.approval ?? 'policy' })
            await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: fillKind, action: 'secret.fill', ok: true })
            // The nonce is the execution layer's handle. It is not a secret:
            // redeeming it also requires the execution layer's own token.
            return result(text(JSON.stringify({ taskId: nonce, origin: requestedOrigin.origin, expiresInSeconds: 600 })))
          }
          if (name === 'request_credential') {
            const secretName = String(args.name ?? '').trim()
            if (!secretName) return result(text('name is required', true))
            const id = crypto.randomUUID()
            const entry = { id, agent: resolved.name, account: session.email, name: secretName, description: String(args.description ?? '').slice(0, 500), createdAt: nowIso() }
            await updateState(env, (next) => { next.credentialRequests ??= {}; next.credentialRequests[id] = entry; return next })
            await addAudit(env, { event: 'credential.request', agent: resolved.name, name: secretName })
            return result(text(`credential request created: ${url.origin}/connect?id=${id}`))
          }
          if (name === 'http_request') {
            const secretName = String(args.name ?? '')
            if (!secretName) return result(text('name is required', true))
            // secret.use is a distinct action from secret.read: it never
            // returns plaintext and requires a per-item target policy.
            let parsedTarget = null
            try { parsedTarget = new URL(String(args.url ?? '')) } catch { return result(text('invalid url', true)) }
            const useTarget = {
              host: parsedTarget.hostname.toLowerCase().replace(/\.$/, ''),
              port: String(parsedTarget.port || '443'),
              method: String(args.method ?? 'GET').trim().toUpperCase(),
              pathname: parsedTarget.pathname || '/',
            }
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx, action: 'secret.use', target: useTarget })
            const useKind = resolved.agent.oauth ? 'oauth' : 'token'
            if (access.status === 'pending') {
              await recordGeoEvent(env, request, ctx, { agent: resolved.name, kind: useKind, action: 'secret.use', ok: false })
              return result(text(`pending approval: ${access.approvalUrl}`))
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
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/secret') {
      const admin = await adminAuthorized(request, env)
      const resolved = admin ? null : await resolveAgent(request, env)
      if (!admin && !resolved) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('vault locked', 423)
      const name = url.searchParams.get('name') ?? ''
      if (!name) return fail('name required', 400)
      try {
        if (resolved) {
          const access = await agentAccess(env, {
            session, agentName: resolved.name, agent: resolved.agent, state: resolved.state,
            name, origin: url.origin, ctx,
          })
          if (access.status === 'pending') return json({ status: 'pending', requestId: access.requestId, approvalUrl: access.approvalUrl }, 202)
          if (access.status === 'forbidden') return fail(access.error, 403)
          if (access.status === 'notfound') return fail(access.error, 404)
          // Same rule as the MCP tools: only an api credential with an explicit
          // read policy may return plaintext to an Agent. A website login is
          // fill-only, so it can never be read back through this path either.
          const readGuard = plaintextReadAllowed(resolved.state, access.itemId ?? '')
          if (!readGuard.ok) {
            await addAudit(env, { event: 'secret.read-deny', agent: resolved.name, name, reason: readGuard.reason })
            return fail('plaintext read is not allowed for this credential: ' + readGuard.reason, 403)
          }
          return json({ value: access.value })
        }
        const result = await readSecretFromRows(env, env.NODEWARDEN_DB, session, name)
        if (!result) return fail('not found', 404)
        await addAudit(env, { event: 'secret.read', name, via: 'web' })
        return json({ value: result.value, username: result.username, totp: result.totp })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    return fail('not found', 404)
  },
}
