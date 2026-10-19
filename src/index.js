import { DurableObject } from 'cloudflare:workers'
import { uiHtml } from './ui.js'
import { LOGO_PNG_B64, FAVICON_ICO_B64 } from './logo.js'
import {
  b64ToBytes, cipherKeys, constantTimeEqual, decryptCipherRow, decryptStr, encryptStr, extractSecret,
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
  await updateState(env, (state) => {
    state.adminSessions ??= {}
    state.adminSessions[id] = { id, ip, ua, createdAt: nowIso(), lastSeen: nowIso(), expiresAt: expires }
    return state
  })
  return `${payload}.${signature}`
}

async function validCookie(request, env) {
  const value = readCookie(request, SESSION_COOKIE)
  if (value.startsWith('v2.')) {
    const [version, id, expiresText, signature] = value.split('.')
    const expires = Number(expiresText)
    if (!id || !Number.isFinite(expires) || expires < Date.now()) return false
    const payload = `${version}.${id}.${expiresText}`
    const expected = await hmacToken(await cookieKey(env), payload)
    if (!constantTimeEqual(encoder.encode(expected), encoder.encode(signature ?? ''))) return false
    const state = await loadState(env)
    const record = state.adminSessions?.[id]
    if (!record || (record.expiresAt && record.expiresAt < Date.now())) return false
    if (!record.lastSeen || Date.now() - Date.parse(record.lastSeen) > 300000) {
      await updateState(env, (next) => { if (next.adminSessions?.[id]) next.adminSessions[id].lastSeen = nowIso(); return next })
    }
    return true
  }
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
  state.oauthClients ??= {}
  state.oauthCodes ??= {}
  state.oauthTokens ??= {}
  state.oauthAgentProfiles ??= {}
  state.adminSessions ??= {}
  state.grants ??= {}
  state.transfers ??= []
  const defaultAgentAccount = state.settings?.vaultEmail || env.VAULT_EMAIL || ''
  for (const agent of Object.values(state.agents ?? {})) if (!agent.account && defaultAgentAccount) agent.account = defaultAgentAccount
  state.pending ??= {}
  state.audit ??= []
  if (!state.agents || Object.keys(state.agents).length === 0) {
    if (env.AGENT_TOKEN) {
      state.agents['dsh'] = { hash: await sha256Base64(env.AGENT_TOKEN), tokenWrapped: await wrapWithKek(encoder.encode(env.AGENT_TOKEN), await kekBytes(env)), alias: '', note: '', allow: [], groups: [], write: false, account: defaultAgentAccount, createdAt: nowIso() }
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
  return {
    issuer, clientId, clientSecret, redirectUri, scope: stored.scope || env.OIDC_SCOPE || 'openid profile email',
    authorizationEndpoint: String(stored.authorizationEndpoint || env.OIDC_AUTHORIZATION_ENDPOINT || ''),
    tokenEndpoint: String(stored.tokenEndpoint || env.OIDC_TOKEN_ENDPOINT || ''),
    userinfoEndpoint: String(stored.userinfoEndpoint || env.OIDC_USERINFO_ENDPOINT || ''),
    jwksUri: String(stored.jwksUri || env.OIDC_JWKS_URI || ''),
  }
}

async function oidcEndpoints(oidc) {
  const needsDiscovery = !oidc.authorizationEndpoint || !oidc.tokenEndpoint || !oidc.userinfoEndpoint
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
  return response.json()
}

async function oidcStateCookie(env, state, verifier, next = '') {
  const expires = Date.now() + 10 * 60 * 1000
  const payload = `${state}|${verifier}|${next}|${expires}`
  const signature = await hmacToken(await cookieKey(env), payload)
  return encodeURIComponent(`${payload}|${signature}`)
}

async function verifyOidcState(env, cookieValue) {
  if (!cookieValue) return null
  let decoded = ''
  try { decoded = decodeURIComponent(cookieValue) } catch { return null }
  const parts = decoded.split('|')
  if (parts.length < 5) return null
  const signature = parts.pop()
  const expires = Number(parts.pop())
  const next = parts.pop()
  const verifier = parts.pop()
  const state = parts.join('|')
  if (!Number.isFinite(expires) || expires < Date.now()) return null
  const payload = `${state}|${verifier}|${next}|${expires}`
  const expected = await hmacToken(await cookieKey(env), payload)
  return constantTimeEqual(encoder.encode(expected), encoder.encode(signature)) ? { state, verifier, next } : null
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
    if (constantTimeEqual(encoder.encode(agent.hash), encoder.encode(hash))) return { name, agent, state }
  }
  for (const tokenEntry of Object.values(state.oauthTokens ?? {})) {
    if (tokenEntry.expiresAt && tokenEntry.expiresAt < Date.now()) continue
    if (constantTimeEqual(encoder.encode(tokenEntry.hash ?? ''), encoder.encode(hash))) {
      const profile = state.oauthAgentProfiles?.[tokenEntry.agent] ?? {}
      return { name: tokenEntry.agent, agent: { allow: profile.allow ?? [], groups: profile.groups ?? [], write: profile.write === true, oauth: true, account: tokenEntry.account ?? '', alias: profile.alias ?? '', note: profile.note ?? '' }, state }
    }
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
    return { value: extractSecret(decrypted), type: decrypted.type, url: cipherUrl(decrypted.data) }
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
        next.grants[key] = { agent: transfer.agent, name: transfer.name, mode: 'transfer', createdAt: nowIso(), expiresAt: transfer.seconds ? Date.now() + transfer.seconds * 1000 : 0, reads: 0, maxReads: transfer.maxReads ?? null, revokedAt: null, account: transfer.targetAccount }
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
  const data = { login: { username: '', password: fields.value ? await encryptStr(String(fields.value), enc, mac) : '', uris: [] }, fields: [] }
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
    if (fields.noApproval === true) next.policies[name] = { noApproval: true }
    return next
  })
  await addAudit(env, { event: 'item.create', name })
  return { name, id }
}

function publicState(state) {
  const agents = Object.entries(state.agents).map(([name, agent]) => ({ name, alias: agent.alias ?? '', note: agent.note ?? '', allow: agent.allow ?? [], groups: agent.groups ?? [], write: agent.write === true, account: agent.account ?? '', oauth: false, createdAt: agent.createdAt ?? '' }))
  const seen = new Set(agents.map((agent) => agent.name))
  const now = Date.now()
  for (const token of Object.values(state.oauthTokens ?? {})) {
    if (!token.agent || seen.has(token.agent)) continue
    if (token.expiresAt && token.expiresAt <= now) continue
    seen.add(token.agent)
    const profile = state.oauthAgentProfiles?.[token.agent] ?? {}
    agents.push({ name: token.agent, alias: profile.alias ?? '', note: profile.note ?? '', allow: profile.allow ?? [], groups: profile.groups ?? [], write: profile.write === true, account: token.account ?? '', oauth: true, createdAt: token.createdAt ?? '' })
  }
  return {
    agents,
    policies: state.policies ?? {},
    itemGroups: state.itemGroups ?? {},
    profile: state.profile ?? {},
    grants: Object.values(state.grants ?? {}),
    pending: Object.values(state.pending ?? {}),
    transfers: (state.transfers ?? []).map((entry) => ({ id: entry.id, agent: entry.agent, name: entry.name, sourceAccount: entry.sourceAccount, targetAccount: entry.targetAccount, folder: entry.folder, createdAt: entry.createdAt, error: entry.error ?? '' })),
    audit: state.audit ?? [],
  }
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
    const mode = ['once', '1h', '24h', '7d', 'always'].includes(decision) ? decision : 'once'
    const expiresAt = mode === '1h' ? Date.now() + 3600e3 : mode === '24h' ? Date.now() + 86400e3 : mode === '7d' ? Date.now() + 7 * 86400e3 : 0
    state.grants[grantKey(entry.agent, entry.name)] = { agent: entry.agent, name: entry.name, mode, createdAt: nowIso(), expiresAt, reads: 0, maxReads: mode === 'once' ? 1 : null, revokedAt: null, account: entry.account ?? '' }
    outcome = { agent: entry.agent, name: entry.name, mode }
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

async function notifyPending(env, origin, entry, ctx) {
  const state = await loadState(env)
  const notifications = state.settings?.notifications ?? {}
  const links = await signedApprovalLinks(env, entry.id, origin)
  const shortText = `Secrets Broker 授权请求\nAgent: ${entry.agent}\n条目: ${entry.name}\n时间: ${entry.createdAt}\n\n请在 Secrets Broker 页面处理: ${origin}/`
  const linkText = `Secrets Broker 授权请求\nAgent: ${entry.agent}\n条目: ${entry.name}\n时间: ${entry.createdAt}\n\n批准一次: ${links.once}\n批准 24 小时: ${links['24h']}\n永久: ${links.always}\n拒绝: ${links.deny}`
  const tasks = []
  if (notifications.telegram?.botToken && notifications.telegram?.chatId) {
    const keyboard = { inline_keyboard: [
      [{ text: '仅本次', callback_data: `a:${entry.id}:once` }, { text: '24 小时', callback_data: `a:${entry.id}:24h` }],
      [{ text: '永久', callback_data: `a:${entry.id}:always` }, { text: '拒绝', callback_data: `d:${entry.id}` }],
    ] }
    tasks.push(fetch(`https://api.telegram.org/bot${notifications.telegram.botToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: notifications.telegram.chatId, text: shortText, disable_web_page_preview: true, reply_markup: keyboard }),
    }))
  }
  if (notifications.ntfy?.url && notifications.ntfy?.topic) {
    const actions = [
      `view, 仅本次, ${links.once}, clear=true`,
      `view, 24小时, ${links['24h']}, clear=true`,
      `view, 永久, ${links.always}, clear=true`,
      `view, 拒绝, ${links.deny}, clear=true`,
    ].join('; ')
    tasks.push(fetch(`${String(notifications.ntfy.url).replace(/\/$/, '')}/${encodeURIComponent(notifications.ntfy.topic)}`, {
      method: 'POST', headers: { title: 'Secrets Broker approval', tags: 'lock', Actions: actions }, body: shortText,
    }))
  }
  if (notifications.gotify?.url && notifications.gotify?.token) {
    tasks.push(fetch(`${String(notifications.gotify.url).replace(/\/$/, '')}/message?token=${encodeURIComponent(notifications.gotify.token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Secrets Broker approval', message: linkText, priority: 5 }),
    }))
  }
  if (notifications.wxpush?.url && notifications.wxpush?.token) {
    if (notifications.wxpush.format === 'json') {
      tasks.push(fetch(notifications.wxpush.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${notifications.wxpush.token}` }, body: JSON.stringify({ title: 'Secrets Broker 授权请求', text: linkText, content: linkText, agent: entry.agent, item: entry.name, approval: links }) }))
    } else {
      const body = new URLSearchParams({ title: 'Secrets Broker 授权请求', content: linkText, token: notifications.wxpush.token })
      tasks.push(fetch(notifications.wxpush.url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }))
    }
  }
  if (!tasks.length) return
  const run = Promise.allSettled(tasks)
  if (ctx?.waitUntil) ctx.waitUntil(run)
  else await run
}

async function agentAccess(env, { session, agentName, agent, state, name, origin, ctx }) {
  if (agent.account && session.email && String(agent.account).toLowerCase() !== String(session.email).toLowerCase()) return { status: 'forbidden', error: 'agent is bound to another vault account' }
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
      const entry = { id: pendingId, agent: agentName, name, account: session.email, createdAt: nowIso() }
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/logo.png' || url.pathname === '/favicon.ico') {
      const bytes = b64ToBytes(url.pathname === '/logo.png' ? LOGO_PNG_B64 : FAVICON_ICO_B64)
      return new Response(bytes, { headers: { 'content-type': url.pathname === '/logo.png' ? 'image/png' : 'image/x-icon', 'cache-control': 'public, max-age=86400' } })
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(uiHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
    }
    if (url.pathname === '/api/plugin/pending' && request.method === 'GET') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const state = await loadState(env)
      return json({ pending: Object.values(state.pending ?? {}).map((entry) => ({ id: entry.id, agent: entry.agent, name: entry.name, createdAt: entry.createdAt })), count: Object.keys(state.pending ?? {}).length })
    }
    if (url.pathname === '/api/plugin/decide' && request.method === 'POST') {
      if (!pluginAuthorized(request, env)) return fail('unauthorized', 401)
      const body = await request.json().catch(() => ({}))
      if (!body.id) return fail('id required', 400)
      const outcome = await decidePending(env, String(body.id), String(body.decision ?? 'once'), 'dsh-plugin')
      return json({ ok: true, outcome })
    }
    if (url.pathname === '/api/status') {
      return json({ ok: true, name: 'secrets-broker-workers', bindings: { d1: Boolean(env.NODEWARDEN_DB), durableObject: Boolean(env.BROKER_STATE) } })
    }
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const state = await loadState(env)
      let passwordValid = await verifyAdminPassword(env, state, body.password)
      if (!passwordValid && env.ADMIN_PASSWORD && constantTimeEqual(encoder.encode(String(body.password ?? '')), encoder.encode(env.ADMIN_PASSWORD))) passwordValid = true
      if (!passwordValid) {
        await addAudit(env, { event: 'admin.login-fail' })
        return fail('密码错误', 401)
      }
      if (state.security?.totpEnabled) {
        if (!body.code) return json({ totpRequired: true }, 401)
        const secret = await totpSecret(env, state)
        if (!secret || !(await verifyTotp(secret, body.code))) return json({ totpRequired: true, error: '两步验证码错误' }, 401)
      }
      const cookie = await createAdminCookie(env, request)
      await addAudit(env, { event: 'admin.login' })
      return json({ ok: true }, 200, { 'set-cookie': `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` })
    }
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      const sessionId = cookieSessionId(request)
      if (sessionId) await updateState(env, (state) => { if (state.adminSessions?.[sessionId]) delete state.adminSessions[sessionId]; return state })
      return json({ ok: true }, 200, { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` })
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
        const next = url.searchParams.get('next') === 'profile' ? 'profile' : ''
        const cookie = await oidcStateCookie(env, state, verifier, next)
        const target = new URL(endpoints.authorization)
        target.searchParams.set('client_id', oidc.clientId)
        target.searchParams.set('redirect_uri', oidc.redirectUri)
        target.searchParams.set('response_type', 'code')
        target.searchParams.set('scope', oidc.scope)
        target.searchParams.set('state', state)
        target.searchParams.set('code_challenge', challenge)
        target.searchParams.set('code_challenge_method', 'S256')
        const prompt = url.searchParams.get('prompt')
        if (prompt === 'login' || prompt === 'consent') target.searchParams.set('prompt', prompt)
        return new Response(null, { status: 302, headers: { location: target.toString(), 'set-cookie': `oidc_state=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } })
      } catch (error) { return fail(String(error.message ?? error), 502) }
    }
    if (url.pathname === '/oidc/callback') {
      const state = await loadState(env)
      const oidc = await oidcConfig(env, request, state)
      if (!oidc) return fail('OIDC is not configured', 503)
      const stateData = await verifyOidcState(env, readCookie(request, 'oidc_state'))
      const returned = url.searchParams.get('state') ?? ''
      if (!stateData || stateData.state !== returned) return new Response('<meta charset="utf-8"><h2>OIDC 状态校验失败</h2><p>这个链接是回调地址，不能直接打开；请从「个人资料 → 使用 OIDC 登录 / 绑定」重新发起。</p><p><a href="/?view=profile">回到个人资料</a></p>', { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } })
      const code = url.searchParams.get('code') ?? ''
      if (!code) return fail('missing authorization code', 400)
      try {
        const endpoints = await oidcEndpoints(oidc)
        if (!endpoints.token || !endpoints.userinfo) return fail('OIDC token/userinfo endpoint missing', 502)
        const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: oidc.redirectUri, client_id: oidc.clientId, code_verifier: stateData.verifier })
        if (oidc.clientSecret) body.set('client_secret', oidc.clientSecret)
        const tokenResponse = await fetch(endpoints.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
        const tokens = await tokenResponse.json()
        if (!tokenResponse.ok || !tokens.access_token) return fail(tokens.error_description || 'OIDC token exchange failed', 502)
        const userResponse = await fetch(endpoints.userinfo, { headers: { authorization: `Bearer ${tokens.access_token}` } })
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
        const cookie = await createAdminCookie(env, request)
        await addAudit(env, { event: 'admin.oidc-login', email: user.email ?? user.sub ?? '' })
        const headers = new Headers({ location: stateData.next === 'profile' ? '/?view=profile' : '/' })
        headers.append('set-cookie', `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`)
        return new Response(null, { status: 302, headers })
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
      try { return json({ items: await listCiphers(env, env.NODEWARDEN_DB, session), completedTransfers }) } catch (error) { return fail(String(error.message ?? error), 500) }
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
      const session = await getSession(env)
      const account = session?.email || await vaultEmail(env, env.NODEWARDEN_DB, await loadState(env))
      let error = ''
      await updateState(env, (state) => {
        if (state.agents[name]) { error = 'agent already exists'; return state }
        state.agents[name] = { hash: '', tokenWrapped: '', alias: String(body.alias ?? '').trim(), note: String(body.note ?? '').trim(), allow: Array.isArray(body.allow) ? body.allow : [], groups: Array.isArray(body.groups) ? body.groups : [], write: body.write === true, account, createdAt: nowIso() }
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
        if (typeof body.write === 'boolean') profile.write = body.write
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
      const outcome = await decidePending(env, String(body.id ?? ''), String(body.decision ?? ''), 'web')
      if (!outcome) return fail('pending request not found', 404)
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
          await updateState(env, (next) => {
            next.grants[grantKey(agentName, item)] = { agent: agentName, name: item, mode: 'share', createdAt: nowIso(), expiresAt: seconds ? Date.now() + seconds * 1000 : 0, reads: 0, maxReads, revokedAt: null, account: session.email }
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
        await updateState(env, (next) => {
          next.grants[grantKey(agentName, name)] = { agent: agentName, name, mode: 'share', createdAt: nowIso(), expiresAt: seconds ? Date.now() + seconds * 1000 : 0, reads: 0, maxReads, revokedAt: null, account: session.email }
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
      return new Response(`<meta charset="utf-8"><title>Secrets Broker</title><h2>${message}</h2>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
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
    if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      return json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin], scopes_supported: ['secrets.read'] })
    }
    if (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/oauth-authorization-server/mcp') {
      return json(oauthMetadata(url.origin))
    }
    if (url.pathname === '/oauth/register' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String).filter(Boolean) : []
      if (!redirectUris.length) return fail('redirect_uris required', 400)
      const clientId = 'mcp_' + base64Url(crypto.getRandomValues(new Uint8Array(18)))
      await updateState(env, (state) => {
        state.oauthClients[clientId] = { clientId, clientName: String(body.client_name ?? 'MCP client'), redirectUris, createdAt: nowIso() }
        return state
      })
      await addAudit(env, { event: 'oauth.client-register', clientId, clientName: body.client_name ?? '' })
      return json({ client_id: clientId, client_name: body.client_name ?? 'MCP client', redirect_uris: redirectUris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }, 201)
    }
    if (url.pathname === '/oauth/authorize') {
      const state = await loadState(env)
      const params = request.method === 'POST' ? new URLSearchParams(await request.text()) : url.searchParams
      const clientId = String(params.get('client_id') ?? '')
      const redirectUri = String(params.get('redirect_uri') ?? '')
      const client = state.oauthClients[clientId]
      if (!client) return fail('unknown client', 400)
      if (!client.redirectUris.includes(redirectUri)) return fail('invalid redirect_uri', 400)
      if (!(await adminAuthorized(request, env))) return new Response('<meta charset="utf-8"><p>请先在 <a href="/">Secrets Broker</a> 登录，然后再打开这个授权链接。</p>', { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } })
      if (request.method === 'POST' && params.get('decision') === 'deny') {
        const target = new URL(redirectUri); target.searchParams.set('error', 'access_denied'); if (params.get('state')) target.searchParams.set('state', params.get('state'))
        return Response.redirect(target.toString(), 302)
      }
      if (request.method === 'POST' && params.get('decision') === 'allow') {
        const code = randomToken()
        await updateState(env, (next) => {
          next.oauthCodes[code] = { clientId, redirectUri, codeChallenge: String(params.get('code_challenge') ?? ''), scope: String(params.get('scope') ?? 'secrets.read'), createdAt: nowIso(), expiresAt: Date.now() + 5 * 60 * 1000 }
          return next
        })
        await addAudit(env, { event: 'oauth.authorize', clientId, agent: 'oauth:' + clientId })
        const target = new URL(redirectUri); target.searchParams.set('code', code); if (params.get('state')) target.searchParams.set('state', params.get('state'))
        return Response.redirect(target.toString(), 302)
      }
      return new Response(oauthConsentPage(url.origin, params, client), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      const form = new URLSearchParams(await request.text())
      if (form.get('grant_type') !== 'authorization_code') return json({ error: 'unsupported_grant_type' }, 400)
      const code = String(form.get('code') ?? '')
      const state = await loadState(env)
      const entry = state.oauthCodes[code]
      if (!entry || entry.expiresAt < Date.now()) return json({ error: 'invalid_grant' }, 400)
      if (String(form.get('client_id') ?? '') !== entry.clientId || String(form.get('redirect_uri') ?? '') !== entry.redirectUri) return json({ error: 'invalid_grant' }, 400)
      if (entry.codeChallenge) {
        const verifier = String(form.get('code_verifier') ?? '')
        const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))))
        if (challenge !== entry.codeChallenge) return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400)
      }
      const accessToken = randomToken() + randomToken()
      const hash = await sha256Base64(accessToken)
      const agentName = 'oauth:' + entry.clientId
      const expiresAt = Date.now() + 24 * 3600 * 1000
      const session = await getSession(env)
      const account = session?.email || await vaultEmail(env, env.NODEWARDEN_DB, state)
      await updateState(env, (next) => {
        delete next.oauthCodes[code]
        next.oauthTokens[hash] = { hash, agent: agentName, clientId: entry.clientId, account, createdAt: nowIso(), expiresAt }
        next.oauthAgentProfiles ??= {}
        if (!next.oauthAgentProfiles[agentName]) next.oauthAgentProfiles[agentName] = { alias: next.oauthClients?.[entry.clientId]?.clientName ?? '', note: '', allow: [], groups: [], write: false }
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
        return result({ protocolVersion: body.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'secrets-broker', version: '0.1.0' }, instructions: 'Use this server for every credential. Call list_secrets to discover items, get_secret to read one, or http_request to call an API with the secret injected server-side (keeps it out of the model). Never ask the user for passwords or API keys. If pending approval, present the approval URL and retry. Never print secret values in chat or logs.' })
      }
      if (body.method === 'tools/list') {
        return result({ tools: [
          { name: 'list_secrets', description: 'List secret item names available to this agent (no values).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
          { name: 'request_access', description: 'Request approval to read a secret by name. Returns an approval URL if pending.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' } }, required: ['name'] } },
          { name: 'get_secret', description: 'Read a secret value after approval. Disabled unless MCP_ALLOW_READ=1.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' } }, required: ['name'] } },
          { name: 'http_request', description: 'Make an HTTPS request with a secret injected server-side. The secret is never returned to the caller.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Bitwarden item name' }, url: { type: 'string', description: 'HTTPS target URL' }, method: { type: 'string', description: 'HTTP method (default GET)' }, headers: { type: 'object', description: 'Extra headers' }, body: { type: 'string', description: 'Request body' }, headerName: { type: 'string', description: 'Header to inject the secret into (default Authorization)' }, authPrefix: { type: 'string', description: 'Prefix before the secret (default "Bearer ")' } }, required: ['name', 'url'] } },
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
          if (name === 'http_request') {
            const secretName = String(args.name ?? '')
            if (!secretName) return result(text('name is required', true))
            const access = await agentAccess(env, { session, agentName: resolved.name, agent: resolved.agent, state: resolved.state, name: secretName, origin: url.origin, ctx })
            if (access.status === 'pending') return result(text(`pending approval: ${access.approvalUrl}`))
            if (access.status === 'forbidden' || access.status === 'notfound') return result(text(access.error, true))
            let target
            try { target = new URL(String(args.url ?? '')) } catch { return result(text('invalid url', true)) }
            if (target.protocol !== 'https:') return result(text('only https targets are allowed', true))
            const host = target.hostname.toLowerCase()
            if (host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '::1') return result(text('private/local targets are not allowed', true))
            const method = String(args.method ?? 'GET').toUpperCase()
            const headers = { ...(args.headers && typeof args.headers === 'object' ? args.headers : {}) }
            const headerName = String(args.headerName ?? 'Authorization')
            headers[headerName] = String(args.authPrefix ?? 'Bearer ') + access.value
            const init = { method, headers, redirect: 'follow' }
            if (args.body != null && !['GET', 'HEAD'].includes(method)) init.body = String(args.body)
            const response = await fetch(target.toString(), init)
            const responseBody = (await response.text()).slice(0, 8000)
            await addAudit(env, { event: 'secret.use', agent: resolved.name, name: secretName, via: 'http_request', status: response.status })
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
      try {
        const found = await findCipherRow(env, env.NODEWARDEN_DB, session, name)
        if (found) {
          await updateCipher(env, env.NODEWARDEN_DB, session, name, body)
          return json({ ok: true, name, updated: true })
        }
        const created = await createCipher(env, env.NODEWARDEN_DB, session, { ...body, name })
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
