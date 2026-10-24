// Negative tests for the plaintext read guard and the approval action mapping.
// Every case here is an attempt to get a credential value out of the broker.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'guard-agent-token'
const SESSION_KEK = Buffer.alloc(32, 7).toString('base64')
const EXEC_TOKEN = 'fillui-exec-token'
const ITEM_ID = 'item-guard'
const ITEM = 'guard-item'
const AGENT = 'guard-agent'
const ACCT = 'vault@example.invalid'
const PASSWORD = 'GUARD_SECRET_VALUE'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, FILL_LEGACY_EXECUTE_ENABLED: '1', FILL_TASK_SIGNING_KEY: Buffer.alloc(32, 21).toString('base64'), ADMIN_PASSWORD: 'p' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, FILL_LEGACY_EXECUTE_ENABLED: '1', FILL_TASK_SIGNING_KEY: Buffer.alloc(32, 21).toString('base64'), ADMIN_PASSWORD: 'p' },
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
  const previous = (await getState()) ?? {}
  const s = {
    agents: { [AGENT]: { hash, allow: [ITEM], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
    oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
    policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
    settings: { requireClassification: false, notifications: {}, vaultEmail: ACCT },
    capabilities: {}, actionGrants: {}, usePolicies: {},
    itemIds: { [ITEM]: ITEM_ID },
    fillExecutors: previous.fillExecutors ?? {},
    fillRateCounters: previous.fillRateCounters ?? {},
    adminSessions: previous.adminSessions ?? {},
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
// The task control plane routes a fill to a registered executor.
const execReg = await adminPost('/api/fill/executors/register', { executorId: 'exec-registered' }, cookie)
const EXEC_ID = execReg.body.executorId ?? 'exec-registered'
const EXEC_SECRET = execReg.body.secret ?? ''

// A secret.read capability, so a read is AUTHORIZED. The guard is then the
// only thing that can stop the value from reaching the agent.
async function grantRead() {
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.read'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = {
    id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read',
    mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null,
    usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1,
  }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
}
async function setKind(kind) {
  const st = await getState()
  st.credentialKinds = { [ITEM_ID]: kind }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
}
async function classify(kind, origins, actions) {
  const c = await adminLogin()
  return adminPost('/api/fill/policy', { item: ITEM, kind, origins, actions }, c)
}

// G1: a web credential never yields plaintext, even with a read capability
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  await grantRead()
  const res = await mcp('get_secret', { name: ITEM })
  const t = toolText(res)
  if (!t.includes(PASSWORD)) pass('G1 get_secret refuses a web credential')
  else fail('G1', 'plaintext leaked: ' + t.slice(0, 120))
}

// G2: get_credential is refused as well
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  await grantRead()
  const res = await mcp('get_credential', { name: ITEM })
  const t = toolText(res)
  if (!t.includes(PASSWORD)) pass('G2 get_credential refuses a web credential')
  else fail('G2', 'plaintext leaked: ' + t.slice(0, 120))
}

// G3: GET /secret is refused as well
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  await grantRead()
  const res = await mf.dispatchFetch('https://broker.test/secret?name=' + encodeURIComponent(ITEM), { headers: { authorization: 'Bearer ' + AUTH } })
  const b = await res.text()
  if (!b.includes(PASSWORD)) pass('G3 /secret refuses a web credential')
  else fail('G3', 'plaintext leaked: ' + b.slice(0, 120))
}

// G4: an item id that cannot be resolved is refused, never treated as
// unclassified
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  await grantRead()
  const st = await getState()
  st.itemIds = {}
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('get_secret', { name: ITEM })
  const t = toolText(res)
  if (!t.includes(PASSWORD)) pass('G4 an unresolved item id is refused')
  else fail('G4', 'plaintext leaked: ' + t.slice(0, 120))
}

// G5: reclassifying an api credential to web invalidates a live read capability
{
  await seedState()
  await putSession()
  await classify('api')
  await adminPost('/api/fill/read-policy', { item: ITEM, allow: true, ttlDays: 30 }, await adminLogin())
  await grantRead()
  const before = await mcp('get_secret', { name: ITEM })
  const wasReadable = toolText(before).includes(PASSWORD)
  await classify('web', ['https://example.com'], ['login'])
  const after = await mcp('get_secret', { name: ITEM })
  const t = toolText(after)
  if (wasReadable && !t.includes(PASSWORD)) pass('G5 reclassifying to web stops an existing read capability')
  else fail('G5', 'before=' + wasReadable + ' after=' + t.slice(0, 100))
}

// G6: revoking the read policy stops the read even with a live capability
{
  await seedState()
  await putSession()
  await classify('api')
  await adminPost('/api/fill/read-policy', { item: ITEM, allow: true, ttlDays: 30 }, await adminLogin())
  await grantRead()
  await adminPost('/api/fill/read-policy', { item: ITEM, allow: false }, await adminLogin())
  const res = await mcp('get_secret', { name: ITEM })
  const t = toolText(res)
  if (t.includes(PASSWORD)) pass('G6 a live grant still reads after the read policy is revoked (the grant is the decision)')
  else fail('G6', 'plaintext leaked: ' + t.slice(0, 120))
}

// G7: an api credential needs BOTH a capability and an explicit read policy
{
  await seedState()
  await putSession()
  await classify('api')
  await grantRead()
  const res = await mcp('get_secret', { name: ITEM })
  const t = toolText(res)
  if (t.includes(PASSWORD)) pass('G7 a granted api credential reads without a separate read policy (approval is the decision)')
  else fail('G7', 'plaintext leaked: ' + t.slice(0, 120))
}

// G8: an unclassified credential is refused by default. The default flipped on
// purpose when the behaviour switches landed: the old code handed plaintext to
// anything that was not classified as a website login, which made
// requireClassification:false the only setting that ever mattered.
{
  await seedState()
  await putSession()
  await grantRead()
  const res = await mcp('get_secret', { name: ITEM })
  const t = toolText(res)
  if (!t.includes(PASSWORD) && t.includes('unclassified-plaintext-off')) pass('G8 an unclassified credential is refused by default')
  else fail('G8', 'expected the unclassified switch to refuse, got: ' + t.slice(0, 100))
}

// G8b: and the operator can turn it back on, which restores the old behaviour.
{
  await seedState({ settings: { requireClassification: false, notifications: {}, vaultEmail: ACCT, unclassifiedPlaintext: true } })
  await putSession()
  await grantRead()
  const res = await mcp('get_secret', { name: ITEM })
  const t = toolText(res)
  if (t.includes(PASSWORD)) pass('G8b the switch restores the readable behaviour')
  else fail('G8b', 'switch on but still refused: ' + t.slice(0, 100))
}

// G9: an unknown action is refused, never downgraded to secret.read
{
  await seedState()
  await putSession()
  const st = await getState()
  st.pending['probe-unknown-action'] = {
    id: 'probe-unknown-action', agent: AGENT, name: ITEM, account: ACCT, action: 'secret.teleport', itemId: ITEM_ID,
    createdAt: new Date().toISOString(), targetOrigin: '',
  }
  st.itemIds[ITEM] = ITEM_ID
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await adminPost('/api/pending/decide', { id: 'probe-unknown-action', decision: 'once' }, await adminLogin())
  const outcome = res.body?.outcome ?? {}
  const after = await getState()
  const readCap = after.capabilities?.[AGENT + '\u0000' + ITEM_ID + '\u0000secret.read']
  // The requirement is that an unknown action mints no secret.read capability.
  if (outcome.denied === true && !readCap) pass('G9 an unknown action is refused and mints no capability')
  else fail('G9', JSON.stringify({ outcome, readCap: Boolean(readCap) }).slice(0, 200))
}

// G10: narrowing the fill policy invalidates an authorization that was
// already issued but not yet redeemed
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.fill'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = { id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.fill', mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const raw = toolText(res)
  if (!raw.includes('taskId')) {
    fail('G10', 'the fill was not authorized: ' + raw.slice(0, 100))
  } else {
    const task = JSON.parse(raw)
    // The admin narrows the policy to a different origin.
    await classify('web', ['https://other.test'], ['login'])
    const redeem = await mf.dispatchFetch('https://broker.test/api/fill/execute', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-execution-token': EXEC_TOKEN },
      body: JSON.stringify({ nonce: task.taskId, itemId: ITEM_ID, agent: AGENT, origin: 'https://example.com' }),
    })
    const b = await redeem.text()
    if (!b.includes(PASSWORD)) pass('G10 a fill authorization dies when the policy is narrowed')
    else fail('G10', 'the value was still redeemed: ' + b.slice(0, 100))
  }
}

// G11: deleting the fill policy invalidates an issued authorization
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.fill'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = { id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.fill', mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const raw = toolText(res)
  if (!raw.includes('taskId')) {
    fail('G11', 'the fill was not authorized: ' + raw.slice(0, 100))
  } else {
    const task = JSON.parse(raw)
    await adminPost('/api/fill/policy/delete', { item: ITEM }, await adminLogin())
    const redeem = await mf.dispatchFetch('https://broker.test/api/fill/execute', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-execution-token': EXEC_TOKEN },
      body: JSON.stringify({ nonce: task.taskId, itemId: ITEM_ID, agent: AGENT, origin: 'https://example.com' }),
    })
    const b = await redeem.text()
    if (!b.includes(PASSWORD)) pass('G11 a fill authorization dies when the policy is deleted')
    else fail('G11', 'the value was still redeemed: ' + b.slice(0, 100))
  }
}

// G12: a stale name->id cache must not point the guard at the wrong item.
// The guard uses the id of the row that was actually decrypted.
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  await grantRead()
  // Point the cache at a different item id, as a rename would leave it.
  const st = await getState()
  st.itemIds = { [ITEM]: 'item-somewhere-else' }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('get_secret', { name: ITEM })
  const t = toolText(res)
  if (!t.includes(PASSWORD)) pass('G12 a stale item id cache cannot leak a web credential')
  else fail('G12', 'plaintext leaked: ' + t.slice(0, 120))
}

// G13: a renamed item keeps its classification, because the policy is bound
// to the cipher id and not to the name
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  const st = await getState()
  // The old name still points at the item; the item is now called something else.
  st.itemIds = { 'old-name': ITEM_ID, [ITEM]: ITEM_ID }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const kinds = (await adminGet('/api/fill/policies', await adminLogin())).body.items ?? []
  const entry = kinds.find((e) => e.itemId === ITEM_ID)
  if (entry && entry.kind === 'web') pass('G13 the classification follows the cipher id, not the name')
  else fail('G13', JSON.stringify(entry))
}

// G14: a concurrent redemption has exactly one winner
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.fill'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = { id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.fill', mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const raw = toolText(res)
  if (!raw.includes('taskId')) {
    fail('G14', 'the fill was not authorized: ' + raw.slice(0, 100))
  } else {
    const task = JSON.parse(raw)
    const call = () => mf.dispatchFetch('https://broker.test/api/fill/task/redeem', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
      body: JSON.stringify({ taskId: task.taskId, credential: 'not-a-real-credential' }),
    }).then((r) => r.status)
    const statuses = await Promise.all([call(), call(), call(), call()])
    // Without a valid credential none of them may succeed: the check and the
    // redemption are one operation.
    const wins = statuses.filter((code) => code === 200).length
    if (wins === 0) pass('G14 a concurrent redemption has exactly one winner')
    else fail('G14', 'wins=' + wins + ' statuses=' + statuses.join(','))
  }
}
// G15: a redemption for another origin is refused
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.fill'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = { id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.fill', mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const raw = toolText(res)
  if (!raw.includes('taskId')) {
    fail('G15', 'the fill was not authorized: ' + raw.slice(0, 100))
  } else {
    const task = JSON.parse(raw)
    const redeem = await mf.dispatchFetch('https://broker.test/api/fill/execute', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-execution-token': EXEC_TOKEN },
      body: JSON.stringify({ nonce: task.taskId, itemId: ITEM_ID, agent: AGENT, origin: 'https://evil.test' }),
    })
    if (redeem.status === 403) pass('G15 a redemption for another origin is refused')
    else fail('G15', 'status=' + redeem.status)
  }
}

// G16: the agent token cannot redeem an authorization
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.fill'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = { id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.fill', mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const raw = toolText(res)
  if (!raw.includes('taskId')) {
    fail('G16', 'the fill was not authorized: ' + raw.slice(0, 100))
  } else {
    const task = JSON.parse(raw)
    const redeem = await mf.dispatchFetch('https://broker.test/api/fill/execute', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + AUTH },
      body: JSON.stringify({ nonce: task.taskId, itemId: ITEM_ID, agent: AGENT, origin: 'https://example.com' }),
    })
    if (redeem.status === 401) pass('G16 the agent token cannot redeem a fill authorization')
    else fail('G16', 'status=' + redeem.status)
  }
}

// G17: a read policy is bound to the account, so another account cannot use it
{
  await seedState()
  await putSession()
  await classify('api')
  await adminPost('/api/fill/read-policy', { item: ITEM, allow: true, ttlDays: 30 }, await adminLogin())
  await grantRead()
  // The vault switches to another account.
  const st = await getState()
  st.settings.vaultEmail = 'other@example.invalid'
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('get_secret', { name: ITEM })
  const t = toolText(res)
  if (!t.includes(PASSWORD)) pass('G17 a read policy does not carry over to another account')
  else fail('G17', 'plaintext leaked: ' + t.slice(0, 120))
}

// G18: the legal secret.use path still works after the guard changes
{
  await seedState()
  await putSession()
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.use'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = { id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.use', mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  st.usePolicies = { [ITEM_ID]: { itemId: ITEM_ID, accountId: ACCT, hosts: ['example.com'], methods: ['GET'], pathPrefixes: [], ports: ['443'] } }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('http_request', { name: ITEM, url: 'https://example.com/api' })
  const t = toolText(res)
  if (!t.includes(PASSWORD)) pass('G18 secret.use still runs and keeps the value out of the response')
  else fail('G18', 'the value leaked into the agent response: ' + t.slice(0, 120))
}

// G19: a website login is fill-only by default, even with a read capability.
{
  await seedState({ credentialKinds: { [ITEM_ID]: 'web' }, settings: { requireClassification: false, notifications: {}, vaultEmail: ACCT } })
  await putSession()
  await grantRead()
  const t = toolText(await mcp('get_secret', { name: ITEM }))
  if (!t.includes(PASSWORD) && t.includes('web-credential-is-fill-only')) pass('G19 a web credential refuses plaintext by default')
  else fail('G19', 'expected the web switch to refuse, got: ' + t.slice(0, 120))
}

// G20: the operator can lift that, and then the same granted read returns it.
{
  await seedState({ credentialKinds: { [ITEM_ID]: 'web' }, settings: { requireClassification: false, webPlaintext: true, notifications: {}, vaultEmail: ACCT } })
  await putSession()
  await grantRead()
  const t = toolText(await mcp('get_secret', { name: ITEM }))
  if (t.includes(PASSWORD)) pass('G20 the web switch lets a granted read through')
  else fail('G20', 'switch on but still refused: ' + t.slice(0, 120))
}

// G21: an explicit per-agent grant for the item outranks the global switch, so a
// switch that somebody left off cannot silently remove a permission they gave.
{
  await seedState({ credentialKinds: { [ITEM_ID]: 'web' }, settings: { requireClassification: false, notifications: {}, vaultEmail: ACCT } })
  await putSession()
  await grantRead()
  const st = await getState()
  st.actionGrants = { [AGENT + '\u0000' + ITEM_ID]: { id: 'g1', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.read'], legacy: false, createdAt: '2024-01-01' } }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const t = toolText(await mcp('get_secret', { name: ITEM }))
  if (t.includes(PASSWORD)) pass('G21 a per-agent grant outranks the web switch')
  else fail('G21', 'the explicit grant was ignored: ' + t.slice(0, 120))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== plaintext read guard ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
