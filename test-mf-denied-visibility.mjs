// What this round changed, verified against the real Worker:
//   U1 the console can actually see a denial. It was written to state but never
//      exposed, so the operator had no way to find and fix it.
//   U2 a denial notification carries no approve/deny buttons: there is no
//      pending record behind it, so those buttons could only answer "handled".
//   U3 repeated denials of the same request do not notify every time.
//   U4 a use policy with hosts ['*'] allows any host, and a listed host still
//      allows only that host.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 33).toString('base64')
const ACCT = 'vault@example.invalid'
const ITEM_ID = 'item-visible'
const ITEM = 'visible-key'
const TOKEN = 'visible-agent-token'
const SECRET = 'sk-visible-1'

const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'vis-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at TEXT, updated_at TEXT)`,
  `INSERT OR REPLACE INTO users (id,email,key,kdf_type,kdf_iterations,created_at) VALUES ('u1','vault@example.invalid','k',0,600000,'2024-01-01')`,
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr(SECRET, E, M), totp: '', uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), '', JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null).run()
}
const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
// The Agent is deliberately OUT of scope: that is the case that was invisible.
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({
  agents: { 'out-agent': { hash, allow: [], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
  oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  settings: { notifications: {}, vaultEmail: ACCT, requireClassification: true },
  capabilities: {}, actionGrants: {}, usePolicies: {}, deniedAttempts: {},
  itemIds: { [ITEM]: ITEM_ID }, credentialKinds: { [ITEM_ID]: 'api' }, fillPolicies: {}, plaintextReadPolicies: {},
}) })
const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })
const mcp = async (name, args) => {
  const r = await mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  return JSON.stringify(await r.json().catch(() => ({})))
}
const login = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', body: JSON.stringify({ password: 'p' }) })
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
const admin = (path, body) => mf.dispatchFetch('https://broker.test' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

// Make a denial happen.
const denied = await mcp('get_secret', { name: ITEM })

// U1: the console GET /api/state carries the denial, with its reason.
{
  const body = await (await admin('/api/state')).json()
  const entry = (body.deniedAttempts || []).find((d) => d.name === ITEM)
  const hasReason = entry && entry.reason && entry.agent === 'out-agent'
  const refused = !denied.includes(SECRET)
  if (hasReason && refused) pass('U1 a denial reaches the console with its reason, and the value is still refused')
  else fail('U1', JSON.stringify({ entry, refused }))
}

// U3: a second attempt within the window does not notify again.
{
  const before = (await (await stub.fetch('https://do/state')).json()).state
  const priorNotified = before.deniedAttempts['deny\u0000out-agent\u0000' + ITEM + '\u0000secret.read']?.notifiedAt
  await mcp('get_secret', { name: ITEM })
  await mcp('get_secret', { name: ITEM })
  const after = (await (await stub.fetch('https://do/state')).json()).state
  const record = after.deniedAttempts['deny\u0000out-agent\u0000' + ITEM + '\u0000secret.read']
  const notReNotified = record.notifiedAt === priorNotified
  const counted = record.count >= 3
  if (priorNotified && notReNotified && counted) pass('U3 repeated denials are counted but not notified again')
  else fail('U3', JSON.stringify({ priorNotified, now: record.notifiedAt, count: record.count }))
}

// U2: the denial notification is a report, not a question. The pending-notify
// path builds allow/deny links, and there is no pending record behind a denial,
// so those buttons could only ever answer "already handled".
{
  const state = (await (await stub.fetch('https://do/state')).json()).state
  if (Object.keys(state.pending || {}).length === 0) pass('U2 a denial creates no pending record, so there is nothing to approve')
  else fail('U2', JSON.stringify(Object.keys(state.pending || {})))
}

// U4: hosts ['*'] allows any HTTPS host; a listed host allows only itself.
{
  await admin('/api/use-policy', { item: ITEM, hosts: ['*'], methods: ['GET'], ports: ['443'] })
  await admin('/api/action-grants', { agent: 'out-agent', item: ITEM, actions: ['secret.use'], terms: { 'secret.use': { duration: '1d' } } })
  // Put the agent in scope so the use path is reached rather than denied.
  const s = (await (await stub.fetch('https://do/state')).json()).state
  s.agents['out-agent'].allow = [ITEM]
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(s) })
  const anyHost = await mcp('http_request', { name: ITEM, url: 'https://anywhere.example.org/x' })
  const reachedNetwork = !anyHost.includes('agent not allowed') && !anyHost.includes('target-denied')
  // A named policy must still refuse a different host.
  await admin('/api/use-policy', { item: ITEM, hosts: ['only.example.org'], methods: ['GET'], ports: ['443'] })
  const named = await mcp('http_request', { name: ITEM, url: 'https://other.example.org/x' })
  const refusedOther = !named.includes('200') && !named.includes('ok')
  if (reachedNetwork && refusedOther) pass('U4 host * allows any host, while a named policy still refuses others')
  else fail('U4', JSON.stringify({ anyHost: anyHost.slice(0, 160), named: named.slice(0, 160) }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== visibility and throttling ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
