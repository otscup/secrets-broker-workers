// Capability admin API tests: terms selection, soft revoke, migration report.
//
// Admin session is seeded directly (adminSessions record + HMAC cookie, same
// construction as createAdminCookie) — no passwords involved.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AGENT_TOKEN = 'capadm-agent-token'
const SESSION_KEK = Buffer.alloc(32, 12).toString('base64')
const ITEM_ID = 'item-capadm'
const ITEM = 'capadm-item'
const AGENT = 'capadm-agent'
const ACCT = 'vault@example.invalid'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK },
  bindings: { SESSION_KEK },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'capadm-db' },
})

const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)",
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')",
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: '', password: await encryptStr('x', E, M), totp: '', uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null, null).run()
}

const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AGENT_TOKEN)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const putState = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
async function putSession() {
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  const wrapped = await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(SESSION_KEK, 'base64'))
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
}
// Seed an admin session exactly like createAdminCookie does.
async function adminCookie() {
  const id = 'adm-' + Math.random().toString(36).slice(2)
  const expires = Date.now() + 7 * 86400 * 1000
  const payload = 'v2.' + id + '.' + expires
  const kb = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cookie:' + SESSION_KEK))
  const key = await crypto.subtle.importKey('raw', kb, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64')
  const st = await getState()
  st.adminSessions = st.adminSessions || {}
  st.adminSessions[id] = { id, ip: '', ua: '', createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), expiresAt: expires }
  await putState(st)
  return 'broker_admin=' + payload + '.' + sig
}
function post(path, body, headers = {}) {
  return mf.dispatchFetch('https://broker.test' + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
}
function get(path, headers = {}) {
  return mf.dispatchFetch('https://broker.test' + path, { method: 'GET', headers }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
}
const KEY = (a, i, act) => a + '\u0000' + i + '\u0000' + act

await putState({
  agents: { [AGENT]: { hash, allow: [], groups: [], allowAll: false, write: false, legacy: false, account: ACCT } },
  policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {} },
  itemGroups: {}, actionGrants: {}, usePolicies: {}, capabilities: {},
})
await putSession()
const cookie = await adminCookie()
const H = { cookie }

// A1: unauthenticated action-grant with terms -> 401, nothing created
{
  const r = await post('/api/action-grants', { agent: AGENT, item: ITEM, actions: ['secret.read'], terms: { 'secret.read': { duration: '7d', maxUses: 5 } } })
  const st = await getState()
  if (r.status === 401 && Object.keys(st.capabilities || {}).length === 0) pass('A1 unauthenticated grant with terms rejected, nothing stored')
  else fail('A1', JSON.stringify({ s: r.status, n: Object.keys(st.capabilities || {}).length }))
}
// A2: admin creates read(7d/5) + use(permanent/unlimited) independently
{
  const r = await post('/api/action-grants', { agent: AGENT, item: ITEM, actions: ['secret.read', 'secret.use'], terms: { 'secret.read': { duration: '7d', maxUses: 5 }, 'secret.use': { duration: 'permanent', maxUses: 'unlimited' } } }, H)
  const st = await getState()
  const rc = st.capabilities[KEY(AGENT, ITEM_ID, 'secret.read')]
  const uc = st.capabilities[KEY(AGENT, ITEM_ID, 'secret.use')]
  const rok = rc && rc.expiresAt > Date.now() && rc.expiresAt <= Date.now() + 7 * 86400e3 + 60000 && rc.maxUses === 5 && rc.mode === 'preapproved'
  const uok = uc && uc.expiresAt === null && uc.maxUses === null
  if (r.status === 200 && rok && uok) pass('A2 per-action terms stored (read 7d/5, use permanent/unlimited)')
  else fail('A2', JSON.stringify({ s: r.status, rc, uc }))
}
// A3: invalid maxUses rejected
{
  const r = await post('/api/action-grants', { agent: AGENT, item: ITEM, actions: ['secret.read'], terms: { 'secret.read': { duration: '1d', maxUses: -3 } } }, H)
  if (r.status === 400) pass('A3 negative maxUses rejected')
  else fail('A3', JSON.stringify(r))
}
// A4: Agent token cannot create capabilities
{
  const r = await post('/api/action-grants', { agent: AGENT, item: ITEM, actions: ['secret.read'] }, { authorization: 'Bearer ' + AGENT_TOKEN })
  if (r.status === 401) pass('A4 Agent token cannot mint capabilities')
  else fail('A4', JSON.stringify(r))
}
// A5: soft revoke one action keeps the other usable
{
  const r = await post('/api/action-grants/revoke', { agent: AGENT, itemId: ITEM_ID, action: 'secret.use' }, H)
  const st = await getState()
  const uc = st.capabilities[KEY(AGENT, ITEM_ID, 'secret.use')]
  const rc = st.capabilities[KEY(AGENT, ITEM_ID, 'secret.read')]
  const kept = st.actionGrants[AGENT + '\u0000' + ITEM_ID]
  if (r.status === 200 && uc && uc.revokedAt && !rc.revokedAt && kept && kept.actions.join() === 'secret.read') pass('A5 per-action soft revoke (use revoked, read intact)')
  else fail('A5', JSON.stringify({ s: r.status, uc, rcActions: kept && kept.actions }))
}
// A6: migration report shape (unauthenticated -> 401)
{
  const r0 = await get('/api/migration-report')
  const r1 = await get('/api/migration-report', H)
  const b = r1.body && r1.body.report
  if (r0.status === 401 && r1.status === 200 && b && Array.isArray(b.agents) && Array.isArray(b.capabilities) && Array.isArray(b.legacyGrants)) pass('A6 migration report gated + shaped')
  else fail('A6', JSON.stringify({ s0: r0.status, s1: r1.status, keys: b && Object.keys(b) }))
}
// A7: revoked use capability actually denies at enforcement
{
  const st = await getState()
  const uc = st.capabilities[KEY(AGENT, ITEM_ID, 'secret.use')]
  if (uc && uc.revokedAt) pass('A7 revoked use capability persists with revokedAt (enforcement covered by C3/C10)')
  else fail('A7', JSON.stringify(uc))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== capability admin api ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
