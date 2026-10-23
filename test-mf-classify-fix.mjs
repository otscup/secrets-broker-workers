// Two operator-visible bugs in classification:
//   K1 a credential that was just classified kept showing as "未分类 · 禁读",
//      because the item's id was resolved but never cached, so the reverse
//      lookup that labels the list found no name.
//   K2 an internal address was rejected with "must be https", which makes the
//      fill feature unusable on a homelab console that has no certificate.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'classify-agent-token'
const KEK = Buffer.alloc(32, 71).toString('base64')
const ITEM_ID = 'item-classify'
const ITEM = 'classify-me'
const ACCT = 'vault@example.invalid'
const AGENT = 'classify-agent'

const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'classify-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)`,
  `INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1','vault@example.invalid','k',0,600000,'2024-01-01')`,
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr('pw', E, M), totp: '', uris: [ { uri: await encryptStr('http://192.168.1.10:8080', E, M) } ] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), '', JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null).run()
}
const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
// Deliberately NO itemIds entry: this is the state the operator is in after
// adding a credential that was never shared or audited through this broker.
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({
  agents: { [AGENT]: { hash, allow: [ITEM], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
  oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  settings: { notifications: {}, vaultEmail: ACCT, requireClassification: true },
  capabilities: {}, actionGrants: {}, usePolicies: {}, itemIds: {},
  credentialKinds: {}, fillPolicies: {}, plaintextReadPolicies: {},
}) })
const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })

// The admin routes need the admin cookie; mint one the same way the Worker does.
const login = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', body: JSON.stringify({ password: 'p' }) })
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
if (!cookie) { console.log('FAIL could not obtain an admin cookie'); process.exit(1) }
const admin = (path, body) => mf.dispatchFetch('https://broker.test' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

// K1: classifying an item makes the list report its name, not an empty one.
{
  const before = await (await admin('/api/fill/policies')).json()
  const shapedBefore = (before.items || []).length
  const res = await admin('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] })
  const status = res.status
  const after = await (await admin('/api/fill/policies')).json()
  const entry = (after.items || []).find((row) => row.itemId === ITEM_ID)
  const named = entry && entry.itemName === ITEM
  if (status === 200 && named && shapedBefore === 0) pass('K1 a classified credential reports its name, so the list stops saying 未分类')
  else fail('K1', JSON.stringify({ status, shapedBefore, entry }))
}

// K2: an internal http address is accepted; a public http address is not.
{
  const priv = await admin('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['http://192.168.1.10:8080'], actions: ['login'] })
  const loop = await admin('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['localhost:3000'], actions: ['login'] })
  const pub = await admin('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['http://example.com'], actions: ['login'] })
  const ok = priv.status === 200 && loop.status === 200 && pub.status === 400
  if (ok) pass('K2 an internal http origin is accepted and a public http origin is refused')
  else fail('K2', JSON.stringify({ priv: priv.status, loop: loop.status, pub: pub.status }))
}

// K3: the accepted internal origin is stored in the canonical form and reaches
// the policy, so a fill request for it matches exactly.
{
  await admin('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['http://192.168.1.10:8080'], actions: ['login'] })
  const body = await (await admin('/api/fill/policies')).json()
  const entry = (body.items || []).find((row) => row.itemId === ITEM_ID)
  const origins = (entry && entry.origins) || []
  if (origins.includes('http://192.168.1.10:8080')) pass('K3 the internal origin is stored canonically')
  else fail('K3', JSON.stringify(origins))
}

// K4: a bare host:port from the operator becomes https, so the field is usable
// without typing a scheme.
{
  const res = await admin('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['nas.lan:5001'], actions: ['login'] })
  const body = await (await admin('/api/fill/policies')).json()
  const entry = (body.items || []).find((row) => row.itemId === ITEM_ID)
  const origins = (entry && entry.origins) || []
  const ok = res.status === 200 && origins.includes('https://nas.lan:5001')
  if (ok) pass('K4 a bare host:port is treated as https')
  else fail('K4', JSON.stringify({ status: res.status, origins }))
}

// K5: a public https origin is still exact-match only.
{
  await admin('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] })
  const res = await mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'secret.fill', arguments: { name: ITEM, origin: 'https://example.com.evil.test' } } }),
  })
  const text = JSON.stringify(await res.json().catch(() => ({})))
  if (!text.includes('taskId')) pass('K5 a near-miss public origin is still refused')
  else fail('K5', text.slice(0, 200))
}

// K6: a credential classified before the id was ever cached still shows its
// name. This is the state the real vault is in: the kind is stored against the
// id, the id->name map was never written, so the list said 未分类. Loading the
// item list must repair the mapping.
{
  await admin('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] })
  // Reproduce the broken state: classification present, mapping gone.
  const state = await (await stub.fetch('https://do/state')).json()
  state.state.itemIds = {}
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(state.state) })
  const broken = await (await admin('/api/fill/policies')).json()
  const brokenName = (broken.items || []).find((row) => row.itemId === ITEM_ID)?.itemName ?? ''
  // The item list is what the console loads, and it holds both ids and names.
  const body = await (await admin('/api/items')).json()
  const listed = (body.items || []).some((row) => row.name === ITEM && row.id === ITEM_ID)
  const after = await (await admin('/api/fill/policies')).json()
  const repaired = (after.items || []).find((row) => row.itemId === ITEM_ID)?.itemName === ITEM
  if (brokenName === '' && listed && repaired) pass('K6 loading the item list repairs a missing id->name mapping')
  else fail('K6', JSON.stringify({ brokenName, listed, repaired }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== classification + origin ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
