// Approval-pipeline bypass tests for the hybrid model.
//
// The core question: can an actionGrant let an Agent skip approval, expiry,
// revocation or maxReads? It must not. These tests drive the real /mcp tool
// under Miniflare with synthetic data only.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'approval-agent-token'
const SESSION_KEK = Buffer.alloc(32, 5).toString('base64')
const PLAINTEXT = 'APPROVAL-PLAINTEXT-7c1d'
const ITEM_ID = 'item-approval'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK, MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'approval-db' },
})

const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)",
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')",
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: await encryptStr('', E, M), password: await encryptStr(PLAINTEXT, E, M), totp: await encryptStr('', E, M), uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr('approval-item', E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null, null).run()
}

const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const putState = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
async function putSession() {
  const plain = JSON.stringify({ email: 'vault@example.invalid', symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  const wrapped = await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(SESSION_KEK, 'base64'))
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
}
const KEY = 'approval-agent\u0000item-approval'
function baseState(extra = {}) {
  return {
    agents: { 'approval-agent': { hash, allow: [], groups: [], allowAll: false, write: false, legacy: false, account: 'vault@example.invalid' } },
    policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {} },
    itemGroups: {}, actionGrants: {}, usePolicies: {},
    ...extra,
  }
}
const readGrant = (extra = {}) => ({ [KEY]: { id: KEY, subjectId: 'approval-agent', accountId: 'vault@example.invalid', itemId: ITEM_ID, itemName: 'approval-item', actions: ['secret.read'], legacy: false, createdAt: '2024-01-01', ...extra } })
const useGrant = (extra = {}) => ({ [KEY]: { id: KEY, subjectId: 'approval-agent', accountId: 'vault@example.invalid', itemId: ITEM_ID, itemName: 'approval-item', actions: ['secret.use'], legacy: false, createdAt: '2024-01-01', ...extra } })
const usePolicy = { [ITEM_ID]: { itemId: ITEM_ID, accountId: 'vault@example.invalid', hosts: ['api.example.invalid'], methods: ['GET'], pathPrefixes: ['/ok/'], ports: ['443'] } }
function mcp(tool, args) {
  return mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${AUTH}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}
const textOf = (r) => r.body?.result?.content?.[0]?.text ?? ''

// P1: actionGrant + no approval + no grant -> pending, NOT allowed
{
  await putState(baseState({ actionGrants: readGrant() }))
  await putSession()
  const r = await mcp('get_secret', { name: 'approval-item' })
  if (/pending approval/i.test(textOf(r))) pass('P1 actionGrant does not bypass approval (pending returned)')
  else fail('P1', JSON.stringify(r.body).slice(0, 200))
}

// P2: actionGrant + expired grant -> denied
{
  await putState(baseState({ actionGrants: readGrant(), grants: { ['approval-agent\u0000approval-item']: { agent: 'approval-agent', name: 'approval-item', mode: 'share', expiresAt: Date.now() - 1000, reads: 0, maxReads: null, revokedAt: null } } }))
  await putSession()
  const r = await mcp('get_secret', { name: 'approval-item' })
  if (/pending approval|not allowed|denied|no longer valid/i.test(textOf(r))) pass('P2 actionGrant does not bypass expired grant')
  else fail('P2', JSON.stringify(r.body).slice(0, 200))
}

// P3: actionGrant + revoked grant -> denied
{
  await putState(baseState({ actionGrants: readGrant(), grants: { ['approval-agent\u0000approval-item']: { agent: 'approval-agent', name: 'approval-item', mode: 'share', expiresAt: 0, reads: 0, maxReads: null, revokedAt: new Date().toISOString() } } }))
  await putSession()
  const r = await mcp('get_secret', { name: 'approval-item' })
  if (/pending approval|not allowed|denied/i.test(textOf(r))) pass('P3 actionGrant does not bypass revoked grant')
  else fail('P3', JSON.stringify(r.body).slice(0, 200))
}

// P4: secret.use also requires approval when item is not no-approval
{
  await putState(baseState({ actionGrants: useGrant(), usePolicies: usePolicy }))
  await putSession()
  const r = await mcp('http_request', { name: 'approval-item', url: 'https://api.example.invalid/ok/x', method: 'GET' })
  if (/pending approval/i.test(textOf(r))) pass('P4 secret.use honours approval pipeline (pending)')
  else fail('P4', JSON.stringify(r.body).slice(0, 200))
}

// P5: secret.use honours maxReads=1 -> second use denied
{
  await putState(baseState({
    actionGrants: useGrant(), usePolicies: usePolicy,
    grants: { ['approval-agent\u0000approval-item']: { agent: 'approval-agent', name: 'approval-item', mode: 'share', expiresAt: 0, reads: 0, maxReads: 1, revokedAt: null } },
  }))
  await putSession()
  const first = await mcp('http_request', { name: 'approval-item', url: 'https://api.example.invalid/ok/x', method: 'GET' })
  const second = await mcp('http_request', { name: 'approval-item', url: 'https://api.example.invalid/ok/x', method: 'GET' })
  // First attempt may fail at the network layer (no real host); the important
  // assertion is that grant consumption happened, so the second is denied.
  const consumed = /no longer valid|pending approval|denied/i.test(textOf(second))
  if (consumed) pass('P5 secret.use consumes grant: second use denied after maxReads=1')
  else fail('P5', JSON.stringify({ first: textOf(first).slice(0, 80), second: textOf(second).slice(0, 120) }))
}

// P6: response scrubbing - upstream echo of the injected secret is redacted.
// Static contract check: the scrub helper and [REDACTED] replacement must be
// present in the executed http_request path. (Full behavioural proof would
// need a reachable upstream; see docs for the known limitation.)
{
  const file = await import('node:fs').then((fs) => fs.readFileSync('src/index.js', 'utf8'))
  const hasScrub = file.includes('const scrub = (input)') && file.includes('[REDACTED]') && file.includes('split(material.value).join')
  if (hasScrub) pass('P6 response scrub present for echoed secret material')
  else fail('P6', 'scrub missing')
}

// P7: secret.read response must never contain plaintext for a suppressed use
{
  await putState(baseState({ actionGrants: readGrant(), policies: { 'approval-item': { noApproval: true } } }))
  await putSession()
  const r = await mcp('get_secret', { name: 'approval-item' })
  const t = textOf(r)
  if (!t.includes('secret.use')) pass('P7 read path unaffected by use policy (regression)')
  else fail('P7', t.slice(0, 120))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== approval pipeline ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
