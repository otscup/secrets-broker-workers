import { DurableObject } from 'cloudflare:workers'
import { uiHtml } from './ui.js'
import {
  b64ToBytes, cipherKeys, constantTimeEqual, decryptCipherRow, encryptStr, extractSecret,
  hmacToken, pbkdf2, sha256Base64, unwrapWithKek, wrapWithKek, bytesToB64,
} from './crypto.js'

const encoder = new TextEncoder()
const SESSION_COOKIE = 'broker_admin'
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers })
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
  state.settings ??= { notifications: {} }
  state.settings.notifications ??= {}
  state.policies ??= {}
  state.itemGroups ??= {}
  state.profile ??= {}
  state.security ??= { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' }
  state.grants ??= {}
  state.pending ??= {}
  state.audit ??= []
  if (!state.agents || Object.keys(state.agents).length === 0) {
    if (env.AGENT_TOKEN) {
      state.agents['dsh'] = { hash: await sha256Base64(env.AGENT_TOKEN), tokenWrapped: await wrapWithKek(encoder.encode(env.AGENT_TOKEN), await kekBytes(env)), alias: '', allow: [], groups: [], write: false, createdAt: nowIso() }
    }
    await saveState(env, state)
  } else if (env.AGENT_TOKEN && state.agents.dsh && !state.agents.dsh.tokenWrapped) {
    const hash = await sha256Base64(env.AGENT_TOKEN)
    if (state.agents.dsh.hash === hash) {
      state.agents.dsh.tokenWrapped = await wrapWithKek(encoder.encode(env.AGENT_TOKEN), await kekBytes(env))
      await saveState(env, state)
    }
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

async function oidcConfig(env, request, state) {
  const stored = state?.settings?.oidc ?? {}
  const issuer = String(stored.issuer || env.OIDC_ISSUER || '').replace(/\/$/, '')
  const clientId = String(stored.clientId || env.OIDC_CLIENT_ID || '')
  const clientSecret = String(stored.clientSecret || env.OIDC_CLIENT_SECRET || '')
  const redirectUri = String(stored.redirectUri || env.OIDC_REDIRECT_URI || `${new URL(request.url).origin}/oidc/callback`)
  if (!issuer || !clientId) return null
  return { issuer, clientId, clientSecret, redirectUri, scope: stored.scope || env.OIDC_SCOPE || 'openid profile email' }
}

async function oidcDiscovery(issuer) {
  const response = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
  if (!response.ok) throw new Error('OIDC discovery failed')
  return response.json()
}

async function oidcStateCookie(env, state, verifier) {
  const expires = Date.now() + 10 * 60 * 1000
  const payload = `${state}:${verifier}.${expires}`
  const signature = await hmacToken(await cookieKey(env), payload)
  return `${payload}.${signature}`
}

async function verifyOidcState(env, cookieValue) {
  if (!cookieValue) return null
  const parts = cookieValue.split('.')
  if (parts.length < 3) return null
  const signature = parts.pop()
  const expires = Number(parts.pop())
  const payload = parts.join('.')
  if (!Number.isFinite(expires) || expires < Date.now()) return null
  const expected = await hmacToken(await cookieKey(env), `${payload}.${expires}`)
  if (!constantTimeEqual(encoder.encode(expected), encoder.encode(signature))) return null
  const separator = payload.indexOf(':')
  if (separator < 0) return null
  return { state: payload.slice(0, separator), verifier: payload.slice(separator + 1) }
}

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
        group: state.itemGroups?.[name] ?? '',
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

async function findCipherRow(env, db, session, name) {
  const user = await vaultUser(env, db, session)
  const rows = await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(user.id).all()
  for (const candidate of rows.results ?? []) {
    const decrypted = await decryptCipherRow(candidate, session)
    if (decrypted.name === name) return { row: candidate, decrypted }
  }
  return null
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

function publicState(state) {
  return {
    agents: Object.entries(state.agents).map(([name, agent]) => ({ name, alias: agent.alias ?? '', allow: agent.allow ?? [], groups: agent.groups ?? [], write: agent.write === true, createdAt: agent.createdAt ?? '' })),
    policies: state.policies ?? {},
    itemGroups: state.itemGroups ?? {},
    profile: state.profile ?? {},
    grants: Object.values(state.grants ?? {}),
    pending: Object.values(state.pending ?? {}),
    audit: state.audit ?? [],
  }
}

async function notifyPending(env, origin, entry, ctx) {
  const state = await loadState(env)
  const notifications = state.settings?.notifications ?? {}
  const link = `${origin}/#/grants`
  const text = `Secrets Broker 授权请求\nAgent: ${entry.agent}\n条目: ${entry.name}\n时间: ${entry.createdAt}\n批准: ${link}`
  const tasks = []
  if (notifications.telegram?.botToken && notifications.telegram?.chatId) {
    tasks.push(fetch(`https://api.telegram.org/bot${notifications.telegram.botToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: notifications.telegram.chatId, text, disable_web_page_preview: true }),
    }))
  }
  if (notifications.ntfy?.url && notifications.ntfy?.topic) {
    tasks.push(fetch(`${String(notifications.ntfy.url).replace(/\/$/, '')}/${encodeURIComponent(notifications.ntfy.topic)}`, {
      method: 'POST', headers: { title: 'Secrets Broker approval', tags: 'lock' }, body: text,
    }))
  }
  if (notifications.gotify?.url && notifications.gotify?.token) {
    tasks.push(fetch(`${String(notifications.gotify.url).replace(/\/$/, '')}/message?token=${encodeURIComponent(notifications.gotify.token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Secrets Broker approval', message: text, priority: 5 }),
    }))
  }
  if (notifications.wxpush?.url && notifications.wxpush?.token) {
    const body = new URLSearchParams({ title: 'Secrets Broker 授权请求', content: text, token: notifications.wxpush.token })
    tasks.push(fetch(notifications.wxpush.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }))
  }
  if (!tasks.length) return
  const run = Promise.allSettled(tasks)
  if (ctx?.waitUntil) ctx.waitUntil(run)
  else await run
}

async function agentAccess(env, { session, agentName, agent, state, name, origin, ctx }) {
  const group = state.itemGroups?.[name] ?? ''
  const allow = agent.allow ?? []
  const groups = agent.groups ?? []
  const hasScope = allow.length > 0 || groups.length > 0
  const allowed = !hasScope || allow.includes(name) || groups.includes(group)
  if (!allowed) return { status: 'forbidden', error: 'agent not allowed to read this item' }
  const policy = state.policies?.[name]
  const grant = activeGrant(state, agentName, name)
  if (!policy?.noApproval && !grant) {
    let pendingId = findPending(state, agentName, name)
    if (!pendingId) {
      pendingId = crypto.randomUUID()
      const entry = { id: pendingId, agent: agentName, name, createdAt: nowIso() }
      await updateState(env, (next) => { next.pending[pendingId] = entry; return next })
      await addAudit(env, { event: 'request.create', agent: agentName, name })
      await notifyPending(env, origin, entry, ctx)
    }
    return { status: 'pending', requestId: pendingId, approvalUrl: `${origin}/#/grants` }
  }
  const result = await readSecretFromRows(env, env.NODEWARDEN_DB, session, name)
  if (!result) return { status: 'notfound', error: 'not found' }
  if (grant) {
    await updateState(env, (next) => {
      const current = activeGrant(next, agentName, name)
      if (current) current.reads = (current.reads ?? 0) + 1
      if (current?.maxReads != null && (current.reads ?? 0) >= current.maxReads) delete next.grants[grantKey(agentName, name)]
      return next
    })
  }
  await addAudit(env, { event: 'secret.read', agent: agentName, name, mode: policy?.noApproval ? 'no-approval' : 'grant', via: 'agent' })
  return { status: 'ok', value: result.value }
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(uiHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
    }
    if (url.pathname === '/api/status') {
      return json({ ok: true, name: 'secrets-broker-workers', bindings: { d1: Boolean(env.NODEWARDEN_DB), durableObject: Boolean(env.BROKER_STATE) } })
    }
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      if (!(await verifyAdminPassword(env, state, body.password))) {
        await addAudit(env, { event: 'admin.login-fail' })
        return fail('密码错误', 401)
      }
      if (state.security?.totpEnabled) {
        if (!body.code) return json({ totpRequired: true }, 401)
        const secret = await totpSecret(env, state)
        if (!secret || !(await verifyTotp(secret, body.code))) return json({ totpRequired: true, error: '两步验证码错误' }, 401)
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
        const discovery = await oidcDiscovery(oidc.issuer)
        const state = randomToken()
        const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
        const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))))
        const cookie = await oidcStateCookie(env, state, verifier)
        const target = new URL(discovery.authorization_endpoint)
        target.searchParams.set('client_id', oidc.clientId)
        target.searchParams.set('redirect_uri', oidc.redirectUri)
        target.searchParams.set('response_type', 'code')
        target.searchParams.set('scope', oidc.scope)
        target.searchParams.set('state', state)
        target.searchParams.set('code_challenge', challenge)
        target.searchParams.set('code_challenge_method', 'S256')
        return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': `oidc_state=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } })
      } catch (error) { return fail(String(error.message ?? error), 502) }
    }
    if (url.pathname === '/oidc/callback') {
      const state = await loadState(env)
      const oidc = await oidcConfig(env, request, state)
      if (!oidc) return fail('OIDC is not configured', 503)
      const stateData = await verifyOidcState(env, readCookie(request, 'oidc_state'))
      const returned = url.searchParams.get('state') ?? ''
      if (!stateData || stateData.state !== returned) return fail('invalid OIDC state', 400)
      const code = url.searchParams.get('code') ?? ''
      if (!code) return fail('missing authorization code', 400)
      try {
        const discovery = await oidcDiscovery(oidc.issuer)
        const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: oidc.redirectUri, client_id: oidc.clientId, code_verifier: stateData.verifier })
        if (oidc.clientSecret) body.set('client_secret', oidc.clientSecret)
        const tokenResponse = await fetch(discovery.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
        const tokens = await tokenResponse.json()
        if (!tokenResponse.ok || !tokens.access_token) return fail(tokens.error_description || 'OIDC token exchange failed', 502)
        const userResponse = await fetch(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } })
        const user = await userResponse.json()
        if (!userResponse.ok) return fail('OIDC userinfo failed', 502)
        await updateState(env, (state) => {
          state.profile ??= {}
          state.profile.oidcSub = String(user.sub ?? '')
          state.profile.oidcEmail = String(user.email ?? state.profile.email ?? '')
          state.profile.name = String(user.name ?? user.preferred_username ?? state.profile.name ?? '')
          state.profile.email = String(user.email ?? state.profile.email ?? '')
          state.profile.avatarUrl = String(user.picture ?? state.profile.avatarUrl ?? '')
          return state
        })
        const cookie = await makeCookie(env)
        await addAudit(env, { event: 'admin.oidc-login', email: user.email ?? user.sub ?? '' })
        return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': [
          `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
          'oidc_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        ] } })
      } catch (error) { return fail(String(error.message ?? error), 502) }
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
        state.agents[name] = { hash: '', tokenWrapped: '', alias: String(body.alias ?? '').trim(), allow: Array.isArray(body.allow) ? body.allow : [], groups: Array.isArray(body.groups) ? body.groups : [], write: body.write === true, createdAt: nowIso() }
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
        if (Array.isArray(body.groups)) agent.groups = body.groups.map(String).filter(Boolean)
        if (typeof body.write === 'boolean') agent.write = body.write
        return state
      })
      if (!found) return fail('agent not found', 404)
      return json({ ok: true })
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
    if (url.pathname === '/api/grants/share' && request.method === 'POST') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      const name = String(body.name ?? '').trim()
      const agents = Array.isArray(body.agents) ? body.agents.map(String).filter(Boolean) : []
      if (!name || agents.length === 0) return fail('name and agents required', 400)
      const seconds = Math.max(0, Number(body.seconds) || 0)
      const maxReads = body.maxReads == null || body.maxReads === '' ? null : Math.max(1, Number(body.maxReads) || 1)
      await updateState(env, (state) => {
        for (const agentName of agents) {
          state.grants[grantKey(agentName, name)] = { agent: agentName, name, mode: 'share', createdAt: nowIso(), expiresAt: seconds ? Date.now() + seconds * 1000 : 0, reads: 0, maxReads, revokedAt: null }
        }
        return state
      })
      await addAudit(env, { event: 'grant.share', name, agents })
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
          wxpush: { url: n.wxpush?.url ?? '', configured: Boolean(n.wxpush?.url && n.wxpush?.token) },
        }, oidc: {
          issuer: effectiveOidc?.issuer ?? '',
          clientId: effectiveOidc?.clientId ?? '',
          redirectUri: effectiveOidc?.redirectUri ?? '',
          scope: effectiveOidc?.scope ?? '',
          configured: Boolean(effectiveOidc),
          secretConfigured: Boolean(state.settings?.oidc?.clientSecret || env.OIDC_CLIENT_SECRET),
        } })
      }
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
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
          if (body.oidc && typeof body.oidc === 'object') {
            const current = state.settings.oidc ?? {}
            const next = { ...current }
            for (const key of ['issuer', 'clientId', 'redirectUri', 'scope']) {
              if (typeof body.oidc[key] === 'string') next[key] = body.oidc[key].trim()
            }
            if (typeof body.oidc.clientSecret === 'string' && body.oidc.clientSecret.length > 0) next.clientSecret = body.oidc.clientSecret
            if (body.oidc.clear === true) { delete next.issuer; delete next.clientId; delete next.clientSecret; delete next.redirectUri; delete next.scope }
            state.settings.oidc = next
          }
          return state
        })
        await addAudit(env, { event: 'settings.update', scope: 'notifications-oidc' })
        return json({ ok: true })
      }
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
        return result({ protocolVersion: body.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'secrets-broker', version: '0.1.0' } })
      }
      if (body.method === 'tools/list') {
        return result({ tools: [
          { name: 'list_secrets', description: 'List secret item names available to this agent (no values).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
          { name: 'request_access', description: 'Request approval to read a secret by name. Returns an approval URL if pending.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' } }, required: ['name'] } },
          { name: 'get_secret', description: 'Read a secret value after approval. Disabled unless MCP_ALLOW_READ=1.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' } }, required: ['name'] } },
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
            const items = await listCiphers(env, env.NODEWARDEN_DB, session)
            return result(text(items.map((item) => ({ name: item.name, url: item.url, noApproval: item.noApproval }))))
          }
          if (name === 'request_access') {
            const secretName = String(args.name ?? '')
            if (!secretName) return result(text('name is required', true))
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx })
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
            if (access.status === 'pending') return result(text(`pending approval: ${access.approvalUrl}`))
            if (access.status === 'forbidden' || access.status === 'notfound') return result(text(access.error, true))
            return result(text(access.value))
          }
          return rpcError('unknown tool')
        } catch (error) {
          return result(text(String(error.message ?? error), true))
        }
      }
      return rpcError('unknown method')
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
          return json({ value: access.value })
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
