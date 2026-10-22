// d4a121e review patch regression: state-machine edge cases.
//
// Drives the REAL Worker + DO under Miniflare. Synthetic data only.
// Each case asserts behaviour AND persisted state (counters/tombstones intact).
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'sm-agent-token'
const KEK = Buffer.alloc(32, 31).toString('base64')
const SECRET = 'STATE-MACHINE-PLAINTEXT-z8'
const ITEM_ID = 'item-sm'
const ITEM = 'sm-item'
const AGENT = 'sm-agent'
const ACCT = 'vault@example.invalid'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'sm-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const s of [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)",
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1','vault@example.invalid','k',0,600000,'2024-01-01')",
]) await db.exec(s)
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
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })
}
async function adminCookie() {
  const id = 'adm-' + Math.random().toString(36).slice(2)
  const expires = Date.now() + 7 * 86400 * 1000
  const payload = 'v2.' + id + '.' + expires
  const kb = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cookie:' + KEK))
  const key = await crypto.subtle.importKey('raw', kb, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64')
  const st = await getState()
  st.adminSessions = st.adminSessions || {}
  st.adminSessions[id] = { id, ip: '', ua: '', createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), expiresAt: expires }
  await putState(st)
  return 'broker_admin=' + payload + '.' + sig
}
const mcp = (tool, args) => mf.dispatchFetch('https://broker.test/mcp', {
  method: 'POST', headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
}).then(async (r) => ({ status: r.status, body: await r.json() }))
const post = (p, b, h = {}) => mf.dispatchFetch('https://broker.test' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
const textOf = (r) => r.body?.result?.content?.[0]?.text ?? ''
const CK = (a = AGENT) => a + '\u0000' + ITEM_ID + '\u0000secret.read'
const UK = (a = AGENT) => a + '\u0000' + ITEM_ID + '\u0000secret.use'
const GK = (a = AGENT) => a + '\u0000' + ITEM
const capOf = (action, extra = {}) => ({ id: action === 'secret.use' ? UK() : CK(), subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action, mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1, ...extra })
const AG = () => ({ [AGENT]: { hash, allow: [], groups: [], allowAll: false, write: false, legacy: false, account: ACCT } })
function base(extra = {}) {
  return { agents: AG(), policies: {}, grants: {}, pending: {}, audit: [], settings: { requireClassification: false, notifications: {} }, itemGroups: {}, actionGrants: {}, usePolicies: {}, capabilities: {}, itemIds: { [ITEM]: ITEM_ID }, ...extra }
}
const POL = { [ITEM_ID]: { itemId: ITEM_ID, accountId: ACCT, hosts: ['api.example.invalid'], methods: ['GET'], pathPrefixes: ['/'], ports: ['443'] } }

// S1: revoked capability + noApproval item -> hard deny (no approval fallback)
{
  await putState(base({ policies: { [ITEM]: { noApproval: true } }, capabilities: { [CK()]: capOf('secret.read', { revokedAt: new Date().toISOString() }) } }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const st = await getState()
  if (!textOf(r).includes(SECRET) && /revoked|denied|not allowed/i.test(textOf(r)) && !Object.keys(st.pending).length) pass('S1 revoked cap + noApproval: denied, no pending')
  else fail('S1', JSON.stringify({ t: textOf(r).slice(0, 60), pending: Object.keys(st.pending).length }))
}
// S2: expired capability on a LEGACY agent with valid old grant -> still denied
{
  await putState(base({
    agents: { [AGENT]: { hash, allow: [], groups: [], allowAll: true, write: false, legacy: true, account: ACCT } },
    capabilities: { [CK()]: capOf('secret.read', { expiresAt: Date.now() - 1000 }) },
    grants: { [GK()]: { agent: AGENT, name: ITEM, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT } },
  }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const st = await getState()
  if (!textOf(r).includes(SECRET) && st.capabilities[CK()].usedCount === 0) pass('S2 legacy + expired cap + live old grant: denied, counter untouched')
  else fail('S2', textOf(r).slice(0, 80))
}
// S3: exhausted capability + noApproval -> denied, tombstone intact
{
  await putState(base({ policies: { [ITEM]: { noApproval: true } }, capabilities: { [CK()]: capOf('secret.read', { maxUses: 2, usedCount: 2, exhaustedAt: new Date().toISOString() }) } }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const st = await getState()
  if (!textOf(r).includes(SECRET) && st.capabilities[CK()].usedCount === 2) pass('S3 exhausted cap + noApproval: denied, tombstone intact')
  else fail('S3', textOf(r).slice(0, 80))
}
// S4: use denied when only a legacy read grant exists (use must be explicit)
{
  await putState(base({ usePolicies: POL, policies: { [ITEM]: { noApproval: true } }, grants: { [GK()]: { agent: AGENT, name: ITEM, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT } } }))
  await putSession()
  const r = await mcp('http_request', { name: ITEM, url: 'https://api.example.invalid/', method: 'GET' })
  const st = await getState()
  if (!JSON.stringify(r.body).includes(SECRET) && !st.capabilities[UK()] && /denied|not allowed|pending/i.test(textOf(r))) pass('S4 use with only read grant: denied, no use cap synthesized')
  else fail('S4', JSON.stringify({ t: textOf(r).slice(0, 60), uc: !!st.capabilities[UK()] }))
}
// S5: read and use pendings coexist independently; approving read does not grant use
{
  await putState(base({ usePolicies: POL, actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: 'g', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.read', 'secret.use'], legacy: false, createdAt: '2024-01-01' } } }))
  await putSession()
  await mcp('get_secret', { name: ITEM })
  await mcp('http_request', { name: ITEM, url: 'https://api.example.invalid/', method: 'GET' })
  const st0 = await getState()
  const pend = Object.values(st0.pending)
  const readPend = pend.find((p) => p.action === 'secret.read')
  const usePend = pend.find((p) => p.action === 'secret.use')
  const cookie = await adminCookie()
  if (readPend) await post('/api/pending/decide', { id: readPend.id, decision: 'once' }, { cookie })
  const st1 = await getState()
  const r = await mcp('http_request', { name: ITEM, url: 'https://api.example.invalid/', method: 'GET' })
  if (pend.length === 2 && readPend && usePend && st1.capabilities[CK()] && !st1.capabilities[UK()] && !JSON.stringify(r.body).includes(SECRET)) pass('S5 independent pendings; read approval does not grant use')
  else fail('S5', JSON.stringify({ n: pend.length, rc: !!st1.capabilities[CK()], uc: !!st1.capabilities[UK()] }))
}
// S6: legacy pending without action is refused on approval
{
  await putState(base({ pending: { legacy1: { id: 'legacy1', agent: AGENT, name: ITEM, account: ACCT, createdAt: '2024-01-01' } } }))
  await putSession()
  const cookie = await adminCookie()
  const r = await post('/api/pending/decide', { id: 'legacy1', decision: 'once' }, { cookie })
  const st = await getState()
  if (r.status === 200 && r.body?.outcome?.denied === true && !Object.keys(st.capabilities || {}).length) pass('S6 legacy pending without action: denied, no capability')
  else fail('S6', JSON.stringify({ s: r.status, o: r.body?.outcome, caps: Object.keys(st.capabilities || {}) }))
}
// S7: approving over a live capability does not reset its counter
{
  const live = capOf('secret.read', { maxUses: 5, usedCount: 3 })
  await putState(base({ policies: { [ITEM]: { noApproval: true } }, capabilities: { [CK()]: live }, pending: { p1: { id: 'p1', agent: AGENT, name: ITEM, account: ACCT, action: 'secret.read', createdAt: '2024-01-01' } } }))
  await putSession()
  const cookie = await adminCookie()
  await post('/api/pending/decide', { id: 'p1', decision: 'always' }, { cookie })
  const st = await getState()
  const c = st.capabilities[CK()]
  if (c && c.usedCount === 3 && c.maxUses === 5) pass('S7 approval over live capability: counter preserved')
  else fail('S7', JSON.stringify(c))
}
// S8: re-approval over a revoked capability is recorded as regrant
{
  const rev = capOf('secret.read', { revokedAt: new Date().toISOString(), usedCount: 4 })
  await putState(base({ capabilities: { [CK()]: rev }, pending: { p2: { id: 'p2', agent: AGENT, name: ITEM, account: ACCT, action: 'secret.read', createdAt: '2024-01-01' } } }))
  await putSession()
  const cookie = await adminCookie()
  await post('/api/pending/decide', { id: 'p2', decision: 'once' }, { cookie })
  const st = await getState()
  const c = st.capabilities[CK()]
  if (c && !c.revokedAt && c.usedCount === 0 && c.regrantedFrom === 'revoked') pass('S8 re-grant over revoked: fresh counter, regrantedFrom=revoked')
  else fail('S8', JSON.stringify(c))
}
// S9: concurrent approvals of the same pending -> single capability
{
  await putState(base({ pending: { p3: { id: 'p3', agent: AGENT, name: ITEM, account: ACCT, action: 'secret.read', createdAt: '2024-01-01' } } }))
  await putSession()
  const cookie = await adminCookie()
  const out = await Promise.all(Array.from({ length: 8 }, () => post('/api/pending/decide', { id: 'p3', decision: '24h' }, { cookie })))
  const okCount = out.filter((r) => r.status === 200 && !r.body?.outcome?.denied).length
  const st = await getState()
  if (okCount === 1 && Object.keys(st.capabilities).length === 1) pass('S9 8-way concurrent approve: 1 success, 1 capability')
  else fail('S9', JSON.stringify({ okCount, caps: Object.keys(st.capabilities).length }))
}
// S10: first lazy migration persists before consume (read works immediately)
{
  await putState(base({ policies: { [ITEM]: { noApproval: true } }, grants: { [GK()]: { agent: AGENT, name: ITEM, itemId: ITEM_ID, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: 3, revokedAt: null, account: ACCT } }, capabilities: {} }))
  await putSession()
  const first = await mcp('get_secret', { name: ITEM })
  const st = await getState()
  const cap = st.capabilities[CK()]
  const second = await mcp('get_secret', { name: ITEM })
  const st2 = await getState()
  if (textOf(first).includes(SECRET) && cap && cap.usedCount === 1 && !cap.__pendingMigration && st2.capabilities[CK()].usedCount === 2 && textOf(second).includes(SECRET)) pass('S10 lazy migration persists then counts 1->2')
  else fail('S10', JSON.stringify({ t1: textOf(first).slice(0, 40), cap, used2: st2.capabilities[CK()]?.usedCount }))
}
// S11: concurrent first-migration (10-way) never over-counts past maxUses
{
  await putState(base({ policies: { [ITEM]: { noApproval: true } }, grants: { [GK()]: { agent: AGENT, name: ITEM, itemId: ITEM_ID, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: 2, revokedAt: null, account: ACCT } }, capabilities: {} }))
  await putSession()
  const out = await Promise.all(Array.from({ length: 10 }, () => mcp('get_secret', { name: ITEM })))
  const wins = out.filter((r) => textOf(r).includes(SECRET)).length
  const st = await getState()
  if (wins === 2 && st.capabilities[CK()].usedCount === 2) pass('S11 10-way first-migration: exactly maxUses=2 wins')
  else fail('S11', JSON.stringify({ wins, used: st.capabilities[CK()]?.usedCount }))
}
// S14: a legacy grant with NO stable itemId cannot be migrated (safe reject)
{
  await putState(base({ policies: { [ITEM]: { noApproval: true } }, grants: { [GK()]: { agent: AGENT, name: ITEM, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: 3, revokedAt: null, account: ACCT } }, capabilities: {} }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const st = await getState()
  if (!textOf(r).includes(SECRET) && !st.capabilities[CK()] && /migration rejected|unbound/i.test(textOf(r))) pass('S14 legacy grant without itemId: migration refused, no capability')
  else fail('S14', JSON.stringify({ t: textOf(r).slice(0, 70), cap: !!st.capabilities[CK()] }))
}
// S12: revoked capability blocks use even with matching policy + read cap
{
  await putState(base({
    usePolicies: POL,
    capabilities: { [CK()]: capOf('secret.read'), [UK()]: capOf('secret.use', { revokedAt: new Date().toISOString() }) },
  }))
  await putSession()
  const r = await mcp('http_request', { name: ITEM, url: 'https://api.example.invalid/', method: 'GET' })
  if (!JSON.stringify(r.body).includes(SECRET) && /revoked|denied/i.test(textOf(r))) pass('S12 revoked use cap blocks use despite read cap')
  else fail('S12', textOf(r).slice(0, 80))
}
// S13: cross-account capability is decisive (no legacy fallback)
{
  await putState(base({ policies: { [ITEM]: { noApproval: true } }, capabilities: { [CK()]: capOf('secret.read', { accountId: 'other@example.invalid' }) } }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  if (!textOf(r).includes(SECRET)) pass('S13 cross-account cap: denied')
  else fail('S13', textOf(r).slice(0, 60))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== state machine patch ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
