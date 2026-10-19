import { DurableObject } from 'cloudflare:workers'
import { uiHtml } from './ui.js'
import {
  b64ToBytes, constantTimeEqual, decryptCipherRow, extractSecret,
  hmacToken, unwrapWithKek, wrapWithKek,
} from './crypto.js'

const encoder = new TextEncoder()
const SESSION_COOKIE = 'broker_admin'
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers })
const fail = (message, status = 400) => json({ error: message }, status)

export class BrokerState extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url)
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
        const body = await request.json()
        await this.ctx.storage.put('session', body)
        return json({ ok: true })
      }
      if (request.method === 'DELETE') {
        await this.ctx.storage.delete('session')
        return json({ ok: true })
      }
    }
    if (url.pathname === '/audit') {
      if (request.method === 'POST') {
        const entry = await request.json()
        const current = (await this.ctx.storage.get('audit')) ?? []
        current.unshift(entry)
        await this.ctx.storage.put('audit', current.slice(0, 500))
        return json({ ok: true })
      }
      if (request.method === 'GET') {
        return json({ entries: (await this.ctx.storage.get('audit')) ?? [] })
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

async function getSession(env) {
  const response = await stateStub(env).fetch('https://state/session')
  const payload = await response.json()
  if (!payload.session) return null
  try {
    const plain = await unwrapWithKek(payload.session.wrapped, await kekBytes(env))
    const session = JSON.parse(new TextDecoder().decode(plain))
    if (session.expiresAt && session.expiresAt < Date.now()) return null
    return session
  } catch {
    return null
  }
}

async function putSession(env, session) {
  const plain = encoder.encode(JSON.stringify(session))
  const wrapped = await wrapWithKek(plain, await kekBytes(env))
  await stateStub(env).fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: session.expiresAt ?? 0 }) })
}

async function audit(env, entry) {
  try {
    await stateStub(env).fetch('https://state/audit', { method: 'POST', body: JSON.stringify({ time: new Date().toISOString(), ...entry }) })
  } catch {}
}

async function adminAuthorized(request, env) {
  return validCookie(request, env)
}

async function agentAuthorized(request, env) {
  if (await adminAuthorized(request, env)) return true
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match || !env.AGENT_TOKEN) return false
  return constantTimeEqual(encoder.encode(match[1]), encoder.encode(env.AGENT_TOKEN))
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

async function listCiphers(env, db, session) {
  const user = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(session.email).first()
  if (!user) throw new Error('vault user not found')
  const result = await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC').bind(user.id).all()
  const items = []
  for (const row of result.results ?? []) {
    try {
      const decrypted = await decryptCipherRow(row, session)
      items.push({ id: row.id, type: decrypted.type, name: decrypted.name || '(未命名)', url: cipherUrl(decrypted.data), folderId: row.folder_id ?? null })
    } catch {}
  }
  return items
}

async function readSecret(env, db, session, name) {
  const user = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(session.email).first()
  if (!user) throw new Error('vault user not found')
  const rows = await db.prepare('SELECT id, user_id, type, folder_id, name, notes, data, key FROM ciphers WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL').bind(user.id).all()
  for (const candidate of rows.results ?? []) {
    const decrypted = await decryptCipherRow(candidate, session)
    if (decrypted.name !== name) continue
    return { value: extractSecret(decrypted), type: decrypted.type, url: cipherUrl(decrypted.data) }
  }
  return null
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(uiHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
    }
    if (url.pathname === '/api/status') {
      return json({ ok: true, name: 'secrets-broker-workers', bindings: { d1: Boolean(env.NODEWARDEN_DB), durableObject: Boolean(env.BROKER_STATE), agentToken: Boolean(env.AGENT_TOKEN) } })
    }
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      if (!env.ADMIN_PASSWORD) return fail('ADMIN_PASSWORD is not configured', 500)
      const match = constantTimeEqual(encoder.encode(String(body.password ?? '')), encoder.encode(env.ADMIN_PASSWORD))
      if (!match) {
        await audit(env, { event: 'admin.login-fail' })
        return fail('密码错误', 401)
      }
      const cookie = await makeCookie(env)
      await audit(env, { event: 'admin.login' })
      return json({ ok: true }, 200, { 'set-cookie': `${SESSION_COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` })
    }
    if (url.pathname === '/api/me') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      return json({ email: env.VAULT_EMAIL || (session && session.email) || '', unlocked: Boolean(session), expiresAt: session && session.expiresAt ? session.expiresAt : 0 })
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
        await audit(env, { event: 'vault.unlock', email, ttl: body.ttl ?? '24h' })
        return json({ ok: true, expiresAt, permanent: ttl === 0 })
      } catch (error) { return fail(String(error.message ?? error), 400) }
    }
    if (url.pathname === '/api/lock' && request.method === 'POST') {
      await stateStub(env).fetch('https://state/session', { method: 'DELETE' })
      await audit(env, { event: 'vault.lock' })
      return json({ ok: true })
    }
    if (url.pathname === '/api/ciphers') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('locked', 423)
      try { return json({ items: await listCiphers(env, env.NODEWARDEN_DB, session) }) } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/secret') {
      if (!(await agentAuthorized(request, env))) return fail('unauthorized', 401)
      const session = await getSession(env)
      if (!session) return fail('vault locked', 423)
      const name = url.searchParams.get('name') ?? ''
      if (!name) return fail('name required', 400)
      try {
        const result = await readSecret(env, env.NODEWARDEN_DB, session, name)
        if (!result) return fail('not found', 404)
        await audit(env, { event: 'secret.read', name, via: request.headers.get('authorization') ? 'agent' : 'web' })
        return json({ value: result.value })
      } catch (error) { return fail(String(error.message ?? error), 500) }
    }
    if (url.pathname === '/api/audit') {
      if (!(await adminAuthorized(request, env))) return fail('unauthorized', 401)
      const response = await stateStub(env).fetch('https://state/audit')
      return json(await response.json())
    }
    return fail('not found', 404)
  },
}
