// Authorisation consistency: one decision path for the status query and the real use.
// It also covers the legacy identity binding and the fill policy revision.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'auth-agent-token'
const SESSION_KEK = Buffer.alloc(32, 7).toString('base64')
const EXEC_TOKEN = 'fillui-exec-token'
const ITEM_ID = 'item-auth'
const ITEM = 'auth-item'
const AGENT = 'auth-agent'
const ACCT = 'vault@example.invalid'
const PASSWORD = 'AUTH_SECRET_VALUE'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, FILL_TASK_SIGNING_KEY: Buffer.alloc(32, 21).toString('base64'), ADMIN_PASSWORD: 'p' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, FILL_TASK_SIGNING_KEY: Buffer.alloc(32, 21).toString('base64'), ADMIN_PASSWORD: 'p' },
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
    adminSessions: previous.adminSessions ?? {},
    fillRateCounters: previous.fillRateCounters ?? {},
    credentialKinds: previous.credentialKinds ?? {},
    fillPolicies: previous.fillPolicies ?? {},
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
const execReg = await adminPost('/api/fill/executors/register', { executorId: 'exec-auth' }, cookie)
const EXEC_ID = execReg.body.executorId ?? 'exec-auth'
const EXEC_SECRET = execReg.body.secret ?? ''

async function unboundLegacyGrant() {
  const st = await getState()
  st.grants[AGENT + '\u0000' + ITEM] = { agent: AGENT, name: ITEM, mode: 'share', createdAt: new Date().toISOString(), expiresAt: 0, reads: 0, maxReads: null, account: ACCT }
  st.legacyItemBindings = {}
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
}
async function grantRead() {
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.read'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = { id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
}
async function classify(kind, origins, actions) {
  return adminPost('/api/fill/policy', { item: ITEM, kind, origins, actions }, await adminLogin())
}

// N1: an unbound legacy grant must not be reported as allowed
{
  await seedState()
  await putSession()
  await unboundLegacyGrant()
  const req = await mcp('request_access', { name: ITEM })
  const t = toolText(req)
  if (!t.includes('already allowed') && /binding|re-grant|identity/i.test(t)) pass('N1 an unbound legacy grant is not reported as allowed')
  else fail('N1', t.slice(0, 140))
}

// N2: the status query and the real use agree
{
  await seedState()
  await putSession()
  await unboundLegacyGrant()
  const req = await mcp('request_access', { name: ITEM })
  const get = await mcp('get_secret', { name: ITEM })
  const a = toolText(req), b = toolText(get)
  if (!a.includes('already allowed') && !b.includes(PASSWORD)) pass('N2 the status query and the real use agree')
  else fail('N2', 'req=' + a.slice(0, 70) + ' get=' + b.slice(0, 70))
}

// N3: a status query does not consume the capability
{
  await seedState()
  await putSession()
  await grantRead()
  const before = await getState()
  const usedBefore = before.capabilities[AGENT + '\u0000' + ITEM_ID + '\u0000secret.read']?.usedCount ?? 0
  await mcp('request_access', { name: ITEM })
  const after = await getState()
  const usedAfter = after.capabilities[AGENT + '\u0000' + ITEM_ID + '\u0000secret.read']?.usedCount ?? 0
  if (usedBefore === usedAfter) pass('N3 a status query does not consume the capability')
  else fail('N3', 'usedCount ' + usedBefore + ' -> ' + usedAfter)
}

// N4: a status query does not migrate an unbound grant
{
  await seedState()
  await putSession()
  await unboundLegacyGrant()
  await mcp('request_access', { name: ITEM })
  const after = await getState()
  const cap = after.capabilities?.[AGENT + '\u0000' + ITEM_ID + '\u0000secret.read']
  if (!cap) pass('N4 a status query does not migrate an unbound grant')
  else fail('N4', 'a capability was created: ' + JSON.stringify(cap).slice(0, 120))
}

// N5: allowed at query time, revoked before the use
{
  await seedState()
  await putSession()
  await grantRead()
  const req = await mcp('request_access', { name: ITEM })
  const allowed = toolText(req).includes('already allowed')
  const st = await getState()
  st.capabilities[AGENT + '\u0000' + ITEM_ID + '\u0000secret.read'].revokedAt = new Date().toISOString()
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const get = await mcp('get_secret', { name: ITEM })
  const t = toolText(get)
  if (allowed && !t.includes(PASSWORD)) pass('N5 a revocation after the status query still blocks the use')
  else fail('N5', 'allowed=' + allowed + ' get=' + t.slice(0, 90))
}

// N6: an unbound grant does not inherit a same-named new credential
{
  await seedState()
  await putSession()
  await unboundLegacyGrant()
  // The item is deleted and recreated with the same name and a new id.
  const st = await getState()
  st.itemIds = { [ITEM]: 'item-recreated' }
  st.legacyItemBindings = {}
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const get = await mcp('get_secret', { name: ITEM })
  const t = toolText(get)
  if (!t.includes(PASSWORD)) pass('N6 an unbound grant does not inherit a same-named credential')
  else fail('N6', 'plaintext leaked: ' + t.slice(0, 120))
}

// N7: the re-grant binds the name to the live cipher id
{
  await seedState()
  await putSession()
  await unboundLegacyGrant()
  const res = await adminPost('/api/legacy/regrant', { agent: AGENT, item: ITEM, action: 'secret.read', duration: '7d' }, await adminLogin())
  const after = await getState()
  const binding = after.legacyItemBindings?.[AGENT + '\u0000' + ITEM]
  const cap = after.capabilities?.[AGENT + '\u0000' + ITEM_ID + '\u0000secret.read']
  if (res.status === 200 && binding?.itemId === ITEM_ID && cap) pass('N7 a re-grant binds the name to the live cipher id')
  else fail('N7', JSON.stringify({ status: res.status, binding, cap: Boolean(cap) }).slice(0, 180))
}

// N8: a re-grant does not widen the old grant
{
  await seedState()
  await putSession()
  const st = await getState()
  st.grants[AGENT + '\u0000' + ITEM] = { agent: AGENT, name: ITEM, mode: 'share', createdAt: new Date().toISOString(), expiresAt: Date.now() + 1000, reads: 0, maxReads: 1, account: ACCT }
  st.legacyItemBindings = {}
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  await adminPost('/api/legacy/regrant', { agent: AGENT, item: ITEM, action: 'secret.read', duration: 'permanent' }, await adminLogin())
  const after = await getState()
  const cap = after.capabilities?.[AGENT + '\u0000' + ITEM_ID + '\u0000secret.read']
  const old = after.grants?.[AGENT + '\u0000' + ITEM]
  if (cap && old?.revokedAt) pass('N8 a re-grant supersedes the old grant instead of inheriting it')
  else fail('N8', JSON.stringify({ cap: Boolean(cap), oldRevoked: Boolean(old?.revokedAt) }))
}

// N9: a re-grant is audited
{
  await seedState()
  await putSession()
  await unboundLegacyGrant()
  await adminPost('/api/legacy/regrant', { agent: AGENT, item: ITEM, action: 'secret.read', duration: '7d' }, await adminLogin())
  const after = await getState()
  const events = (after.audit ?? []).filter((e) => e.event === 'legacy.regrant')
  if (events.length === 1 && events[0].itemId === ITEM_ID) pass('N9 a re-grant is audited with the item id')
  else fail('N9', JSON.stringify(events).slice(0, 160))
}

// N10: the unbound legacy grants are listed for the administrator
{
  await seedState()
  await putSession()
  await unboundLegacyGrant()
  const state = await adminGet('/api/state', await adminLogin())
  const entries = state.body.legacyUnbound ?? []
  const entry = entries.find((e) => e.agent === AGENT && e.name === ITEM)
  if (entry && entry.reason === 'identity-unbound') pass('N10 the unbound legacy grants are listed for the administrator')
  else fail('N10', JSON.stringify(entries).slice(0, 160))
}

async function issueFill() {
  // The task queue holds a limited number of open tasks, so a case starts
  // from a clean one.
  const list = await adminGet('/api/fill/tasks', cookie)
  for (const task of list.body.tasks ?? []) {
    if (['completed', 'denied', 'expired', 'cancelled', 'failed'].includes(task.state)) continue
    await adminPost('/api/fill/tasks/cancel', { taskId: task.taskId, reason: 'test-cleanup' }, cookie)
  }
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.fill'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = { id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.fill', mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const raw = toolText(res)
  if (!raw.includes('taskId')) console.log('DEBUG issueFill:', raw.slice(0, 200))
  return raw.includes('taskId') ? JSON.parse(raw) : null
}
// The redemption goes through the task control plane: the executor claims the
// task, receives a one-shot credential and redeems it.
async function claimTask() {
  const res = await mf.dispatchFetch('https://broker.test/api/fill/tasks/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({}),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
async function redeem(task, origin) {
  // The task is claimed by its executor, so the credential is bound to it.
  const claim = await claimTask()
  if (claim.status !== 200) return { status: claim.status, body: JSON.stringify(claim.body) }
  if (claim.body.taskId !== task.taskId) return { status: 409, body: 'claimed a different task' }
  const res = await mf.dispatchFetch('https://broker.test/api/fill/task/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({ taskId: claim.body.taskId, credential: claim.body.credential }),
  })
  return { status: res.status, body: await res.text() }
}
// N11: a policy narrowed after the authorization was issued refuses the redemption
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  const task = await issueFill()
  if (!task) {
    fail('N11', 'the fill was not authorized')
  } else {
    await classify('web', ['https://other.test'], ['login'])
    const r = await redeem(task)
    if ((r.status === 403 || r.status === 409) && !r.body.includes(PASSWORD)) pass('N11 a narrowed policy refuses an issued authorization')
    else fail('N11', 'status=' + r.status + ' ' + r.body.slice(0, 90))
  }
}

// N12: a policy deleted after the authorization was issued refuses the redemption
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  const task = await issueFill()
  if (!task) {
    fail('N12', 'the fill was not authorized')
  } else {
    await adminPost('/api/fill/policy/delete', { item: ITEM }, await adminLogin())
    const r = await redeem(task)
    if ((r.status === 403 || r.status === 409) && !r.body.includes(PASSWORD)) pass('N12 a deleted policy refuses an issued authorization')
    else fail('N12', 'status=' + r.status + ' ' + r.body.slice(0, 90))
  }
}

// N13: a policy that is deleted and recreated does not revive the old nonce
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  const task = await issueFill()
  if (!task) {
    fail('N13', 'the fill was not authorized')
  } else {
    await adminPost('/api/fill/policy/delete', { item: ITEM }, await adminLogin())
    await classify('web', ['https://example.com'], ['login'])
    const r = await redeem(task)
    if ((r.status === 403 || r.status === 409) && !r.body.includes(PASSWORD)) pass('N13 a recreated policy does not revive an old nonce')
    else fail('N13', 'status=' + r.status + ' ' + r.body.slice(0, 90))
  }
}

// N14: a policy updated before the redemption wins: the authorization was
// issued under the previous revision, so it is refused.
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  const task = await issueFill()
  if (!task) {
    fail('N14', 'the fill was not authorized')
  } else {
    // The update completes first, then the redemption runs.
    await classify('web', ['https://example.com', 'https://other.test'], ['login'])
    const r = await redeem(task)
    if ((r.status === 403 || r.status === 409) && !r.body.includes(PASSWORD)) pass('N14 a policy updated before the redemption refuses the old authorization')
    else fail('N14', 'status=' + r.status + ' ' + r.body.slice(0, 90))
  }
}

// N15: the plaintext guard still applies to all three read paths
{
  await seedState()
  await putSession()
  await classify('web', ['https://example.com'], ['login'])
  await grantRead()
  const a = toolText(await mcp('get_secret', { name: ITEM }))
  const b = toolText(await mcp('get_credential', { name: ITEM }))
  const c = await mf.dispatchFetch('https://broker.test/secret?name=' + encodeURIComponent(ITEM), { headers: { authorization: 'Bearer ' + AUTH } })
  const cText = await c.text()
  if (!a.includes(PASSWORD) && !b.includes(PASSWORD) && !cText.includes(PASSWORD)) pass('N15 the plaintext guard holds on all three read paths')
  else fail('N15', 'a path leaked the value')
}

// N16: a legal secret.use is unaffected
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
  if (!t.includes(PASSWORD)) pass('N16 a legal secret.use still runs and keeps the value out of the response')
  else fail('N16', 'the value leaked: ' + t.slice(0, 100))
}

// N17: another agent does not inherit the authorisation
{
  await seedState()
  await putSession()
  await grantRead()
  const other = 'other-agent'
  const st = await getState()
  st.agents[other] = { hash: 'not-the-same-hash', allow: [ITEM], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const after = await getState()
  const cap = after.capabilities?.[other + '\u0000' + ITEM_ID + '\u0000secret.read']
  if (!cap) pass('N17 another agent does not inherit the authorisation')
  else fail('N17', 'a capability was minted for the other agent')
}

// N18: a re-grant for another account is refused
{
  await seedState()
  await putSession()
  const res = await adminPost('/api/legacy/regrant', { agent: AGENT, item: ITEM, action: 'secret.read', duration: 'permanent' }, await adminLogin())
  const after = await getState()
  const cap = after.capabilities?.[AGENT + '\u0000' + ITEM_ID + '\u0000secret.read']
  if (res.status === 200 && cap?.accountId === ACCT) pass('N18 a re-grant is bound to the current account')
  else fail('N18', JSON.stringify({ status: res.status, account: cap?.accountId }).slice(0, 140))
}

// N19: an unknown action is refused by the re-grant endpoint
{
  const res = await adminPost('/api/legacy/regrant', { agent: AGENT, item: ITEM, action: 'secret.teleport', duration: '7d' }, await adminLogin())
  if (res.status === 400) pass('N19 an unknown action is refused by the re-grant endpoint')
  else fail('N19', 'status=' + res.status)
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== authorisation consistency ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
