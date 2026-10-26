// Device-code pairing: a machine without a browser session asks for a short
// code, an admin approves the same key fingerprint in the browser, and the
// device collects its envelope exactly once.
import { Miniflare } from 'miniflare'
import { readFileSync, readdirSync } from 'node:fs'
import { newDeviceKeypair, unwrapDekDevice, dekFingerprint, publicKeyFingerprint } from './src/envelope.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 254).toString('base64')
const ADMIN = 'admin-password-for-tests'
const MASTER = 'correct horse battery staple'
const BASE = 'https://broker.test'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  d1Databases: { VAULT_DB: 'v2-paircode-test' },
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
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'pair@example.invalid' }, itemGroups: {}, security: {} }) })

const login = await mf.dispatchFetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: ADMIN }) })
const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
if (!cookie) { console.log('FAIL  could not log in as admin'); process.exit(1) }

const call = async (path, options = {}) => {
  const response = await mf.dispatchFetch(BASE + path, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json', ...(options.cookie === null ? {} : { cookie }) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body, headers: response.headers }
}

// Vault has to exist and be unlocked before anything can be approved.
const init = await call('/api/v2/init', { method: 'POST', body: { password: MASTER } })
const keypair = await newDeviceKeypair()

// P1: a machine asks for a code, and gets back a token of its own plus a
// fingerprint to compare on screen.
let request = null
{
  const response = await call('/api/v2/pair/request', { method: 'POST', cookie: null, body: { name: 'pair-test', publicJwk: keypair.publicJwk } })
  request = response.body
  const expected = await publicKeyFingerprint(keypair.publicJwk)
  const ok = init.status === 200 && response.status === 200
    && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(String(response.body.code))
    && String(response.body.pollToken).length >= 40
    && response.body.fingerprint === expected
    && String(response.body.url).includes(encodeURIComponent(response.body.code))
  if (ok) pass('P1 request returns a readable code, a separate poll token and the key fingerprint')
  else fail('P1', JSON.stringify({ init: init.status, status: response.status, body: response.body, expected }))
}

// P2: the short code alone is not a credential — a wrong poll token gets nothing.
{
  const response = await call('/api/v2/pair/poll', { method: 'POST', cookie: null, body: { pollToken: 'not-the-token-the-machine-got-0123456789' } })
  if (response.status === 410) pass('P2 an unknown poll token cannot poll (410)')
  else fail('P2', JSON.stringify(response))
}

// P3: before approval the machine only learns "pending".
{
  const response = await call('/api/v2/pair/poll', { method: 'POST', cookie: null, body: { pollToken: request.pollToken } })
  if (response.status === 202 && response.body.status === 'pending') pass('P3 poll before approval answers 202 pending')
  else fail('P3', JSON.stringify(response))
}

// P4: approval needs an admin session, and a locked vault cannot mint an envelope.
{
  const anonymous = await call('/api/v2/pair/approve', { method: 'POST', cookie: null, body: { code: request.code } })
  await call('/api/v2/lock', { method: 'POST' })
  const locked = await call('/api/v2/pair/approve', { method: 'POST', body: { code: request.code } })
  await call('/api/v2/unlock', { method: 'POST', body: { password: MASTER } })
  if (anonymous.status === 401 && locked.status === 423) pass('P4 approval needs a session (401) and an unlocked vault (423)')
  else fail('P4', JSON.stringify({ anonymous: anonymous.status, locked: locked.status }))
}

// P5: the browser approves, and what it returns names the device, not the key.
let approved = null
{
  approved = await call('/api/v2/pair/approve', { method: 'POST', body: { code: request.code } })
  const ok = approved.status === 200 && approved.body.deviceId && approved.body.name === 'pair-test' && !JSON.stringify(approved.body).includes('private')
  if (ok) pass('P5 approval mints the device and leaks no key material')
  else fail('P5', JSON.stringify(approved))
}

// P6: the machine collects once, and the envelope really opens to the vault key.
{
  const response = await call('/api/v2/pair/poll', { method: 'POST', cookie: null, body: { pollToken: request.pollToken } })
  const body = response.body
  let fingerprint = null
  if (body?.envelope) fingerprint = await dekFingerprint(await unwrapDekDevice(body.envelope, keypair.privateJwk)).catch(() => null)
  const ok = response.status === 200 && body.status === 'approved' && String(body.token).length >= 40
    && fingerprint === init.body.fingerprint
  if (ok) pass('P6 the approved envelope unwraps to the vault key with this machine key')
  else fail('P6', JSON.stringify({ status: response.status, hasEnvelope: Boolean(body?.envelope), fingerprint, vault: init.body.fingerprint }))
}

// P7: one-time redeem — the second poll finds nothing at all.
{
  const response = await call('/api/v2/pair/poll', { method: 'POST', cookie: null, body: { pollToken: request.pollToken } })
  if (response.status === 410) pass('P7 the device token can be collected exactly once')
  else fail('P7', JSON.stringify(response))
}

// P8: the page shows the fingerprint to compare, and requires a session.
{
  const second = await call('/api/v2/pair/request', { method: 'POST', cookie: null, body: { name: 'page-test', publicJwk: keypair.publicJwk } })
  const anonymous = await mf.dispatchFetch(BASE + '/pair?code=' + encodeURIComponent(second.body.code), { redirect: 'manual' })
  const page = await call('/pair?code=' + encodeURIComponent(second.body.code))
  const html = String(page.body)
  const ok = anonymous.status === 302
    && String(anonymous.headers.get('location')).includes('/login')
    && html.includes(second.body.fingerprint)
    && html.includes(second.body.code)
  if (ok) pass('P8 the approval page shows the fingerprint and needs a login')
  else fail('P8', JSON.stringify({ anonymous: anonymous.status, location: anonymous.headers.get('location'), hasFingerprint: html.includes(second.body.fingerprint), code: second.body.code }))
}

// P9: an unknown code cannot be approved, and leaves no device behind.
{
  const before = (await call('/api/v2/devices')).body?.devices?.length ?? 0
  const response = await call('/api/v2/pair/approve', { method: 'POST', body: { code: 'ZZZZ-ZZZZ' } })
  const after = (await call('/api/v2/devices')).body?.devices?.length ?? 0
  if (response.status === 410 && before === after) pass('P9 an unknown code is refused and creates nothing')
  else fail('P9', JSON.stringify({ status: response.status, before, after }))
}

const failed = results.filter((r) => !r.ok).length
console.log(`==== v2 device code pairing ${results.length - failed}/${results.length} passed ====`)
process.exit(failed ? 1 : 0)
