// The v2 vault over HTTP: init, unlock, sealed items, tombstones and the
// revision cursor. Runs the real worker against a real D1, so the SQL and the
// crypto both have to be right.
import { Miniflare } from 'miniflare'
import { readFileSync } from 'node:fs'

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
  d1Databases: { VAULT_DB: 'v2-api-test' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})

// Apply the migration the way the deploy does: comments out, statements in.
const db = await mf.getD1Database('VAULT_DB')
const schema = readFileSync('migrations/0001_v2_start.sql', 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()

const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'v2@example.invalid' }, itemGroups: {}, security: {} }) })

const login = await mf.dispatchFetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: ADMIN }) })
const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
if (!cookie) { console.log('FAIL  could not log in as admin'); process.exit(1) }

const call = async (path, options = {}) => {
  const response = await mf.dispatchFetch(BASE + path, {
    method: options.method || 'GET',
    headers: { cookie, 'content-type': 'application/json' },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

// V1: a fresh database reports itself empty and locked.
{
  const { status, body } = await call('/api/v2/status')
  const ok = status === 200 && body.initialized === false && body.revision === 0 && body.unlocked === false
  if (ok) pass('V1 a fresh vault reports uninitialised, revision 0 and locked')
  else fail('V1', JSON.stringify({ status, body }))
}

// V2: a password short enough to guess is refused before it becomes a keyring.
{
  const { status } = await call('/api/v2/init', { method: 'POST', body: { password: 'short' } })
  if (status === 400) pass('V2 initialising refuses a short password')
  else fail('V2', 'status ' + status)
}

// V3: initialising creates the password envelope and unlocks in place.
{
  const { status, body } = await call('/api/v2/init', { method: 'POST', body: { password: MASTER } })
  const ok = status === 200 && /^[0-9a-f]{12}$/.test(body.fingerprint || '')
  if (ok) pass('V3 initialising mints a data key and reports its fingerprint')
  else fail('V3', JSON.stringify({ status, body }))
}

// V4: it cannot be done twice, or the first key's items would be orphaned.
{
  const { status } = await call('/api/v2/init', { method: 'POST', body: { password: 'another-long-password' } })
  if (status === 400) pass('V4 initialising twice is refused')
  else fail('V4', 'status ' + status)
}

// V5: locked means no writes. The key lives in the object's memory, so this is
// what a restart looks like.
{
  await call('/api/v2/lock', { method: 'POST' })
  const { status } = await call('/api/v2/items', { method: 'POST', body: { kind: 'api', payload: { name: 'x' } } })
  if (status === 423) pass('V5 a locked vault refuses to write')
  else fail('V5', 'status ' + status)
}

// V6: a wrong master password does not unlock, and does not leave a key behind.
{
  const { status } = await call('/api/v2/unlock', { method: 'POST', body: { password: 'not the password' } })
  const after = await call('/api/v2/status')
  const ok = status === 401 && after.body.unlocked === false
  if (ok) pass('V6 a wrong password is refused and nothing is left unlocked')
  else fail('V6', JSON.stringify({ status, unlocked: after.body.unlocked }))
}

// V7: the right password unlocks, and a write lands at revision 1.
let itemId = ''
{
  const unlocked = await call('/api/v2/unlock', { method: 'POST', body: { password: MASTER } })
  const created = await call('/api/v2/items', { method: 'POST', body: { kind: 'api', payload: { name: 'openai', secret: 'sk-test-123' } } })
  itemId = created.body.id || ''
  const ok = unlocked.status === 200 && created.status === 201 && created.body.revision === 1 && itemId
  if (ok) pass('V7 unlock then write produces revision 1')
  else fail('V7', JSON.stringify({ unlocked: unlocked.status, created }))
}

// V8: what the sync endpoint hands out is ciphertext. This is the whole claim.
{
  const { body } = await call('/api/v2/items?since=0')
  const row = (body.items || [])[0] || {}
  const ok = row.ciphertext && !String(row.ciphertext).includes('sk-test-123') && !String(row.ciphertext).includes('openai')
  if (ok) pass('V8 the sync rows carry ciphertext, not the credential')
  else fail('V8', JSON.stringify(row).slice(0, 200))
}

// V9: the unlocked holder of the key gets the credential back.
{
  const { status, body } = await call('/api/v2/items/' + itemId)
  const ok = status === 200 && body.payload?.secret === 'sk-test-123' && body.payload?.name === 'openai'
  if (ok) pass('V9 an unlocked read returns the credential')
  else fail('V9', JSON.stringify({ status, body }))
}

// V10: updating without a payload keeps the fields the caller cannot see.
{
  const updated = await call('/api/v2/items/' + itemId, { method: 'PUT', body: { kind: 'web' } })
  const read = await call('/api/v2/items/' + itemId)
  const ok = updated.status === 200 && read.body.payload?.secret === 'sk-test-123' && read.body.kind === 'web'
  if (ok) pass('V10 an update without a payload keeps the credential and can change its kind')
  else fail('V10', JSON.stringify({ updated: updated.body, read: read.body }))
}

// V11: deleting leaves a tombstone the peer can see, and reads stop working.
{
  const deleted = await call('/api/v2/items/' + itemId, { method: 'DELETE' })
  const list = await call('/api/v2/items?since=0')
  const read = await call('/api/v2/items/' + itemId)
  const tombstone = (list.body.items || []).find((row) => row.id === itemId)
  const ok = deleted.status === 200 && tombstone?.deletedAt && read.status === 404
  if (ok) pass('V11 a deletion travels as a tombstone and the item stops reading')
  else fail('V11', JSON.stringify({ deleted: deleted.status, tombstone, read: read.status }))
}

// V12: the revision only moves forward, so `since` is a usable cursor.
{
  const list = await call('/api/v2/items?since=2')
  const rows = list.body.items || []
  const ok = list.body.revision >= 3 && rows.every((row) => row.revision > 2)
  if (ok) pass('V12 asking since a revision returns only newer rows')
  else fail('V12', JSON.stringify(list.body).slice(0, 200))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== v2 api ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
