import { DurableObject } from 'cloudflare:workers'
import { uiHtml } from './ui.js'
import {
  b64ToBytes, constantTimeEqual, decryptCipherRow, extractSecret,
  hmacToken, sha256Base64, unwrapWithKek, wrapWithKek,
} from './crypto.js'

const encoder = new TextEncoder()
const SESSION_COOKIE = 'broker_admin'
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers })
const fail = (message, status = 400) => json({ error: message }, status)
const nowIso = () => new Date().toISOString()

const emptyState = () => ({ agents: {}, policies: {}, grants: {}, pending: {}, audit: [] })

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

async function validCookie(request, env) {
  const value = readCookie(request, SESSION_COOKIE)
  if (!value.startsWith('v1.')) return false
  const [, expiresText, signature] = value.split('.')
  const expires = Number(expiresText)
  if (!Number.isFinite(expires) || expires < Date.now()) return false
  const expected = await hmacToken(await cookieKey(env), String(expires))
  return constantTimeEqual(encoder.encode(expected), encoder.encode(signature ?? ''))
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
  const response = await stateStub(env).fetch('https://state/state')
  const payload = await response.json()
  let state = payload.state
  if (!state || !state.agents) state = emptyState()
  if (!state.agents || Object.keys(state.agents).length === 0) {
    if (env.AGENT_TOKEN) {
      state.agents['dsh'] = { hash: await sha256Base64(env.AGENT_TOKEN), alias: '', allow: [], write: false, createdAt: nowIso() }
    }
    await saveState(env, state)
  }
  return state
}

async function saveState(env, state) {
  await stateStub(env).fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
}

async function updateState(env, mutate) {
  const state = await loadState(env)
  const result = await mutate(state)
  await saveState(env, state)
  return result
}

async function addAudit(env, entry) {
  return updateState(env, (state) => {
    state.audit.unshift({ time: nowIso(), ...entry })
    state.audit = state.audit.slice(0, 500)
  })
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

async function adminAuthorized(request, env) { return validCookie(request, env) }

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
    if (constantTimeEqual(encoder.encode(agent.hash), encoder.encode(hash))) return { name, agent, state }
  }
  return null
}

function grantKey(agent, name) { return `${agent}\u0000${name}` }

function activeGrant(state, agent, name) {
  const grant = state.grants[grantKey(agent, name)]
  if (!grant || grant.revokedAt) return null
  if (grant.expiresAt && grant.expiresAt < Date.now()) return null
  if (grant.maxReads != null && (grant.reads ?? 0) >= grant.maxReads) return null
  return grant
}

function findPending(state, agent, name) {
  return Object.entries(state.pending).find(([, entry]) => entry.agent === agent && entry.name === name)?.[0] ?? null
}

async function vaultEmail(env, db) {
  if (env.VAULT_EMAIL) return env.VAULT_EMAIL
  const row = await db.prepare('SELECT email FROM users ORDER BY created_at LIMIT 1').first()
  return row?.email ?? ''
}

async function bootstrap(env, db) {
  const email = await vaultEmail(env, db)
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
  const result = await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC').bind(user.id).all()
  const state = await loadState(env)
  const items = []
  for (const row of result.results ?? []) {
    try {
      const decrypted = await decryptCipherRow(row, session)
      const name = decrypted.name || '(未命名)'
      items.push({
        id: row.id, type: decrypted.type, name, url: cipherUrl(decrypted.data), folderId: row.folder_id ?? null,
        noApproval: state.policies[name]?.noApproval === true,
      })
    } catch {}
  }
  return items
}

async function readSecretFromRows(env, db, session, name) {
  const user = await vaultUser(env, db, session)
  const rows = await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(user.id).all()
  for (const candidate of rows.results ?? []) {
    const decrypted = await decryptCipherRow(candidate, session)
    if (decrypted.name !== name) continue
    return { value: extractSecret(decrypted), type: decrypted.type, url: cipherUrl(decrypted.data) }
  }
  return null
}

function publicState(state) {
  return {
    agents: Object.entries(state.agents).map(([name, agent]) => ({ name, alias: agent.alias ?? '', allow: agent.allow ?? [], write: agent.write === true, createdAt: agent.createdAt ?? '' })),
    policies: state.policies ?? {},
    grants: Object.values(state.grants ?? {}),
    pending: Object.values(state.pending ?? {}),
    audit: state.audit ?? [],
  }
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(uiHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
    }
    if (url.pathname === '/api/status') {
      return json({ ok: true, name: 'secrets-broker-workers', bindings: { d1: Boolean(env.NODEWARDEN_DB), durableObject: Boolean(env.BROKER_STATE) } })
    }
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      if (!env.ADMIN_PASSWORD) return fail('ADMIN_PASSWORD is not configured', 500)
      if (!constantTimeEqual(encoder.encode(String(body.password ?? '')), encoder.encode(env.ADMIN_PASSWORD))) {
        await addAudit(env, { event: 'admin.login-fail' })
        return fail('密码错误', 401)
      }
      const cookie = await makeCookie(env)
      await addAudit(env, { event: 'admin.login' })
      return json({ ok: true }, 200, { 'set-cookie': `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` })
    }
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` })
    }
    if (url.pathname === '/api/me') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      const state = await loadState(env)
      return json({ email: env.VAULT_EMAIL || (session && session.email) || '', unlocked: Boolean(session), expiresAt: session?.expiresAt ?? 0, pending: Object.keys(state.pending ?? {}).length })
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
        const email = await vaultEmail(env, env.NODEWARDEN_DB)
        await putSession(env, { email, symEncKey: String(body.symEncKey), symMacKey: String(body.symMacKey), expiresAt })
        await addAudit(env, { event: 'vault.unlock', email, ttl: body.ttl ?? '24h' })
        return json({ ok: true, expiresAt, permanent: ttl === 0 })
      } catch (error) { return fail(String(error.message ?? error), 400) }
    }
    if (url.pathname === '/api/lock' && request.method === 'POST') {
      await stateStub(env).fetch('https://state/session', { method: 'DELETE' })
      await addAudit(env, { event: 'vault.lock' })
      return json({ ok: true })
    }
    if (url.pathname === '/api/items') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      try { return json({ items: await listCiphers(env, env.NODEWARDEN_DB, session) }) } catch (error) { return fail(String(error.message ?? error), 500) }
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
    if (url.pathname === '/api/state') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      return json(publicState(await loadState(env)))
    }
    if (url.pathname === '/api/agents/create' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim()
      if (!/^[a-zA-Z0-9._-]{1,48}$/.test(name)) return fail('invalid agent name', 400)
      const token = randomToken()
      let error = ''
      await updateState(env, (state) => {
        if (state.agents[name]) { error = 'agent already exists'; return state }
        state.agents[name] = { hash: '', alias: String(body.alias ?? '').trim(), allow: Array.isArray(body.allow) ? body.allow : [], write: body.write === true, createdAt: nowIso() }
        return state
      })
      if (error) return fail(error, 409)
      const hash = await sha256Base64(token)
      await updateState(env, (state) => { state.agents[name].hash = hash; return state })
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
      let found = false
      await updateState(env, (state) => { if (state.agents[name]) { state.agents[name].hash = hash; found = true } return state })
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
        return state
      })
      await addAudit(env, { event: 'agent.delete', agent: name })
      return json({ ok: true })
    }
    if (url.pathname === '/api/agents/update' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '')
      let found = false
      await updateState(env, (state) => {
        const agent = state.agents[name]
        if (!agent) return state
        found = true
        if (typeof body.alias === 'string') agent.alias = body.alias.trim()
        if (Array.isArray(body.allow)) agent.allow = body.allow.map(String).filter(Boolean)
        if (typeof body.write === 'boolean') agent.write = body.write
        return state
      })
      if (!found) return fail('agent not found', 404)
      return json({ ok: true })
    }
    if (url.pathname === '/api/pending/decide' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const id = String(body.id ?? '')
      let outcome = null
      await updateState(env, (state) => {
        const entry = state.pending[id]
        if (!entry) return state
        delete state.pending[id]
        if (body.decision === 'deny') {
          outcome = { denied: true, agent: entry.agent, name: entry.name }
          return state
        }
        const mode = ['once', '1h', '24h', '7d', 'always'].includes(body.decision) ? body.decision : 'once'
        const expiresAt = mode === '1h' ? Date.now() + 3600e3 : mode === '24h' ? Date.now() + 86400e3 : mode === '7d' ? Date.now() + 7 * 86400e3 : 0
        state.grants[grantKey(entry.agent, entry.name)] = { agent: entry.agent, name: entry.name, mode, createdAt: nowIso(), expiresAt, reads: 0, maxReads: mode === 'once' ? 1 : null, revokedAt: null }
        outcome = { agent: entry.agent, name: entry.name, mode }
        return state
      })
      if (!outcome) return fail('pending request not found', 404)
      await addAudit(env, { event: outcome.denied ? 'request.deny' : 'request.approve', ...outcome, source: 'web' })
      return json({ ok: true, outcome })
    }
    if (url.pathname === '/api/grants/revoke' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const key = grantKey(String(body.agent ?? ''), String(body.name ?? ''))
      let found = false
      await updateState(env, (state) => { if (state.grants[key]) { state.grants[key].revokedAt = nowIso(); found = true } return state })
      if (!found) return fail('grant not found', 404)
      await addAudit(env, { event: 'grant.revoke', agent: body.agent, name: body.name, source: 'web' })
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
          const { name: agentName, agent, state } = resolved
          const allowed = !agent.allow || agent.allow.length === 0 || agent.allow.includes(name)
          if (!allowed) return fail('agent not allowed to read this item', 403)
          const policy = state.policies?.[name]
          let grant = activeGrant(state, agentName, name)
          if (!policy?.noApproval && !grant) {
            let pendingId = findPending(state, agentName, name)
            if (!pendingId) {
              pendingId = crypto.randomUUID()
              await updateState(env, (next) => {
                next.pending[pendingId] = { id: pendingId, agent: agentName, name, createdAt: nowIso() }
                return next
              })
              await addAudit(env, { event: 'request.create', agent: agentName, name })
            }
            return json({ status: 'pending', requestId: pendingId, approvalUrl: `${url.origin}/#/grants` }, 202)
          }
          const result = await readSecretFromRows(env, env.NODEWARDEN_DB, session, name)
          if (!result) return fail('not found', 404)
          if (grant) {
            grant.reads = (grant.reads ?? 0) + 1
            await updateState(env, (next) => {
              const current = activeGrant(next, agentName, name)
              if (current) current.reads = (current.reads ?? 0) + 1
              if (current?.maxReads != null && (current.reads ?? 0) >= current.maxReads) delete next.grants[grantKey(agentName, name)]
              return next
            })
          }
          await addAudit(env, { event: 'secret.read', agent: agentName, name, mode: policy?.noApproval ? 'no-approval' : 'grant', via: 'agent' })
          return json({ value: result.value })
        }
        const result = await readSecretFromRows(env, env.NODEWARDEN_DB, session, name)
        if (!result) return fail('not found', 404)
        await addAudit(env, { event: 'secret.read', name, via: 'web' })
        return json({ value: result.value })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    return fail('not found', 404)
  },
}
