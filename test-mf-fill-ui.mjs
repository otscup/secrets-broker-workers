// The admin UI for web fill: classification, exact-origin policy, the
// plaintext-read grant, and the pending approval target.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'fillui-agent-token'
const SESSION_KEK = Buffer.alloc(32, 7).toString('base64')
const EXEC_TOKEN = 'fillui-exec-token'
const ITEM_ID = 'item-fillui'
const ITEM = 'fillui-item'
const AGENT = 'fillui-agent'
const ACCT = 'vault@example.invalid'
const PASSWORD = 'fillui-secret-value'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, ADMIN_PASSWORD: 'p' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'fillui-db' },
})

const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT, organization_id TEXT)`,
  `INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')`,
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr(PASSWORD, E, M), totp: '', uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null)
    .run()
}

const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
async function putSession() {
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  const wrapped = await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(SESSION_KEK, 'base64'))
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
}
async function seedState(extra = {}) {
  const s = {
    agents: { [AGENT]: { hash, allow: [ITEM], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
    oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
    policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
    settings: { notifications: {}, vaultEmail: ACCT },
    capabilities: {}, actionGrants: {}, usePolicies: {},
    itemIds: { [ITEM]: ITEM_ID },
    ...extra,
  }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
}
function mcp(tool, args) {
  return mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}
function toolText(res) {
  const content = res.body?.result?.content?.[0]?.text ?? ''
  return typeof content === 'string' ? content : JSON.stringify(content)
}
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
async function adminGet(path, cookie) {
  return mf.dispatchFetch('https://broker.test' + path, { headers: { cookie } }).then(async (r) => ({ status: r.status, body: await r.json() }))
}

// -- Setup ---------------------------------------------------------------
await seedState()
await putSession()
const cookie = await adminLogin()

// U1: the admin can classify a credential and read the policy back
{
  const res = await adminPost('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] }, cookie)
  const list = await adminGet('/api/fill/policies', cookie)
  const entry = (list.body.items ?? []).find((e) => e.itemId === ITEM_ID)
  if (res.status === 200 && entry && entry.kind === 'web' && entry.origins[0] === 'https://example.com') {
    pass('U1 the admin can classify a credential and read the policy back')
  } else {
    fail('U1', JSON.stringify({ res: res.status, list: list.body }))
  }
}

// U2: the state the admin UI renders carries the fill policy
{
  const state = await adminGet('/api/state', cookie)
  const fp = state.body.fillPolicies
  if (fp && Array.isArray(fp.items) && fp.items.length === 1 && fp.items[0].kind === 'web') {
    pass('U2 the admin state carries the fill policy for the UI')
  } else {
    fail('U2', JSON.stringify(fp))
  }
}

// U3: the plaintext-read grant is refused by default and needs its own call
{
  const read = await mcp('get_secret', { name: ITEM })
  const text = toolText(read)
  if (!text.includes(PASSWORD) && text.includes('not allowed')) pass('U3 a web credential is not readable as plaintext')
  else fail('U3', text.slice(0, 160))
}

// U4: an api credential is still not readable without an explicit grant
{
  await adminPost('/api/fill/policy', { item: ITEM, kind: 'api' }, cookie)
  const read = await mcp('get_secret', { name: ITEM })
  const text = toolText(read)
  if (!text.includes(PASSWORD) && text.includes('not allowed')) pass('U4 an api credential needs an explicit read grant')
  else fail('U4', text.slice(0, 160))
}

// U5: the explicit grant opens the read path and is reported in the listing
{
  const grant = await adminPost('/api/fill/read-policy', { item: ITEM, allow: true, ttlDays: 30 }, cookie)
  const list = await adminGet('/api/fill/policies', cookie)
  const entry = (list.body.items ?? []).find((e) => e.itemId === ITEM_ID)
  if (grant.status === 200 && entry && entry.plaintextRead === true) pass('U5 the read grant is stored and reported')
  else fail('U5', JSON.stringify({ grant: grant.status, entry }))
}

// U6: a web credential can never be granted a plaintext read
{
  await adminPost('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] }, cookie)
  const grant = await adminPost('/api/fill/read-policy', { item: ITEM, allow: true }, cookie)
  if (grant.status === 400) pass('U6 a web credential is refused a plaintext read')
  else fail('U6', 'status=' + grant.status)
}

// U7: the agent cannot change the classification
{
  const res = await mf.dispatchFetch('https://broker.test/api/fill/policy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + AUTH },
    body: JSON.stringify({ item: ITEM, kind: 'api' }),
  })
  if (res.status === 401) pass('U7 the agent cannot change the classification')
  else fail('U7', 'status=' + res.status)
}

// U8: the agent write path cannot smuggle a classification field
{
  const res = await mf.dispatchFetch('https://broker.test/agent/items/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + AUTH },
    body: JSON.stringify({ name: ITEM, credentialKind: 'api', plaintextRead: true }),
  })
  const st = await getState()
  if (st.credentialKinds?.[ITEM_ID] === 'web') pass('U8 the agent write path cannot set the classification')
  else fail('U8', 'kind=' + st.credentialKinds[ITEM_ID])
}

// U9: a pending fill request exposes the target origin to the approver
{
  const st = await getState()
  const key = AGENT + ' ' + ITEM_ID + ' secret.fill'
  st.capabilities = {}
  st.actionGrants = st.actionGrants ?? {}
  st.actionGrants[AGENT + ' ' + ITEM_ID] = { agent: AGENT, itemId: ITEM_ID, actions: ['secret.fill'], accountId: ACCT }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const state = await adminGet('/api/state', cookie)
  const pending = (state.body.pending ?? [])[0]
  if (pending && pending.action === 'secret.fill' && pending.targetOrigin === 'https://example.com') {
    pass('U9 the pending request carries the action and the target origin')
  } else {
    fail('U9', JSON.stringify({ res: toolText(res).slice(0, 120), pending }))
  }
}

// U10: approving a fill with a missing target is refused
{
  const st = await getState()
  const pendingId = Object.keys(st.pending ?? {})[0]
  st.pending[pendingId].targetOrigin = ''
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await adminPost('/api/pending/decide', { id: pendingId, decision: 'once' }, cookie)
  const outcome = res.body?.outcome ?? {}
  if (outcome.denied === true && outcome.error === 'fill-target-missing') pass('U10 approving a fill without a target is refused')
  else fail('U10', JSON.stringify(res.body).slice(0, 220))
}

// U11: approving a fill whose target is not in the policy is refused
{
  const st = await getState()
  const pendingId = 'manual-target-test'
  st.pending[pendingId] = {
    id: pendingId, agent: AGENT, name: ITEM, account: ACCT, action: 'secret.fill',
    createdAt: new Date().toISOString(), targetOrigin: 'https://evil.test',
  }
  st.itemIds[ITEM] = ITEM_ID
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await adminPost('/api/pending/decide', { id: pendingId, decision: 'once' }, cookie)
  const outcome = res.body?.outcome ?? {}
  if (outcome.denied === true && outcome.error === 'fill-target-not-allowed') pass('U11 approving a fill for an unlisted origin is refused')
  else fail('U11', JSON.stringify(res.body).slice(0, 220))
}

// U12: approving a fill mints a fill capability, never a plaintext read
{
  const st = await getState()
  const pendingId = 'manual-good-target'
  st.pending[pendingId] = {
    id: pendingId, agent: AGENT, name: ITEM, account: ACCT, action: 'secret.fill',
    createdAt: new Date().toISOString(), targetOrigin: 'https://example.com',
  }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await adminPost('/api/pending/decide', { id: pendingId, decision: 'once' }, cookie)
  const after = await getState()
  const fillCap = after.capabilities?.[AGENT + ' ' + ITEM_ID + ' secret.fill']
  const readCap = after.capabilities?.[AGENT + ' ' + ITEM_ID + ' secret.read']
  if (fillCap && !readCap) pass('U12 approving a fill mints a fill capability, not a plaintext read')
  else fail('U12', JSON.stringify({ fill: Boolean(fillCap), read: Boolean(readCap), res: res.body }).slice(0, 220))
}

// U13: the delete endpoint clears the classification and its grants
{
  const res = await adminPost('/api/fill/policy/delete', { item: ITEM }, cookie)
  const st = await getState()
  if (res.status === 200 && !st.credentialKinds?.[ITEM_ID] && !st.plaintextReadPolicies?.[ITEM_ID]) {
    pass('U13 deleting a policy clears the classification and the read grant')
  } else {
    fail('U13', JSON.stringify({ status: res.status, st: st.credentialKinds }).slice(0, 200))
  }
}

// U14: a locked vault refuses the policy endpoints
{
  await stub.fetch('https://state/session', { method: 'DELETE' })
  const res = await adminPost('/api/fill/policy', { item: ITEM, kind: 'api' }, cookie)
  if (res.status === 423) pass('U14 a locked vault refuses to change the policy')
  else fail('U14', 'status=' + res.status)
  await putSession()
}


// U15: the listing carries the item name so the editor can find the policy
{
  await adminPost('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] }, cookie)
  const list = await adminGet('/api/fill/policies', cookie)
  const entry = (list.body.items ?? []).find((e) => e.itemId === ITEM_ID)
  if (entry && entry.itemName === ITEM) pass('U15 the listing carries the item name for the editor')
  else fail('U15', JSON.stringify(entry))
}

// U16: the admin state exposes the execution-layer flag so the UI can say
// plainly that no real browser is wired up yet
{
  const state = await adminGet('/api/state', cookie)
  const fp = state.body.fillPolicies
  if (fp && typeof fp.executionLayer === 'boolean') pass('U16 the admin state reports the execution-layer state')
  else fail('U16', JSON.stringify(fp))
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== fill admin UI ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
