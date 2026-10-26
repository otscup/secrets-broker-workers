// Rekeying: re-encrypt every row under a new data key, wipe the tombstones so the
// old key cannot resurrect a deleted secret, and re-sign every live device's
// envelope. Runs the real worker on a real D1.
import { Miniflare } from 'miniflare'
import { readFileSync, readdirSync } from 'node:fs'
import { newDeviceKeypair, unwrapDekDevice, dekFingerprint, openItem } from './src/envelope.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 255).toString('base64')
const ADMIN = 'admin-password-for-tests'
const MASTER = 'correct horse battery staple'
const WRONG = 'this one is also long enough'
const BASE = 'https://broker.test'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  d1Databases: { VAULT_DB: 'v2-rekey-test' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})

const db = await mf.getD1Database('VAULT_DB')
for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    const schema = readFileSync('migrations/' + file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
    for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run()
  }

const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'rekey@example.invalid' }, itemGroups: {}, security: {} }) })

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

// --- seed: two live secrets, one tombstone, one paired device ----------------
await call('/api/v2/init', { method: 'POST', body: { password: MASTER } })
const alpha = await call('/api/v2/items', { method: 'POST', body: { kind: 'api', payload: { name: 'alpha', secret: 'alpha-secret-value' } } })
const beta = await call('/api/v2/items', { method: 'POST', body: { kind: 'web', payload: { name: 'beta', secret: 'beta-secret-value' } } })
const gone = await call('/api/v2/items', { method: 'POST', body: { kind: 'api', payload: { name: 'gone', secret: 'deleted-secret-value' } } })
await call('/api/v2/items/' + gone.body.id, { method: 'DELETE' })
const keypair = await newDeviceKeypair()
const paired = await call('/api/v2/pair', { method: 'POST', body: { name: 'laptop', publicKey: keypair.publicJwk } })
const dekOld = await unwrapDekDevice(paired.body.envelope, keypair.privateJwk)
const fingerprintOld = await dekFingerprint(dekOld)

// K1: a wrong password cannot rotate the key — otherwise the owner would be
// locked out of their own vault.
{
  const { status, body } = await call('/api/v2/rekey', { method: 'POST', body: { password: WRONG } })
  const after = await call('/api/v2/status')
  const ok = status === 400 && /does not open/.test(JSON.stringify(body)) && after.body.revision > 0
  if (ok) pass('K1 rekey refuses a password that does not open the current key')
  else fail('K1', JSON.stringify({ status, body }))
}

// K2: the real rotation.
const rotated = await call('/api/v2/rekey', { method: 'POST', body: { password: MASTER } })

// K3: it reports what it touched, and the fingerprint actually changed.
{
  const body = rotated.body || {}
  const ok = rotated.status === 200 && body.converted === 2 && body.wiped === 1 && body.devices === 1 && body.fingerprint !== fingerprintOld
  if (ok) pass('K2 rekey converts 2 live rows, wipes 1 tombstone, re-signs 1 device, and changes the fingerprint')
  else fail('K2', JSON.stringify({ status: rotated.status, body }))
}

// K4: the vault keeps working without a re-unlock — the in-memory key moved with it.
{
  const { status, body } = await call('/api/v2/items/' + alpha.body.id)
  const ok = status === 200 && body.payload?.secret === 'alpha-secret-value'
  if (ok) pass('K3 the item still reads after rekey, without unlocking again')
  else fail('K3', JSON.stringify({ status, body }))
}

// K5: the decisive one — the key the device already holds is dead.
{
  const rows = await call('/api/v2/items?since=0')
  const live = (rows.body.items || []).find((row) => row.id === alpha.body.id)
  let openWithOld = null
  try { openWithOld = await openItem(dekOld, live.id, live.ciphertext) } catch { openWithOld = null }
  const ok = openWithOld === null
  if (ok) pass('K4 the old device key can no longer open a live row')
  else fail('K4', JSON.stringify({ leaked: openWithOld?.secret }))
}

// K5b: the tombstone carries no trace of the deleted secret.
{
  const rows = await call('/api/v2/items?since=0')
  const tomb = (rows.body.items || []).find((row) => row.id === gone.body.id)
  const text = String(tomb?.ciphertext ?? '')
  const ok = Boolean(tomb) && !text.includes('deleted-secret-value')
  if (ok) pass('K5 the tombstone holds no recoverable copy of the deleted secret')
  else fail('K5', JSON.stringify({ tomb }))
}

// K6: the paired device was re-signed without pairing again, and now holds the
// new key (its keyring envelope unwraps to the fingerprint the rekey reported).
{
  const row = await db.prepare('SELECT envelope FROM keyrings WHERE device_id = ?').bind(paired.body.id).first()
  let deviceKey = null
  try { deviceKey = await unwrapDekDevice(row.envelope, keypair.privateJwk) } catch { deviceKey = null }
  const fingerprintNow = deviceKey ? await dekFingerprint(deviceKey) : null
  const ok = fingerprintNow === rotated.body.fingerprint && fingerprintNow !== fingerprintOld
  if (ok) pass('K6 the paired device is re-signed to the new key without pairing again')
  else fail('K6', JSON.stringify({ fingerprintNow, expected: rotated.body.fingerprint }))
}

// K7: the master password still opens the vault after the rotation (the password
// envelope moved too).
{
  await call('/api/v2/lock', { method: 'POST' })
  const { status } = await call('/api/v2/unlock', { method: 'POST', body: { password: MASTER } })
  const read = await call('/api/v2/items/' + alpha.body.id)
  const ok = status === 200 && read.body.payload?.secret === 'alpha-secret-value'
  if (ok) pass('K7 the master password still unlocks, and the row still decrypts')
  else fail('K7', JSON.stringify({ status, read: read.body }))
}

// K8: while a rekey is in flight nobody reads rows: a peer would cache a row it
// cannot open. The marker is what an interrupted run leaves behind.
{
  await db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('rekey', ?)").bind(JSON.stringify({ to: 'pending', from: 'old', startRevision: 1 })).run()
  const user = await call('/api/v2/items')
  const device = await call('/api/v2/items', { token: paired.body.token, noCookie: true })
  await db.prepare("DELETE FROM meta WHERE key = 'rekey'").run()
  const after = await call('/api/v2/items')
  const ok = user.status === 503 && device.status === 503 && after.status === 200
  if (ok) pass('K8 an interrupted rekey blocks item reads for user and device until it finishes')
  else fail('K8', JSON.stringify({ user: user.status, device: device.status, after: after.status }))
}

// K9: the key generation travels with a pull, so a device notices the rotation
// itself instead of decrypting rows it cannot open.
{
  const pull = await call('/api/v2/items', { token: paired.body.token, noCookie: true })
  const ok = pull.status === 200 && pull.body.keygen === rotated.body.fingerprint && pull.body.device === 'laptop'
  if (ok) pass('K9 a device pull carries the new key generation')
  else fail('K9', JSON.stringify({ keygen: pull.body.keygen, expected: rotated.body.fingerprint }))
}

// K10: and it can fetch its own re-signed envelope with the token it already has.
{
  const self = await call('/api/v2/device/self', { token: paired.body.token, noCookie: true })
  let deviceKey = null
  try { deviceKey = self.body.envelope ? await unwrapDekDevice(self.body.envelope, keypair.privateJwk) : null } catch { deviceKey = null }
  const ok = self.status === 200 && Boolean(deviceKey) && (await dekFingerprint(deviceKey)) === rotated.body.fingerprint
  if (ok) pass('K10 a device fetches its re-signed envelope with the token it already holds')
  else fail('K10', JSON.stringify({ status: self.status, hasKey: Boolean(deviceKey) }))
}

const failed = results.filter((r) => !r.ok).length
console.log(`==== v2 rekey ${results.length - failed}/${results.length} passed ====`)
await mf.dispose()
process.exit(failed ? 1 : 0)
