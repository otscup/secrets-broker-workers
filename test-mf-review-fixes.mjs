// Independent review regression tests: legacy bypass, resurrection,
// use-synthesis, approval-action binding, lifecycle, account isolation.
//
// Drives the REAL Worker + DO under Miniflare with synthetic data only.
// Every assertion checks behaviour (plaintext presence/absence) AND state
// (capability counters/status untouched or advanced exactly once).
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'review-agent-token'
const SESSION_KEK = Buffer.alloc(32, 21).toString('base64')
const SECRET = 'REVIEW-PLAINTEXT-k7q2'
const ITEM_ID = 'item-review'
const ITEM = 'review-item'
const AGENT = 'review-agent'
const ACCT = 'vault@example.invalid'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK, MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'review-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)",
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')",
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: '', password: await encryptStr(SECRET, E, M), totp: '', uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null, null).run()
}
const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const putState = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
async function putSession() {
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  const wrapped = await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(SESSION_KEK, 'base64'))
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
}
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
function mcp(tool, args) {
  return mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST', headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}
function post(path, body, headers = {}) {
  return mf.dispatchFetch('https://broker.test' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
}
function get(path, headers = {}) {
  return mf.dispatchFetch('https://broker.test' + path, { method: 'GET', headers }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
}
const textOf = (r) => r.body?.result?.content?.[0]?.text ?? ''
const CK = (a) => a + '\u0000' + ITEM_ID + '\u0000secret.read'
const UK = (a) => a + '\u0000' + ITEM_ID + '\u0000secret.use'
const GK = (a) => a + '\u0000' + ITEM
const AG = { [AGENT]: { hash, allow: [], groups: [], allowAll: false, write: false, legacy: true, account: ACCT } }
function base(extra = {}) {
  return { agents: structuredClone(AG), policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {} }, itemGroups: {}, actionGrants: {}, usePolicies: {}, capabilities: {}, itemIds: { [ITEM]: ITEM_ID }, ...extra }
}
const NAP = () => ({ [ITEM]: { noApproval: true } })
const POL = { [ITEM_ID]: { itemId: ITEM_ID, accountId: ACCT, hosts: ['api.example.invalid'], methods: ['GET'], pathPrefixes: ['/'], ports: ['443'] } }

// R1: legacy + VALID capability -> plaintext + consume advances exactly once
{
  await putState(base({ policies: NAP(), capabilities: { [CK(AGENT)]: { id: CK(AGENT), subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 } } }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const st = await getState()
  if (textOf(r).includes(SECRET) && st.capabilities[CK(AGENT)].usedCount === 1) pass('R1 legacy + valid capability: plaintext, usedCount 0->1')
  else fail('R1', JSON.stringify({ t: textOf(r).slice(0, 60), u: st.capabilities[CK(AGENT)]?.usedCount }))
}
// R2: legacy + EXPIRED capability -> denied, no plaintext, no legacy resurrection
{
  await putState(base({ policies: NAP(), capabilities: { [CK(AGENT)]: { id: CK(AGENT), subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: Date.now() - 1000, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 } } }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const st = await getState()
  if (!textOf(r).includes(SECRET) && /expired|not allowed|denied|no longer valid/i.test(textOf(r)) && st.capabilities[CK(AGENT)].usedCount === 0) pass('R2 legacy + expired: denied, counter untouched')
  else fail('R2', textOf(r).slice(0, 100))
}
// R3: legacy + REVOKED capability -> denied
{
  const c = { id: CK(AGENT), subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: null, maxUses: null, usedCount: 3, revokedAt: new Date().toISOString(), revokedBy: 'admin:t', approvalId: null, policyVersion: 1 }
  await putState(base({ policies: NAP(), capabilities: { [CK(AGENT)]: c } }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const st = await getState()
  if (!textOf(r).includes(SECRET) && st.capabilities[CK(AGENT)].usedCount === 3) pass('R3 legacy + revoked: denied, counter untouched')
  else fail('R3', textOf(r).slice(0, 100))
}
// R4: legacy + EXHAUSTED tombstone -> denied, no resurrection
{
  const c = { id: CK(AGENT), subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: null, maxUses: 1, usedCount: 1, exhaustedAt: new Date().toISOString(), revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await putState(base({ policies: NAP(), capabilities: { [CK(AGENT)]: c }, grants: { [GK(AGENT)]: { agent: AGENT, name: ITEM, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: 5, revokedAt: null, account: ACCT } } }))
  await putSession()
  const out = await Promise.all(Array.from({ length: 5 }, () => mcp('get_secret', { name: ITEM })))
  const wins = out.filter((r) => textOf(r).includes(SECRET)).length
  const st = await getState()
  const tomb = st.capabilities[CK(AGENT)]
  if (wins === 0 && tomb && tomb.usedCount === 1) pass('R4 legacy + exhausted tomb + live old grant: 0 plaintext, no resurrection')
  else fail('R4', 'wins=' + wins + ' tomb=' + JSON.stringify(tomb))
}
// R5: old grant maxReads=5 + capability maxUses=1 -> 1 win then all fail, no regen
{
  await putState(base({ policies: NAP(), capabilities: { [CK(AGENT)]: { id: CK(AGENT), subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: null, maxUses: 1, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 } }, grants: { [GK(AGENT)]: { agent: AGENT, name: ITEM, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: 5, revokedAt: null, account: ACCT } } }))
  await putSession()
  const first = await mcp('get_secret', { name: ITEM })
  const rest = await Promise.all(Array.from({ length: 4 }, () => mcp('get_secret', { name: ITEM })))
  const wins = [first, ...rest].filter((r) => textOf(r).includes(SECRET)).length
  const st = await getState()
  const tomb = st.capabilities[CK(AGENT)]
  if (wins === 1 && tomb && tomb.usedCount === 1 && typeof tomb.exhaustedAt === 'string') pass('R5 maxReads=5 vs maxUses=1: 1 win, tombstone, no regen')
  else fail('R5', 'wins=' + wins + ' tomb=' + JSON.stringify(tomb))
}
// R6: concurrent resurrection race — 20-way on tombstoned key, 0 wins
{
  const c = { id: CK(AGENT), subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: null, maxUses: 1, usedCount: 1, exhaustedAt: new Date().toISOString(), revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await putState(base({ policies: NAP(), capabilities: { [CK(AGENT)]: c }, grants: { [GK(AGENT)]: { agent: AGENT, name: ITEM, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT } } }))
  await putSession()
  const out = await Promise.all(Array.from({ length: 20 }, () => mcp('get_secret', { name: ITEM })))
  const wins = out.filter((r) => textOf(r).includes(SECRET)).length
  if (wins === 0) pass('R6 20-way on tombstone: 0 plaintext')
  else fail('R6', 'wins=' + wins)
}
// R7: old grant only + matching usePolicy, no use capability -> http_request denied
{
  await putState(base({ policies: NAP(), usePolicies: POL, grants: { [GK(AGENT)]: { agent: AGENT, name: ITEM, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT } } }))
  await putSession()
  const r = await mcp('http_request', { name: ITEM, url: 'https://api.example.invalid/', method: 'GET' })
  const st = await getState()
  const synth = st.capabilities[UK(AGENT)]
  if (!JSON.stringify(r.body).includes(SECRET) && /denied|not allowed|no-capability|pending/i.test(textOf(r)) && !synth) pass('R7 old grant + usePolicy, no use-cap: denied, no synthesis')
  else fail('R7', JSON.stringify({ t: textOf(r).slice(0, 80), synth: !!synth }))
}
// R8: approval for read creates read-cap only; use still denied
{
  await putState(base({ usePolicies: POL, actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: 'g', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.read'], legacy: false, createdAt: '2024-01-01' } } }))
  await putSession()
  const pend = await mcp('get_secret', { name: ITEM })
  const m = /pending approval: (\S+)/.exec(textOf(pend))
  const st0 = await getState()
  const pid = Object.keys(st0.pending)[0]
  if (!pid) { fail('R8', 'no pending created: ' + textOf(pend).slice(0, 80)) }
  else {
    const cookie = await adminCookie()
    const dec = await post('/api/pending/decide', { id: pid, decision: 'once' }, { cookie })
    const st1 = await getState()
    const rc = st1.capabilities[CK(AGENT)]
    const uc = st1.capabilities[UK(AGENT)]
    const readOk = rc && rc.action === 'secret.read' && rc.mode === 'temporary' && rc.approvalId === pid && rc.maxUses === 1
    if (dec.status === 200 && readOk && !uc) pass('R8 approval mints read-cap only (temporary, once, approvalId)')
    else fail('R8', JSON.stringify({ s: dec.status, rc, uc: !!uc }))
  }
}
// R9: use-pending approval mints use-cap; read still denied
{
  await putState(base({ usePolicies: POL, actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: 'g', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.use'], legacy: false, createdAt: '2024-01-01' } } }))
  await putSession()
  await mcp('http_request', { name: ITEM, url: 'https://api.example.invalid/', method: 'GET' })
  const st0 = await getState()
  const pend = Object.values(st0.pending)[0]
  if (!pend || pend.action !== 'secret.use') { fail('R9', 'use pending missing/misbound: ' + JSON.stringify(pend)) }
  else {
    const cookie = await adminCookie()
    await post('/api/pending/decide', { id: pend.id, decision: 'once' }, { cookie })
    const st1 = await getState()
    const uc = st1.capabilities[UK(AGENT)]
    const rc = st1.capabilities[CK(AGENT)]
    if (uc && uc.action === 'secret.use' && !rc) pass('R9 use approval mints use-cap only')
    else fail('R9', JSON.stringify({ uc, rc: !!rc }))
  }
}
// R10: double decide -> second returns 404, single capability
{
  await putState(base({ actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: 'g', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.read'], legacy: false, createdAt: '2024-01-01' } } }))
  await putSession()
  await mcp('get_secret', { name: ITEM })
  const st0 = await getState()
  const pid = Object.keys(st0.pending)[0]
  const cookie = await adminCookie()
  const d1 = await post('/api/pending/decide', { id: pid, decision: 'once' }, { cookie })
  const d2 = await post('/api/pending/decide', { id: pid, decision: 'once' }, { cookie })
  const st1 = await getState()
  const n = Object.keys(st1.capabilities || {}).length
  if (d1.status === 200 && d2.status === 404 && n === 1) pass('R10 repeat decide 404, exactly 1 capability')
  else fail('R10', JSON.stringify({ s1: d1.status, s2: d2.status, n }))
}
// R11: lifecycle — delete revokes caps; recreate does not inherit
{
  await putState(base({ policies: NAP(), capabilities: { [CK(AGENT)]: { id: CK(AGENT), subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 } } }))
  await putSession()
  const cookie = await adminCookie()
  await post('/api/agents/delete', { name: AGENT }, { cookie })
  const st1 = await getState()
  const revoked = st1.capabilities[CK(AGENT)]?.revokedAt
  // recreate same name via API writes legacy:false
  await post('/api/agents/create', { name: AGENT }, { cookie })
  const st2 = await getState()
  const fresh = st2.agents[AGENT]
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  if (revoked && fresh && fresh.legacy === false && !textOf(r).includes(SECRET)) pass('R11 delete revokes, recreate legacy:false, no inheritance')
  else fail('R11', JSON.stringify({ revoked: !!revoked, legacy: fresh && fresh.legacy, t: textOf(r).slice(0, 60) }))
}
// R12: migration-report locked without session -> 423, not global 200
{
  await putState(base({}))
  const cookie = await adminCookie()
  // explicitly lock the vault: clear the DO session
  await stub.fetch('https://state/session', { method: 'DELETE' })
  const r = await get('/api/migration-report', { cookie })
  if (r.status === 423) pass('R12 locked vault: migration-report 423')
  else fail('R12', JSON.stringify({ s: r.status }))
}
// R13b: end-to-end approval chain without seeded itemIds — pending creation
// persists itemId, approval mints the capability, next read succeeds.
{
  await putState(base({ actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: 'g', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.read'], legacy: false, createdAt: '2024-01-01' } }, itemIds: {} }))
  await putSession()
  const p = await mcp('get_secret', { name: ITEM })
  const s0 = await getState()
  const pid = Object.keys(s0.pending)[0]
  const cookie = await adminCookie()
  const dec = await post('/api/pending/decide', { id: pid, decision: 'once' }, { cookie })
  const s1 = await getState()
  const cap = s1.capabilities[CK(AGENT)]
  const r = await mcp('get_secret', { name: ITEM })
  if (/pending approval/i.test(textOf(p)) && dec.status === 200 && cap && cap.approvalId === pid && textOf(r).includes(SECRET)) pass('R13b pending->approval->capability chain works without seeded itemIds')
  else fail('R13b', JSON.stringify({ p: textOf(p).slice(0, 40), s: dec.status, cap: !!cap, r: textOf(r).slice(0, 40) }))
}
// R13: strict terms — float maxUses and bad duration rejected
{
  const cookie = await adminCookie()
  await putSession()
  const r1 = await post('/api/action-grants', { agent: AGENT, item: ITEM, actions: ['secret.read'], terms: { 'secret.read': { duration: '1d', maxUses: 2.9 } } }, { cookie })
  const r2 = await post('/api/action-grants', { agent: AGENT, item: ITEM, actions: ['secret.read'], terms: { 'secret.read': { duration: '9y', maxUses: 1 } } }, { cookie })
  if (r1.status === 400 && r2.status === 400) pass('R13 float maxUses + bad duration rejected')
  else fail('R13', JSON.stringify({ s1: r1.status, s2: r2.status }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== review fixes ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
