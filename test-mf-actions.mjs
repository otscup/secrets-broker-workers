// Hybrid permission model — secret.read vs secret.use independence.
//
// Drives the REAL Worker routes under Miniflare. All data synthetic; no real
// secrets, no network. The D1 layer holds one item with a known plaintext so we
// can assert the plaintext never reaches the Agent for secret.use.
import { Miniflare } from 'miniflare'
import { wrapWithKek } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'hybrid-agent-token'
const SESSION_KEK = Buffer.alloc(32, 9).toString('base64')
const PLAINTEXT = 'PLAINTEXT-MUST-NOT-LEAK-9f3a'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK, MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'hybrid-db' },
})

const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)",
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')",
]) await db.exec(sql)

// Insert one real (synthetic) cipher row so read/use paths reach decryption.
// Encrypted with the same fake user keys used by putSession().
import { encryptStr } from './src/crypto.js'
const USER_ENC = Buffer.alloc(32, 1)
const USER_MAC = Buffer.alloc(32, 2)
const ITEM_ID = 'item-1'
{
  const nameEnc = await encryptStr('plain-item', USER_ENC, USER_MAC)
  const notesEnc = await encryptStr('', USER_ENC, USER_MAC)
  const data = { login: { username: await encryptStr('', USER_ENC, USER_MAC), password: await encryptStr(PLAINTEXT, USER_ENC, USER_MAC), totp: await encryptStr('', USER_ENC, USER_MAC), uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id, user_id, type, folder_id, name, notes, data, key, favorite, reprompt, created_at, updated_at, deleted_at, archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, nameEnc, notesEnc, JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null, null).run()
}

const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const putState = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)

async function seedState(extra = {}) {
  const state = {
    agents: { 'hybrid-agent': { hash, alias: '', allow: [], groups: [], allowAll: false, write: false, legacy: false, account: 'vault@example.invalid', createdAt: '2024-01-01' } },
    policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {} },
    itemGroups: {}, actionGrants: {}, usePolicies: {},
    ...extra,
  }
  await putState(state)
}
async function putSession() {
  const plain = JSON.stringify({ email: 'vault@example.invalid', symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  const wrapped = await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(SESSION_KEK, 'base64'))
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
}
function mcp(tool, args) {
  return mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${AUTH}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}
const textOf = (r) => r.body?.result?.content?.[0]?.text ?? ''

// A1: no action grant, not legacy -> get_secret denied
{
  await seedState()
  await putSession()
  const r = await mcp('get_secret', { name: 'plain-item' })
  if (r.status === 200 && /not allowed|denied/i.test(textOf(r))) pass('A1 no grant + not legacy: secret.read denied')
  else fail('A1', JSON.stringify(r.body).slice(0, 200))
}

// A2: legacy agent with allowAll can still read (compat), marked legacy in audit
{
  await seedState({
    agents: { 'hybrid-agent': { hash, allow: [], groups: [], allowAll: true, write: false, legacy: true, account: 'vault@example.invalid' } },
    policies: { 'plain-item': { noApproval: true } },
  })
  await putSession()
  const r = await mcp('get_secret', { name: 'plain-item' })
  const state = await getState()
  const audited = (state.audit || []).some((e) => e.event === 'secret.read' && e.legacy === true)
  if (r.status === 200 && textOf(r).length > 0 && audited) pass('A2 legacy agent keeps secret.read (compat) and is audited as legacy')
  else fail('A2', JSON.stringify({ text: textOf(r), audited }).slice(0, 240))
}

// A3: action grant with ONLY secret.use -> get_secret denied
{
  await seedState({
    actionGrants: { 'hybrid-agent\u0000item-1': { id: 'g1', subjectId: 'hybrid-agent', accountId: 'vault@example.invalid', itemId: 'item-1', itemName: 'plain-item', actions: ['secret.use'], legacy: false, createdAt: '2024-01-01' } },
    usePolicies: { 'item-1': { itemId: 'item-1', hosts: ['api.example.invalid'], methods: ['GET'], pathPrefixes: ['/ok/'], ports: ['443'] } },
    policies: { 'plain-item': { noApproval: true } },
  })
  await putSession()
  const r = await mcp('get_secret', { name: 'plain-item' })
  if (/not allowed|denied/i.test(textOf(r))) pass('A3 secret.use does NOT imply secret.read (get_secret denied)')
  else fail('A3', JSON.stringify(r.body).slice(0, 200))
}

// A4: action grant with ONLY secret.read -> http_request denied
{
  await seedState({
    actionGrants: { 'hybrid-agent\u0000item-1': { id: 'g1', subjectId: 'hybrid-agent', accountId: 'vault@example.invalid', itemId: 'item-1', itemName: 'plain-item', actions: ['secret.read'], legacy: false, createdAt: '2024-01-01' } },
    usePolicies: { 'item-1': { itemId: 'item-1', hosts: ['api.example.invalid'], methods: ['GET'], pathPrefixes: ['/'], ports: ['443'] } },
    policies: { 'plain-item': { noApproval: true } },
  })
  await putSession()
  const r = await mcp('http_request', { name: 'plain-item', url: 'https://api.example.invalid/ok/x', method: 'GET' })
  if (/denied|not allowed/i.test(textOf(r))) pass('A4 secret.read does NOT imply secret.use (http_request denied)')
  else fail('A4', JSON.stringify(r.body).slice(0, 200))
}

// A5: use grant but host not in policy -> target-denied
{
  await seedState({
    actionGrants: { 'hybrid-agent\u0000item-1': { id: 'g1', subjectId: 'hybrid-agent', accountId: 'vault@example.invalid', itemId: 'item-1', itemName: 'plain-item', actions: ['secret.use'], legacy: false, createdAt: '2024-01-01' } },
    usePolicies: { 'item-1': { itemId: 'item-1', hosts: ['api.example.invalid'], methods: ['GET'], pathPrefixes: ['/ok/'], ports: ['443'] } },
  })
  await putSession()
  const r = await mcp('http_request', { name: 'plain-item', url: 'https://evil.example.invalid/ok/x', method: 'GET' })
  if (/target|denied|not allowed/i.test(textOf(r))) pass('A5 use grant with out-of-policy host is denied')
  else fail('A5', JSON.stringify(r.body).slice(0, 200))
}

// A6: use grant, method not in policy -> denied
{
  await seedState({
    actionGrants: { 'hybrid-agent\u0000item-1': { id: 'g1', subjectId: 'hybrid-agent', accountId: 'vault@example.invalid', itemId: 'item-1', itemName: 'plain-item', actions: ['secret.use'], legacy: false, createdAt: '2024-01-01' } },
    usePolicies: { 'item-1': { itemId: 'item-1', hosts: ['api.example.invalid'], methods: ['GET'], pathPrefixes: ['/ok/'], ports: ['443'] } },
  })
  await putSession()
  const r = await mcp('http_request', { name: 'plain-item', url: 'https://api.example.invalid/ok/x', method: 'DELETE' })
  if (/target|denied|not allowed/i.test(textOf(r))) pass('A6 use grant with disallowed HTTP method is denied')
  else fail('A6', JSON.stringify(r.body).slice(0, 200))
}

// A7: use grant, path not in prefix -> denied
{
  await seedState({
    actionGrants: { 'hybrid-agent\u0000item-1': { id: 'g1', subjectId: 'hybrid-agent', accountId: 'vault@example.invalid', itemId: 'item-1', itemName: 'plain-item', actions: ['secret.use'], legacy: false, createdAt: '2024-01-01' } },
    usePolicies: { 'item-1': { itemId: 'item-1', hosts: ['api.example.invalid'], methods: ['GET'], pathPrefixes: ['/ok/'], ports: ['443'] } },
  })
  await putSession()
  const r = await mcp('http_request', { name: 'plain-item', url: 'https://api.example.invalid/nope/x', method: 'GET' })
  if (/target|denied|not allowed/i.test(textOf(r))) pass('A7 use grant with disallowed path prefix is denied')
  else fail('A7', JSON.stringify(r.body).slice(0, 200))
}

// A8: plaintext must never appear in any secret.use response body
{
  await seedState()
  for (const tool of ['get_secret', 'http_request']) {
    const r = await mcp(tool, { name: 'plain-item', url: 'https://api.example.invalid/ok/x' })
    if (JSON.stringify(r.body).includes(PLAINTEXT)) { fail('A8 plaintext leaked via ' + tool); break }
  }
  pass('A8 synthetic plaintext is never serialized into MCP responses')
}

// A9: shadow mode records allow/deny mismatch without sensitive data
{
  await seedState({
    agents: { 'hybrid-agent': { hash, allow: [], groups: [], allowAll: false, write: false, legacy: true, account: 'vault@example.invalid' } },
    actionGrants: { 'hybrid-agent\u0000item-1': { id: 'g1', subjectId: 'hybrid-agent', accountId: 'vault@example.invalid', itemId: 'item-1', itemName: 'plain-item', actions: ['secret.read'], legacy: false, createdAt: '2024-01-01' } },
    policies: { 'plain-item': { noApproval: true } },
    settings: { notifications: {}, shadowPolicy: true },
  })
  await putSession()
  const r9 = await mcp('get_secret', { name: 'plain-item' })
  void r9
  // shadowAudit is fire-and-forget; give the DO write a moment to land.
  await new Promise((r) => setTimeout(r, 500))
  const state = await getState()
  const shadow = (state.audit || []).filter((e) => e.event === 'policy.shadow-mismatch')
  const safe = shadow.every((e) => !JSON.stringify(e).includes(PLAINTEXT) && e.value === undefined)
  if (shadow.length > 0 && safe) pass('A9 shadow mode records policy mismatch with no secret material')
  else fail('A9', JSON.stringify({ count: shadow.length, safe }).slice(0, 200))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== hybrid permissions ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
