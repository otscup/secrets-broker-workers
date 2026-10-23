// Three things this round fixed:
//   S1 sharing a credential also puts it in the Agent's scope, so the Agent can
//      see the name it was just given. Scope and grant are separate layers and
//      sharing only ever wrote the grant.
//   S2 the console can hand the Agent the item list when an Agent dialog opens
//      before the 密钥 page has ever been visited, instead of an empty picker.
//   S3 the denied table is its own element, so its buttons are reachable.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'
import { uiHtml } from './src/ui.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

// S3: the denied table is bound, and its handler is a separate one.
{
  const boundToDenied = uiHtml.includes("$('denied-list').addEventListener")
  const separateCard = uiHtml.includes('id="denied-list"') && uiHtml.includes('id="card-denied"')
  // The items-box handler must not be the one wiring the denied buttons: find
  // its exact block and check that data-allow-denied is outside it.
  const itemsStart = uiHtml.indexOf("$('items-box').addEventListener")
  const itemsEnd = uiHtml.indexOf("$('agents-box').addEventListener")
  const itemsBlock = itemsStart >= 0 && itemsEnd > itemsStart ? uiHtml.slice(itemsStart, itemsEnd) : ''
  const deniedNotInItems = !itemsBlock.includes('data-allow-denied')
  if (boundToDenied && separateCard && deniedNotInItems) pass('S3 the denied table has its own click handler')
  else fail('S3', JSON.stringify({ boundToDenied, separateCard, deniedNotInItems }))
}

// S2: an Agent dialog loads the item list before rendering the picker.
{
  const ensures = uiHtml.includes('async function openAgentCreate') && uiHtml.includes('await ensureItems()')
  const hasHelper = uiHtml.includes('async function ensureItems')
  if (ensures && hasHelper) pass('S2 the Agent dialogs fetch the item list before showing the picker')
  else fail('S2', JSON.stringify({ ensures, hasHelper }))
}

// S1: the share dialog offers scope, and the API writes it.
const KEK = Buffer.alloc(32, 17).toString('base64')
const ACCT = 'vault@example.invalid'
const ITEM_ID = 'item-share'
const ITEM = 'share-me'
const AGENT = 'share-agent'
const TOKEN = 'share-agent-token'

const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'share-db' },
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
  const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr('shared-secret', E, M), totp: '', uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), '', JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null).run()
}
const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TOKEN)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({
  agents: { [AGENT]: { hash, allow: [], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
  oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  settings: { notifications: {}, vaultEmail: ACCT, requireClassification: true },
  capabilities: {}, actionGrants: {}, usePolicies: {}, deniedAttempts: {},
  itemIds: { [ITEM]: ITEM_ID }, credentialKinds: { [ITEM_ID]: 'api' }, fillPolicies: {}, plaintextReadPolicies: {},
}) })
const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })
const login = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', body: JSON.stringify({ password: 'p' }) })
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
const admin = (path, body) => mf.dispatchFetch('https://broker.test' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

// S1a: sharing with addToScope puts the item in the Agent's allow list.
{
  await admin('/api/grants/sync', { items: [ITEM], agents: [AGENT], seconds: 86400, addToScope: true })
  const state = (await (await stub.fetch('https://do/state')).json()).state
  const inScope = (state.agents[AGENT].allow || []).includes(ITEM)
  if (inScope) pass('S1 sharing with addToScope puts the item in the Agent scope')
  else fail('S1', JSON.stringify(state.agents[AGENT].allow))
}

// S1b: the Agent can now see the name via list_secrets.
{
  const r = await mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_secrets', arguments: {} } }),
  })
  const text = JSON.stringify(await r.json().catch(() => ({})))
  if (text.includes(ITEM)) pass('S1b the shared item appears in list_secrets')
  else fail('S1b', text.slice(0, 200))
}

// S1c: without addToScope, scope is untouched (the old behaviour stays available).
{
  const state = (await (await stub.fetch('https://do/state')).json()).state
  state.agents[AGENT].allow = []
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(state) })
  await admin('/api/grants/sync', { items: [ITEM], agents: [AGENT], seconds: 86400 })
  const after = (await (await stub.fetch('https://do/state')).json()).state
  const stillEmpty = (after.agents[AGENT].allow || []).length === 0
  const granted = Boolean(after.grants['share-agent\u0000share-me'])
  if (stillEmpty && granted) pass('S1c sharing without addToScope still grants access without touching scope')
  else fail('S1c', JSON.stringify({ stillEmpty, granted }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== share scope and denied buttons ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
