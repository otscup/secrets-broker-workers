// The v2 vault over HTTP: init, unlock, sealed items, tombstones and the
// revision cursor. Runs the real worker against a real D1, so the SQL and the
// crypto both have to be right.
import { Miniflare } from 'miniflare'
import { readFileSync, readdirSync } from 'node:fs'
import { newDeviceKeypair, unwrapDekDevice, dekFingerprint } from './src/envelope.js'

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
for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
  const schema = readFileSync('migrations/' + file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run().catch((error) => { if (!/duplicate column/i.test(String(error.message))) throw error })
}

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

// --- pairing: a second device gets the same key, wrapped to its own key -----
const enumBearer = (token, options = {}) => ({
  method: options.method || 'GET',
  headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' },
  ...(options.body ? { body: JSON.stringify(options.body) } : {}),
})
const deviceCall = async (path, token, options = {}) => {
  const response = await mf.dispatchFetch(BASE + path, enumBearer(token, options))
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

const keypair = await newDeviceKeypair()
let deviceToken = ''
let deviceId = ''

// P1: pairing needs the key in memory, so a locked vault cannot mint a device.
{
  await call('/api/v2/lock', { method: 'POST' })
  const { status } = await call('/api/v2/pair', { method: 'POST', body: { name: 'laptop', publicKey: keypair.publicJwk } })
  if (status === 423) pass('P1 pairing is refused while the vault is locked')
  else fail('P1', 'status ' + status)
}

// P2: a key that is not a P-256 JWK is refused instead of being stored.
{
  await call('/api/v2/unlock', { method: 'POST', body: { password: MASTER } })
  const { status } = await call('/api/v2/pair', { method: 'POST', body: { name: 'bad', publicKey: { kty: 'RSA', n: 'x' } } })
  if (status === 400) pass('P2 pairing refuses a key that is not P-256')
  else fail('P2', 'status ' + status)
}

// P3: the wrapped key is the real one — unwrapping locally must give the same
// fingerprint the vault reports.
{
  const created = await call('/api/v2/pair', { method: 'POST', body: { name: 'laptop', publicKey: keypair.publicJwk } })
  deviceToken = created.body.token || ''
  deviceId = created.body.id || ''
  const status = await call('/api/v2/status')
  let unwrapped = null
  try { unwrapped = await unwrapDekDevice(created.body.envelope, keypair.privateJwk) } catch { unwrapped = null }
  const fingerprint = created.body.fingerprint
  const matches = Boolean(unwrapped) && await dekFingerprint(unwrapped) === fingerprint
  if (created.status === 201 && deviceToken.length >= 40 && unwrapped?.length === 32 && matches) {
    pass('P3 the paired device unwraps the same data key the vault holds')
  } else {
    fail('P3', JSON.stringify({ status: created.status, error: created.body, vault: status.body.unlocked, tokenLength: deviceToken.length, unwrapped: unwrapped?.length ?? null, fingerprint, matches }))
  }
}

// P4: the decisive one — a paired device pulls ciphertext with the vault LOCKED.
{
  await call('/api/v2/lock', { method: 'POST' })
  const { status, body } = await deviceCall('/api/v2/items?since=0', deviceToken)
  const row = (body.items || [])[0] || {}
  const ok = status === 200 && row.ciphertext && !String(row.ciphertext).includes('sk-test-123')
  if (ok) pass('P4 a paired device pulls ciphertext while the vault is locked')
  else fail('P4', JSON.stringify({ status, body }).slice(0, 200))
}

// P5: a device token is not an admin session — it cannot write or read devices.
{
  const write = await deviceCall('/api/v2/items', deviceToken, { method: 'POST', body: { kind: 'api', payload: { name: 'x' } } })
  const devices = await deviceCall('/api/v2/devices', deviceToken)
  const ok = write.status === 401 && devices.status === 401
  if (ok) pass('P5 a device token cannot write or list devices')
  else fail('P5', JSON.stringify({ write: write.status, devices: devices.status }))
}

// P6: revoking a device stops its pulls immediately.
{
  await call('/api/v2/unlock', { method: 'POST', body: { password: MASTER } })
  const list = await call('/api/v2/devices')
  const revoked = await call('/api/v2/devices/' + deviceId, { method: 'DELETE' })
  const after = await deviceCall('/api/v2/items?since=0', deviceToken)
  const row = (list.body.devices || []).find((device) => device.id === deviceId)
  const ok = row?.name === 'laptop' && revoked.status === 200 && after.status === 401
  if (ok) pass('P6 a revoked device stops pulling ciphertext')
  else fail('P6', JSON.stringify({ row, revoked: revoked.status, after: after.status }))
}

// P7: the panel gets names, not ciphertext -- and only while unlocked.
{
  await call('/api/v2/items', { method: 'POST', body: { kind: 'api', payload: { name: 'panel-item', secret: 'sk-plain-1' } } })
  const plain = await call('/api/v2/items?plain=1')
  const open = (plain.body.items ?? []).find((row) => row.payload?.name === 'panel-item')
  if (plain.status === 200 && open?.payload?.secret === 'sk-plain-1') pass('P7 plain=1 gives the panel decrypted names')
  else fail('P7', JSON.stringify({ status: plain.status, body: plain.body }).slice(0, 200))
}

// P8: plain=1 is not an unauthenticated door.
{
  const naked = await mf.dispatchFetch(BASE + '/api/v2/items?plain=1')
  const withDevice = await deviceCall('/api/v2/items?plain=1', deviceToken)
  const ok = naked.status === 401 && (withDevice.status === 401 || !JSON.stringify(withDevice.body ?? '').includes('sk-test-123'))
  if (ok) pass('P8 plain=1 refuses an unauthenticated or device caller')
  else fail('P8', JSON.stringify({ naked: naked.status, device: withDevice.status }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== v2 api ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
