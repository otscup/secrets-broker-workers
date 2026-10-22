// P1: web fill - classification, exact-origin policy, one-shot authorization,
// atomic consumption and audit. The Agent must never obtain plaintext.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'fill-agent-token'
const SESSION_KEK = Buffer.alloc(32, 7).toString('base64')
const EXEC_TOKEN = 'exec-token-value'
const ITEM_ID = 'item-fill'
const ITEM = 'fill-item'
const AGENT = 'fill-agent'
const ACCT = 'vault@example.invalid'
const PASSWORD = 'super-secret-password'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, FILL_LEGACY_EXECUTE_ENABLED: '1', FILL_TASK_SIGNING_KEY: Buffer.alloc(32, 21).toString('base64'), ADMIN_PASSWORD: 'p' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, FILL_LEGACY_EXECUTE_ENABLED: '1', FILL_TASK_SIGNING_KEY: Buffer.alloc(32, 21).toString('base64'), ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'fill-db' },
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
    settings: { notifications: {}, vaultEmail: ACCT },
    capabilities: {}, actionGrants: {}, usePolicies: {},
    itemIds: { [ITEM]: ITEM_ID },
    fillExecutors: previous.fillExecutors ?? {},
    fillRateCounters: previous.fillRateCounters ?? {},
    adminSessions: previous.adminSessions ?? {},
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
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
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
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
}
async function adminGet(path, cookie) {
  return mf.dispatchFetch('https://broker.test' + path, { headers: { cookie } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
}

// ── Setup ────────────────────────────────────────────────────────────────
// Seed the agent, the item mapping and the vault account.
await seedState()
await putSession()
const cookie = await adminLogin()
// The task control plane routes a fill to a registered executor.
const execReg = await adminPost('/api/fill/executors/register', { executorId: 'exec-registered' }, cookie)
const EXEC_ID = execReg.body.executorId ?? 'exec-registered'
const EXEC_SECRET = execReg.body.secret ?? ''
// Classify the item as a website credential with one exact origin.
{
  const res = await adminPost('/api/fill/policy', {
    item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'],
  }, cookie)
  if (res.status === 200 && res.body.kind === 'web') pass('F1 a credential can be classified as a web credential')
  else fail('F1', JSON.stringify(res.body))
}
// The agent needs a capability for secret.fill on this item.
{
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.fill'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = {
    id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.fill',
    mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null,
    usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1,
  }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  pass('F2 a secret.fill capability is seeded')
}

// ── F3: the exact origin is accepted ─────────────────────────────────────
{
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const text = toolText(res)
  if (text.includes('taskId')) pass('F3 a fill for the exact origin is authorized')
  else fail('F3', text.slice(0, 200))
}

// ── F4: near-miss origins are refused ────────────────────────────────────
{
  const cases = [
    'https://example.com.evil.test',
    'https://evil.test',
    'https://sub.example.com',
    'https://example.com:8443',
    'http://example.com',
  ]
  let ok = true
  const detail = []
  for (const origin of cases) {
    const res = await mcp('secret.fill', { name: ITEM, origin })
    const text = toolText(res)
    if (text.includes('taskId')) { ok = false; detail.push(origin + ' was accepted') }
  }
  if (ok) pass('F4 near-miss origins are all refused')
  else fail('F4', detail.join(', '))
}

// ── F5: the Agent never receives the plaintext ───────────────────────────
{
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const raw = JSON.stringify(res.body)
  if (!raw.includes(PASSWORD) && !raw.includes('alice')) pass('F5 the Agent response contains no plaintext')
  else fail('F5', 'plaintext leaked into the agent response')
}

// ── F6: get_credential refuses a web credential ──────────────────────────
{
  const res = await mcp('get_credential', { name: ITEM })
  const text = toolText(res)
  if (!text.includes(PASSWORD) && (text.includes('not allowed') || text.includes('fill-only'))) {
    pass('F6 get_credential refuses to return a web credential')
  } else {
    fail('F6', text.slice(0, 200))
  }
}

// ── F7: get_secret refuses a web credential ──────────────────────────────
{
  const res = await mcp('get_secret', { name: ITEM })
  const text = toolText(res)
  if (!text.includes(PASSWORD) && text.includes('not allowed')) pass('F7 get_secret refuses to return a web credential')
  else fail('F7', text.slice(0, 200))
}

// Close the open tasks so the concurrency budget is free again.
async function closeOpenTasks() {
  const list = await adminGet('/api/fill/tasks', cookie)
  for (const task of list.body.tasks ?? []) {
    if (['completed', 'denied', 'expired', 'cancelled', 'failed'].includes(task.state)) continue
    await adminPost('/api/fill/tasks/cancel', { taskId: task.taskId, reason: 'test-cleanup' }, cookie)
  }
}

async function startTask() {
  await closeOpenTasks()
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const raw = toolText(res)
  if (!raw.includes('taskId')) return null
  return JSON.parse(raw)
}
// ── F8: only a registered execution layer may redeem ─────────────────────
{
  const task = await startTask()
  // The agent token must not work.
  const asAgent = await mf.dispatchFetch('https://broker.test/api/fill/task/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + AUTH },
    body: JSON.stringify({ taskId: task.taskId, credential: 'x' }),
  })
  if (asAgent.status === 401) pass('F8 the agent token cannot redeem a fill authorization')
  else fail('F8', 'status=' + asAgent.status)
}

// ── F9: the execution layer can redeem, and only once ───────────────────
{
  const task = await startTask()
  // The layer claims the task and receives a one-shot credential.
  const claim = await mf.dispatchFetch('https://broker.test/api/fill/tasks/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  if (claim.status !== 200 || !claim.body.credential) {
    fail('F9', 'the claim failed: ' + claim.status)
  } else {
    const execCall = () => mf.dispatchFetch('https://broker.test/api/fill/task/redeem', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
      body: JSON.stringify({ taskId: claim.body.taskId, credential: claim.body.credential }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
    const first = await execCall()
    if (first.status === 200 && first.body.password === PASSWORD) pass('F9 the execution layer redeems the credential once')
    else fail('F9', 'status=' + first.status + ' body=' + JSON.stringify(first.body).slice(0, 160))
    const second = await execCall()
    if (second.status === 403) pass('F10 a replayed nonce is refused')
    else fail('F10', 'status=' + second.status)
  }
}

// ── F11: concurrent redemption yields exactly one winner ────────────────
{
  const task = await startTask()
  const claim = await mf.dispatchFetch('https://broker.test/api/fill/tasks/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  const call = () => mf.dispatchFetch('https://broker.test/api/fill/task/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({ taskId: claim.body.taskId, credential: claim.body.credential }),
  }).then((r) => r.status)
  const statuses = await Promise.all([call(), call(), call(), call()])
  const wins = statuses.filter((code) => code === 200).length
  if (wins === 1) pass('F11 concurrent redemption has exactly one winner')
  else fail('F11', 'wins=' + wins + ' statuses=' + statuses.join(','))
}

// ── F12: the redemption is bound to the origin ──────────────────────────
{
  const task = await startTask()
  const claim = await mf.dispatchFetch('https://broker.test/api/fill/tasks/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  // A credential is bound to the origin of its task, so a redemption that
  // names another origin is refused.
  const res2 = await mf.dispatchFetch('https://broker.test/api/fill/task/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({ taskId: claim.body.taskId, credential: claim.body.credential, origin: 'https://evil.test' }),
  })
  if (res2.status === 403 || res2.status === 409) pass('F12 a redemption for a different origin is refused')
  else fail('F12', 'status=' + res2.status)
}

// ── F13: a locked vault stops the redemption ────────────────────────────
{
  const task = await startTask()
  const claim = await mf.dispatchFetch('https://broker.test/api/fill/tasks/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  await stub.fetch('https://state/session', { method: 'DELETE' })
  const locked = await mf.dispatchFetch('https://broker.test/api/fill/task/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({ taskId: claim.body.taskId, credential: claim.body.credential }),
  })
  if (locked.status === 423) pass('F13 a locked vault refuses the redemption')
  else fail('F13', 'status=' + locked.status)
  await putSession()
}

// ── F14: a fresh authorization is redeemable ─────────────────────────
{
  const task = await startTask()
  const claim = await mf.dispatchFetch('https://broker.test/api/fill/tasks/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  const okCall = await mf.dispatchFetch('https://broker.test/api/fill/task/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': EXEC_SECRET },
    body: JSON.stringify({ taskId: claim.body.taskId, credential: claim.body.credential }),
  })
  if (okCall.status === 200) pass('F14 a fresh authorization is redeemable')
  else fail('F14', 'status=' + okCall.status)
}


// ── F15: the audit trail keeps metadata only ───────────────────────
{
  const st = await getState()
  const audit = JSON.stringify(st.audit ?? [])
  if (!audit.includes(PASSWORD) && !audit.includes('exec-token-value')) pass('F15 the audit log contains no secret material')
  else fail('F15', 'audit contains sensitive data')
}

// ── F16: an unclassified credential is not readable as plaintext ─────────
{
  const st = await getState()
  delete st.credentialKinds
  delete st.plaintextReadPolicies
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const res = await mcp('get_secret', { name: ITEM })
  const text = toolText(res)
  if (!text.includes(PASSWORD) && text.includes('not allowed')) pass('F16 an unclassified credential is not readable')
  else fail('F16', text.slice(0, 200))
}

// ── F17: the read policy is required for an api credential ────────────
{
  const res = await adminPost('/api/fill/policy', { item: ITEM, kind: 'api' }, cookie)
  if (res.status === 200) {
    const read = await mcp('get_secret', { name: ITEM })
    const text = toolText(read)
    if (!text.includes(PASSWORD) && text.includes('not allowed')) pass('F17 an api credential still needs an explicit read policy')
    else fail('F17', text.slice(0, 200))
  } else {
    fail('F17', 'classify failed: ' + JSON.stringify(res.body))
  }
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== web fill P1 ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
