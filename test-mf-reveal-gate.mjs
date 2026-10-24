// The reveal endpoint was added so that one stolen session cookie is not enough
// to read a password. These cases check that claim against every route that can
// return a password, not just the new one.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr, decryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 33).toString('base64')
const PASS = 'admin-password'
const ITEM = 'reveal-item'
const ITEM_ID = 'item-reveal'
const VALUE = 'REVEAL_SECRET_VALUE'
const TOTP_SEED = 'JBSWY3DPEHPK3PXP'
const ACCT = 'vault@example.invalid'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS, MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS, MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'reveal-db' },
})

const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT, organization_id TEXT)`,
  `INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')`,
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr(VALUE, E, M), totp: await encryptStr(TOTP_SEED, E, M), uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null)
    .run()
}

const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const putState = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })

const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
const wrapped = await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64'))
await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })

await putState({
  agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  settings: { notifications: {}, vaultEmail: ACCT }, capabilities: {}, deniedAttempts: {},
  plaintextReadPolicies: {}, credentialKinds: { [ITEM_ID]: 'api' }, itemIds: { [ITEM]: ITEM_ID },
})

// A real admin cookie, obtained the way a browser obtains it.
const login = await mf.dispatchFetch('https://broker.test/api/login', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }),
})
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
if (cookie) pass('R0 the admin password logs in and yields a cookie')
else fail('R0', 'no cookie: ' + JSON.stringify(login.headers.get('set-cookie')))

// R1: TOTP is not enrolled, so the new reveal endpoint must refuse outright.
{
  const r = await mf.dispatchFetch('https://broker.test/api/secret/reveal', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: ITEM, code: '000000' }),
  })
  const body = await r.text()
  const refused = r.status === 428
  if (refused) pass('R1 reveal without TOTP enrolled refuses with 428')
  else fail('R1', JSON.stringify({ status: r.status, body: body.slice(0, 120) }))
}

// R2: the same cookie must not be a password door through GET /secret. This is
// the route the console used before reveal existed; if it still returns the
// value then the second factor on reveal protects nothing.
{
  const r = await mf.dispatchFetch('https://broker.test/secret?name=' + encodeURIComponent(ITEM), { headers: { cookie } })
  const body = await r.text()
  const leaked = body.includes(VALUE)
  if (!leaked) pass('R2 a cookie alone cannot read a password through GET /secret')
  else fail('R2', JSON.stringify({ status: r.status, leaked, body: body.slice(0, 160) }))
}

// R3: a wrong code must not read even when TOTP is enrolled. The status is
// asserted too: a 500 also "does not leak", and that is exactly how a request
// read twice (stream locked) passed as a refusal before this check existed.
{
  const state = await getState()
  state.security = { ...(state.security || {}), totpEnabled: true, totpSecretWrapped: await wrapWithKek(new TextEncoder().encode(TOTP_SEED), Buffer.from(KEK, 'base64')) }
  await putState(state)
  const r = await mf.dispatchFetch('https://broker.test/api/secret/reveal', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: ITEM, code: '000000' }),
  })
  const body = await r.text()
  if (!body.includes(VALUE) && r.status === 401) pass('R3 a wrong TOTP code is refused with 401')
  else fail('R3', JSON.stringify({ status: r.status, body: body.slice(0, 160) }))
}

// R4: the item list must not hand out the TOTP seed, because that seed is the
// very factor R1/R3 gate the plaintext read on. A cookie that can read the seed
// can mint the code.
{
  const r = await mf.dispatchFetch('https://broker.test/api/items', { headers: { cookie } })
  const body = await r.text()
  const leaked = body.includes(TOTP_SEED)
  if (!leaked) pass('R4 the item list does not expose the TOTP seed')
  else fail('R4', JSON.stringify({ status: r.status, leaked, body: body.slice(0, 160) }))
}

// R5: the editor no longer receives the seed, so a blank field must be read as
// "keep" rather than "erase". Without this the first save silently disarms the
// second factor for that item. The stored field is an EncString, so "not empty"
// proves nothing: an encrypted empty string is also non-empty. Decrypt it.
{
  const r = await mf.dispatchFetch('https://broker.test/api/items/update', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: ITEM, totp: '' }),
  })
  if (r.status !== 200) fail('R5', 'update failed: ' + r.status)
  else {
    const row = await db.prepare('SELECT data FROM ciphers WHERE id = ?').bind(ITEM_ID).first()
    const login = JSON.parse(row.data).login || {}
    const seed = await decryptStr(login.totp || '', Buffer.alloc(32, 1), Buffer.alloc(32, 2)).catch(() => null)
    if (seed === TOTP_SEED) pass('R5 saving the editor with a blank TOTP field keeps the stored seed')
    else fail('R5', 'the seed was wiped by an unchanged save: ' + JSON.stringify(seed))
  }
}

// R6: the export dumps every password in one file, so it must take the same
// second factor. TOTP is enrolled by R3 by now, and no code is sent here.
{
  const r = await mf.dispatchFetch('https://broker.test/api/items/export', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({}),
  })
  const body = await r.text()
  const leaked = body.includes(VALUE)
  if (!leaked) pass('R6 the export refuses a cookie without a TOTP code')
  else fail('R6', JSON.stringify({ status: r.status, leaked, body: body.slice(0, 160) }))
}

// R7: a wrong code must not export either.
{
  const r = await mf.dispatchFetch('https://broker.test/api/items/export', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ code: '000000' }),
  })
  const body = await r.text()
  const leaked = body.includes(VALUE)
  if (!leaked) pass('R7 the export refuses a wrong TOTP code')
  else fail('R7', JSON.stringify({ status: r.status, leaked, body: body.slice(0, 160) }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== reveal gate ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
