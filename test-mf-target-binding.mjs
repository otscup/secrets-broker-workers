// An approval names one site. Approving "use this key" for api.a.example must
// not hand out api.b.example just because the item's policy lists both.
//
// Drives the real Worker: the agent asks over MCP, the operator answers through
// /api/pending/decide, and the capability the broker stores is what is checked.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'target-agent-token'
const SESSION_KEK = Buffer.alloc(32, 9).toString('base64')
const ITEM_ID = 'item-target'
const ITEM = 'target-item'
const AGENT = 'target-agent'
const ACCT = 'vault@example.invalid'
const HOST_A = 'https://api.a.example.com'
const HOST_B = 'https://api.b.example.com'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK, MCP_ALLOW_READ: '1', ADMIN_PASSWORD: 'p' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1', ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'target-db' },
})

const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)',
  'CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)',
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')",
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: '', password: await encryptStr('target-secret', E, M), totp: '', uris: [] }, fields: [] }
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
  const wrapped = await wrapWithKefSafe(plain)
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
}
async function wrapWithKefSafe(plain) {
  return wrapWithKek(new TextEncoder().encode(plain), Buffer.from(SESSION_KEK, 'base64'))
}

function mcp(tool, args) {
  return mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}
const textOf = (r) => r.body?.result?.content?.[0]?.text ?? ''

async function adminLogin() {
  const res = await mf.dispatchFetch('https://broker.test/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'p' }),
  })
  return String(res.headers.get('set-cookie') || '').split(';')[0]
}
async function adminPost(path, body, cookie) {
  return mf.dispatchFetch('https://broker.test' + path, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}

const CAP_KEY = AGENT + '\u0000' + ITEM_ID + '\u0000secret.use'
const USE_POLICY = { [ITEM_ID]: { itemId: ITEM_ID, accountId: ACCT, hosts: ['api.a.example.com', 'api.b.example.com'], methods: ['GET'], pathPrefixes: [], ports: ['443'] } }

function base(extra = {}) {
  return {
    agents: { [AGENT]: { hash, allow: [], groups: [], allowAll: false, write: false, legacy: false, account: ACCT } },
    policies: {}, grants: {}, pending: {}, audit: [], settings: { requireClassification: false, notifications: {}, vaultEmail: ACCT },
    itemGroups: {}, itemIds: { [ITEM]: ITEM_ID },
    actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: AGENT + '\u0000' + ITEM_ID, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.use'], legacy: false, createdAt: '2024-01-01' } },
    usePolicies: USE_POLICY, capabilities: {}, ...extra,
  }
}

// A1: approving a use request binds the origin it named
{
  await putState(base({ pending: { reqA: { id: 'reqA', agent: AGENT, name: ITEM, account: ACCT, itemId: ITEM_ID, action: 'secret.use', createdAt: new Date().toISOString(), targetOrigin: HOST_A } } }))
  await putSession()
  const res = await adminPost('/api/pending/decide', { id: 'reqA', decision: '24h' }, await adminLogin())
  const st = await getState()
  const cap = st.capabilities?.[CAP_KEY]
  const okTargets = Array.isArray(cap?.targets) && cap.targets.length === 1 && cap.targets[0] === HOST_A
  if (okTargets) pass('A1 approval binds the origin it named')
  else fail('A1', JSON.stringify({ status: res.status, outcome: res.body?.outcome, targets: cap?.targets }))
}

// A2: that capability does not cover a second host the policy allows
{
  await putSession()
  const r = await mcp('http_request', { name: ITEM, url: HOST_B + '/v1/x', method: 'GET' })
  const t = textOf(r)
  if (/pending approval/i.test(t)) pass('A2 a second host asks again instead of inheriting the approval')
  else fail('A2', t.slice(0, 160))
}

// A3: the approved host still works
{
  await putSession()
  const r = await mcp('http_request', { name: ITEM, url: HOST_A + '/v1/x', method: 'GET' })
  const t = textOf(r)
  if (!/pending approval|denied|not allowed|target-not-approved/i.test(t)) pass('A3 the approved host is still usable')
  else fail('A3', t.slice(0, 160))
}

// A4: approving the second host appends instead of being skipped as a live capability
{
  const st = await getState()
  const pendingId = Object.keys(st.pending ?? {})[0]
  if (!pendingId) { fail('A4', 'no pending request was created for the second host'); }
  else {
    await putSession()
    await adminPost('/api/pending/decide', { id: pendingId, decision: '24h' }, await adminLogin())
    const after = await getState()
    const targets = after.capabilities?.[CAP_KEY]?.targets ?? []
    if (targets.includes(HOST_A) && targets.includes(HOST_B)) pass('A4 a second approval appends its host')
    else fail('A4', JSON.stringify(targets))
  }
}
// A5: a capability that predates target binding keeps working (no silent narrowing)
{
  const cap = { id: CAP_KEY, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.use', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 'admin:test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await putState(base({ capabilities: { [CAP_KEY]: cap } }))
  await putSession()
  const r = await mcp('http_request', { name: ITEM, url: HOST_B + '/v1/x', method: 'GET' })
  const t = textOf(r)
  if (!/pending approval|target-not-approved/i.test(t)) pass('A5 a capability without a target list is not narrowed')
  else fail('A5', t.slice(0, 160))
}
// A6: a use approval with no origin is refused rather than minted unlocked
{
  await putState(base({ pending: { reqX: { id: 'reqX', agent: AGENT, name: ITEM, account: ACCT, itemId: ITEM_ID, action: 'secret.use', createdAt: new Date().toISOString(), targetOrigin: '' } } }))
  await putSession()
  const res = await adminPost('/api/pending/decide', { id: 'reqX', decision: '24h' }, await adminLogin())
  const st = await getState()
  const outcome = res.body?.outcome ?? {}
  if (outcome.denied === true && outcome.error === 'use-target-missing' && !st.capabilities?.[CAP_KEY]) pass('A6 an approval without an origin mints nothing')
  else fail('A6', JSON.stringify({ outcome, cap: Boolean(st.capabilities?.[CAP_KEY]) }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== target binding ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
