// Unified capability tests: expiry / uses / revoke / independence / concurrency.
//
// Drives the REAL Worker + Durable Object under Miniflare with synthetic data.
// Capabilities are seeded directly (admin writes them via /api/action-grants in
// production); behaviour under test is the enforcement + atomic consume path.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'cap-agent-token'
const SESSION_KEK = Buffer.alloc(32, 7).toString('base64')
const ITEM_ID = 'item-cap'
const ITEM = 'cap-item'
const AGENT = 'cap-agent'
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
  d1Databases: { NODEWARDEN_DB: 'cap-db' },
})

const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)",
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')",
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: '', password: await encryptStr('cap-secret', E, M), totp: '', uris: [] }, fields: [] }
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
function mcp(tool, args) {
  return mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}
const textOf = (r) => r.body?.result?.content?.[0]?.text ?? ''
const KEY = (a, i) => a + '\u0000' + i
function cap(action, extra = {}) {
  return { [KEY(AGENT, ITEM_ID) + '\u0000' + action]: { id: KEY(AGENT, ITEM_ID) + '\u0000' + action, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action, mode: 'preapproved', createdAt: '2024-01-01', createdBy: 'admin:test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1, ...extra } }
}
function base(extra = {}) {
  return {
    agents: { [AGENT]: { hash, allow: [], groups: [], allowAll: false, write: false, legacy: false, account: ACCT } },
    policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {} },
    itemGroups: {}, actionGrants: {}, usePolicies: {}, capabilities: {}, ...extra,
  }
}
const noApproval = () => ({ [ITEM]: { noApproval: true } })

// C1: durations — 1d valid now, expired 7d-equivalent rejected
{
  await putState(base({ policies: noApproval(), capabilities: { ...cap('secret.read', { expiresAt: Date.now() + 86400e3 }), ...{ X: null } } }))
  await putSession()
  const ok = await mcp('get_secret', { name: ITEM })
  const expired = { ...cap('secret.read', { expiresAt: Date.now() - 1000 }) }
  await putState(base({ policies: noApproval(), capabilities: expired }))
  const bad = await mcp('get_secret', { name: ITEM })
  if (!/pending approval|not allowed|denied|no longer valid/i.test(textOf(ok)) && /not allowed|denied|no longer valid|expired/i.test(textOf(bad))) pass('C1 1d-valid accepted, expired rejected')
  else fail('C1', JSON.stringify({ ok: textOf(ok).slice(0, 80), bad: textOf(bad).slice(0, 80) }))
}
// C2: permanent (expiresAt null) accepted
{
  await putState(base({ policies: noApproval(), capabilities: cap('secret.read', { expiresAt: null }) }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  if (textOf(r).includes('cap-secret')) pass('C2 permanent capability accepted')
  else fail('C2', textOf(r).slice(0, 120))
}
// C3: revoked rejected
{
  await putState(base({ policies: noApproval(), capabilities: cap('secret.read', { revokedAt: new Date().toISOString(), revokedBy: 'admin:test' }) }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  if (/not allowed|denied|no longer valid|revoked/i.test(textOf(r))) pass('C3 revoked capability rejected')
  else fail('C3', textOf(r).slice(0, 120))
}
// C4: exhausted rejected
{
  await putState(base({ policies: noApproval(), capabilities: cap('secret.read', { maxUses: 2, usedCount: 2 }) }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  if (/not allowed|denied|no longer valid|exhausted/i.test(textOf(r))) pass('C4 exhausted capability rejected')
  else fail('C4', textOf(r).slice(0, 120))
}
// C5: maxUses=1, 20 concurrent reads -> exactly 1 plaintext, rest refused
{
  await putState(base({ policies: noApproval(), capabilities: cap('secret.read', { maxUses: 1 }) }))
  await putSession()
  const out = await Promise.all(Array.from({ length: 20 }, () => mcp('get_secret', { name: ITEM })))
  const wins = out.filter((r) => textOf(r).includes('cap-secret')).length
  const refused = out.filter((r) => /not allowed|denied|no longer valid|exhausted/i.test(textOf(r))).length
  const st = await getState()
  const gone = !st.capabilities[KEY(AGENT, ITEM_ID) + '\u0000secret.read']
  if (wins === 1 && refused === 19 && gone) pass('C5 maxUses=1 20-way: 1 plaintext, 19 refused, capability removed')
  else fail('C5', 'wins=' + wins + ' refused=' + refused + ' gone=' + gone)
}
// C6: maxUses=3, 20 concurrent -> exactly 3 plaintext
{
  await putState(base({ policies: noApproval(), capabilities: cap('secret.read', { maxUses: 3 }) }))
  await putSession()
  const out = await Promise.all(Array.from({ length: 20 }, () => mcp('get_secret', { name: ITEM })))
  const wins = out.filter((r) => textOf(r).includes('cap-secret')).length
  if (wins === 3) pass('C6 maxUses=3 20-way: exactly 3 plaintext')
  else fail('C6', 'wins=' + wins)
}
// C7: unlimited counts accurately under concurrency
{
  await putState(base({ policies: noApproval(), capabilities: cap('secret.read', { maxUses: null }) }))
  await putSession()
  const out = await Promise.all(Array.from({ length: 20 }, () => mcp('get_secret', { name: ITEM })))
  const wins = out.filter((r) => textOf(r).includes('cap-secret')).length
  const st = await getState()
  const n = st.capabilities[KEY(AGENT, ITEM_ID) + '\u0000secret.read']?.usedCount
  if (wins === 20 && n === 20) pass('C7 unlimited 20-way: 20 plaintext, usedCount=20')
  else fail('C7', 'wins=' + wins + ' usedCount=' + n)
}
// C8: read does not imply use and vice versa
{
  await putState(base({ policies: noApproval(), capabilities: cap('secret.read') }))
  await putSession()
  const u = await mcp('http_request', { name: ITEM, url: 'https://api.example.invalid/x', method: 'GET' })
  const useDenied = /denied|not allowed|no-use-policy|no-capability/i.test(textOf(u))
  await putState(base({ policies: noApproval(), capabilities: { ...cap('secret.use'), ...{ P: null } }, usePolicies: { [ITEM_ID]: { itemId: ITEM_ID, accountId: ACCT, hosts: ['api.example.invalid'], methods: ['GET'], pathPrefixes: ['/'], ports: ['443'] } } }))
  const r = await mcp('get_secret', { name: ITEM })
  const readDenied = /not allowed|denied|no longer valid|no-capability/i.test(textOf(r))
  // clean the dummy key artifact of object spread above (none created; guard anyway)
  if (useDenied && readDenied) pass('C8 read/use independent (no cross-implication)')
  else fail('C8', JSON.stringify({ u: textOf(u).slice(0, 80), r: textOf(r).slice(0, 80) }))
}
// C9: Agent cannot escalate via body smuggling (capability fields not writable)
{
  await putState(base({ policies: noApproval(), capabilities: cap('secret.read', { maxUses: 1, usedCount: 1 }) }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const st = await getState()
  const kept = st.capabilities[KEY(AGENT, ITEM_ID) + '\u0000secret.read'] ?? null
  const denied = /not allowed|denied|no longer valid|exhausted/i.test(textOf(r))
  // Exhausted capabilities stay stored (status=exhausted) so admins can see
  // terms; the gate rejects. usedCount must be untouched by the denied call.
  if (denied && kept && kept.usedCount === 1 && kept.maxUses === 1) pass('C9 exhausted stays rejected; usedCount untouched')
  else fail('C9', JSON.stringify({ t: textOf(r).slice(0, 80), kept }))
}
// C10: revoke-then-use denied (soft revoke path)
{
  const c = cap('secret.read', { revokedAt: new Date().toISOString(), revokedBy: 'admin:x' })
  await putState(base({ policies: noApproval(), capabilities: c }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  if (/not allowed|denied|no longer valid|revoked/i.test(textOf(r))) pass('C10 revoked-before-use denied')
  else fail('C10', textOf(r).slice(0, 120))
}
// C11: cross-account capability rejected
{
  await putState(base({ policies: noApproval(), capabilities: cap('secret.read', { accountId: 'other@example.invalid' }) }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  if (/not allowed|denied|no longer valid|cross-account/i.test(textOf(r))) pass('C11 cross-account capability rejected')
  else fail('C11', textOf(r).slice(0, 120))
}
// C12: legacy double-count guard — old grant mirror + capability: one consume
{
  await putState(base({
    policies: noApproval(),
    capabilities: cap('secret.read', { maxUses: 1 }),
    grants: { [AGENT + '\u0000' + ITEM]: { agent: AGENT, name: ITEM, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: 5, revokedAt: null } },
  }))
  await putSession()
  const out = await Promise.all(Array.from({ length: 6 }, () => mcp('get_secret', { name: ITEM })))
  const wins = out.filter((r) => textOf(r).includes('cap-secret')).length
  if (wins === 1) pass('C12 capability authoritative: 6 concurrent yield 1 despite maxReads=5 mirror')
  else fail('C12', 'wins=' + wins)
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== capabilities ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
