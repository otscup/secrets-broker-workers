// Push/pull from a device: the rows travel sealed, so the server hands back
// ciphertext and takes ciphertext. Proves a paired machine can round-trip a
// secret without the server ever holding the key, and that a device that was
// not approved for writing is refused.
import { Miniflare } from 'miniflare'
import { readFileSync } from 'node:fs'
import { newDeviceKeypair, unwrapDekDevice, sealItem, openItem } from './src/envelope.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 255).toString('base64')
const ADMIN = 'admin-password-for-tests'
const MASTER = 'correct horse battery staple'
const BASE = 'https://broker.test'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  d1Databases: { VAULT_DB: 'v2-pushpull-test' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})

const db = await mf.getD1Database('VAULT_DB')
for (const file of ['migrations/0001_v2_start.sql', 'migrations/0002_v2_device_write.sql']) {
  const schema = readFileSync(file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
}

const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'pushpull@example.invalid' }, itemGroups: {}, security: {} }) })

const login = await mf.dispatchFetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: ADMIN }) })
const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
if (!cookie) { console.log('FAIL  could not log in as admin'); process.exit(1) }

const call = async (path, options = {}) => {
  const response = await mf.dispatchFetch(BASE + path, {
    method: options.method || 'GET',
    headers: { ...(options.noCookie ? {} : { cookie }), ...(options.token ? { authorization: 'Bearer ' + options.token } : {}), 'content-type': 'application/json' },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

await call('/api/v2/init', { method: 'POST', body: { password: MASTER } })
const seeded = await call('/api/v2/items', { method: 'POST', body: { kind: 'api', payload: { name: 'alpha', secret: 'alpha-secret-value' } } })

const keypair = await newDeviceKeypair()
const laptop = await call('/api/v2/pair', { method: 'POST', body: { name: 'laptop', publicKey: keypair.publicJwk } })
const token = laptop.body.token
const dek = await unwrapDekDevice(laptop.body.envelope, keypair.privateJwk)

// P1: a device pulls ciphertext only — the plaintext is nowhere in the response.
{
  const { status, body } = await call('/api/v2/items', { token, noCookie: true })
  const raw = JSON.stringify(body)
  const row = (body.items || [])[0] || {}
  const opens = row.ciphertext ? await openItem(dek, row.id, row.ciphertext).catch(() => null) : null
  const ok = status === 200 && !raw.includes('alpha-secret-value') && opens?.secret === 'alpha-secret-value'
  if (ok) pass('P1 a device pulls sealed rows and opens them with its own key')
  else fail('P1', JSON.stringify({ status, hasPlaintext: raw.includes('alpha-secret-value'), opens }))
}

// P2: it pushes a new row it sealed itself; the admin sees it without the device
// ever sending plaintext.
{
  const payload = { name: 'gamma', secret: 'gamma-secret-value' }
  const id = 'item-gamma'
  const sealed = await sealItem(dek, id, payload)
  const pushed = await call('/api/v2/push', { method: 'POST', token, body: { items: [{ id, kind: 'api', ciphertext: sealed }] } })
  const after = await call('/api/v2/items')
  const row = (after.body.items || []).find((item) => item.id === id)
  const opens = row ? await openItem(dek, row.id, row.ciphertext).catch(() => null) : null
  const ok = pushed.status === 200 && pushed.body.written === 1 && opens?.secret === 'gamma-secret-value'
  if (ok) pass('P2 a device pushes a sealed row and the vault reads it back')
  else fail('P2', JSON.stringify({ pushed, found: Boolean(row), opens }))
}

// P3: a tombstone travels the same way.
{
  const pushed = await call('/api/v2/push', { method: 'POST', token, body: { items: [{ id: seeded.body.id, kind: 'api', ciphertext: '', deletedAt: new Date().toISOString() }] } })
  const after = await call('/api/v2/items')
  const row = (after.body.items || []).find((item) => item.id === seeded.body.id)
  const ok = pushed.status === 200 && row?.deletedAt
  if (ok) pass('P3 a device can bury a row, and it comes back as a tombstone')
  else fail('P3', JSON.stringify({ pushed, row }))
}

// P4: a device the owner did not approve for writing is refused, even with a
// valid token.
{
  await db.prepare('UPDATE devices SET can_write = 0 WHERE name = ?').bind('laptop').run()
  const sealed = await sealItem(dek, 'item-blocked', { name: 'blocked', secret: 'blocked-value' })
  const pushed = await call('/api/v2/push', { method: 'POST', token, body: { items: [{ id: 'item-blocked', kind: 'api', ciphertext: sealed }] } })
  const ok = pushed.status === 403 && !((await call('/api/v2/items')).body.items || []).some((item) => item.id === 'item-blocked')
  if (ok) pass('P4 a read-only device cannot write')
  else fail('P4', JSON.stringify(pushed))
}

// P5: no token, no push.
{
  const pushed = await call('/api/v2/push', { method: 'POST', noCookie: true, body: { items: [{ id: 'x', ciphertext: 'y' }] } })
  const ok = pushed.status === 401
  if (ok) pass('P5 push without a device token is refused')
  else fail('P5', JSON.stringify(pushed))
}

// P6: a revoked device's token stops working for both directions.
{
  await db.prepare('UPDATE devices SET can_write = 1, revoked_at = ? WHERE name = ?').bind(new Date().toISOString(), 'laptop').run()
  const pulled = await call('/api/v2/items', { token, noCookie: true })
  const pushed = await call('/api/v2/push', { method: 'POST', token, body: { items: [{ id: 'after-revoke', ciphertext: 'x' }] } })
  const ok = pulled.status === 401 && pushed.status === 401
  if (ok) pass('P6 revoking a device stops pull and push together')
  else fail('P6', JSON.stringify({ pulled: pulled.status, pushed: pushed.status }))
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `${failed.length} FAILED` : 'ALL PASSED')
process.exit(failed.length ? 1 : 0)
