// P3.0 task control plane: state machine, task credentials and cancellation.
// Every case is an attempt to reach a credential without the right scope.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'task-agent-token'
const SESSION_KEK = Buffer.alloc(32, 7).toString('base64')
const EXEC_TOKEN = 'fillui-exec-token'
const ITEM_ID = 'item-task'
const ITEM = 'task-item'
const AGENT = 'task-agent'
const ACCT = 'vault@example.invalid'
const PASSWORD = 'TASK_SECRET_VALUE'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, ADMIN_PASSWORD: 'p', FILL_TASK_SIGNING_KEY: Buffer.alloc(32, 21).toString('base64') },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, ADMIN_PASSWORD: 'p', FILL_TASK_SIGNING_KEY: Buffer.alloc(32, 21).toString('base64') },
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
    settings: { notifications: {}, vaultEmail: ACCT },
    capabilities: {}, actionGrants: {}, usePolicies: {},
    itemIds: { [ITEM]: ITEM_ID },
    credentialKinds: previous.credentialKinds ?? {},
    fillPolicies: previous.fillPolicies ?? {},
    plaintextReadPolicies: previous.plaintextReadPolicies ?? {},
    fillExecutors: previous.fillExecutors ?? {},
    adminSessions: previous.adminSessions ?? {},
    fillRateCounters: previous.fillRateCounters ?? {},
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

// The fill policy is keyed by the real cipher id, so resolve it from the vault.
const realItemId = await (async () => {
  const row = await db.prepare('SELECT id FROM ciphers LIMIT 1').first()
  return row?.id ?? ITEM_ID
})()

// Register an executor and keep its secret.
let executorSecret = ''
const executorSecrets = {}
let executorId = ''
{
  const res = await adminPost('/api/fill/executors/register', { executorId: 'exec-1' }, cookie)
  executorId = res.body.executorId ?? ''
  executorSecret = res.body.secret ?? ''
  executorSecrets[executorId] = executorSecret
}

function execHeaders(id = executorId, secret = executorSecret) {
  return { 'content-type': 'application/json', 'x-fill-executor-id': id, 'x-fill-executor-secret': secret }
}
async function execPost(path, body, headers) {
  return mf.dispatchFetch('https://broker.test' + path, {
    method: 'POST', headers: headers ?? execHeaders(), body: JSON.stringify(body ?? {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }))
}

// Grant the agent a secret.fill capability and create one task.
async function seedFillCapability() {
  const st = await getState()
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.fill'
  st.capabilities = st.capabilities ?? {}
  st.capabilities[key] = { id: key, subjectId: AGENT, accountId: ACCT, itemId: realItemId, itemName: ITEM, action: 'secret.fill', mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
}
await seedFillCapability()
// Classify the credential as a website login with one allowed origin.
await adminPost('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] }, cookie)

// Close every open task so the concurrency cap does not block the next case.
async function closeOpenTasks() {
  const list = await adminGet('/api/fill/tasks', cookie)
  for (const task of list.body.tasks ?? []) {
    if (['completed', 'denied', 'expired', 'cancelled', 'failed'].includes(task.state)) continue
    await adminPost('/api/fill/tasks/cancel', { taskId: task.taskId, reason: 'test-cleanup' }, cookie)
    // The report must come from the executor that owns the task.
    const owner = task.executorId
    const secret = owner === executorId ? executorSecret : executorSecrets[owner]
    if (secret) await execPost('/api/fill/tasks/report', { taskId: task.taskId, state: 'cancelled' }, execHeaders(owner, secret))
  }
}

async function ensureExecutor() {
  if (executorSecret) return
  const res = await adminPost('/api/fill/executors/register', { executorId: 'exec-fixed' }, cookie)
  executorId = res.body.executorId ?? 'exec-fixed'
  executorSecret = res.body.secret ?? ''
  executorSecrets[executorId] = executorSecret
}

async function createTask() {
  await ensureExecutor()
  await closeOpenTasks()
  await ensureExecutor()
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const raw = toolText(res)
  if (!raw.includes('taskId')) return null
  return JSON.parse(raw)
}

// T1: an agent without a registered executor gets no task
{
  const res = await adminPost('/api/fill/executors/revoke', { executorId: 'exec-1' }, cookie)
  // The shared executor is revoked as well, so the next case registers a new one.
  await adminPost('/api/fill/executors/revoke', { executorId: executorId }, cookie)
  executorSecret = ''
  const revoked = await getState()
  const live = Object.values(revoked.fillExecutors ?? {}).filter((entry) => entry && !entry.revokedAt)
  for (const entry of live) await adminPost('/api/fill/executors/revoke', { executorId: entry.executorId }, cookie)
  const raw = toolText(await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' }))
  const task = raw.includes('taskId') ? JSON.parse(raw) : null
  if (!task) pass('T1 no executor means no task is created')
  else fail('T1', 'a task was created: ' + JSON.stringify(task).slice(0, 120))
}

// T2: a task is created and the agent only learns the id and the origin
{
  await seedState()
  await putSession()
  await adminPost('/api/fill/executors/register', { executorId: 'exec-1' }, cookie)
  const reg = await adminPost('/api/fill/executors/register', { executorId: 'exec-2' }, cookie)
  executorId = reg.body.executorId ?? 'exec-2'
  executorSecret = reg.body.secret ?? ''
  await adminPost('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] }, cookie)
  await seedFillCapability()
  const task = await createTask()
  const raw = task ? JSON.stringify(task) : ''
  if (task && !raw.includes(PASSWORD) && !raw.includes('credential') && !raw.includes('secret')) pass('T2 the agent learns only the task id and the origin')
  else fail('T2', raw.slice(0, 160))
}

// T3: a forged executor identity is refused
{
  const task = await createTask()
  const claim = await execPost('/api/fill/tasks/claim', {}, execHeaders('exec-1', 'not-the-secret'))
  if (claim.status === 401) pass('T3 a forged executor identity is refused')
  else fail('T3', 'status=' + claim.status)
}

// T4: the agent cannot claim a task
{
  const res = await mf.dispatchFetch('https://broker.test/api/fill/tasks/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + AUTH },
    body: JSON.stringify({}),
  })
  if (res.status === 401) pass('T4 the agent cannot claim a task')
  else fail('T4', 'status=' + res.status)
}

// T5: the task credential is not exposed to the agent
{
  const task = await createTask()
  const raw = JSON.stringify(task)
  if (task && !raw.includes('credential') && !raw.includes('x-fill')) pass('T5 the agent never receives a task credential')
  else fail('T5', raw.slice(0, 160))
}

// T6: two executors cannot both take the same task
{
  const task = await createTask()
  const other = await adminPost('/api/fill/executors/register', { executorId: 'exec-other-' + Math.random().toString(36).slice(2, 7) }, cookie)
  const mine = await execPost('/api/fill/tasks/claim', {}, execHeaders())
  const otherClaim = await execPost('/api/fill/tasks/claim', {}, execHeaders(other.body.executorId, other.body.secret ?? ''))
  const mineGot = mine.status === 200 && mine.body.taskId === task.taskId
  const otherGotIt = otherClaim.status === 200 && otherClaim.body.taskId === task.taskId
  if (mineGot && !otherGotIt) pass('T6 two executors cannot both take the same task')
  else fail('T6', 'mine=' + mine.status + '/' + mine.body.taskId + ' other=' + otherClaim.status + '/' + otherClaim.body.taskId)
  // The second executor must not stay the newest one, or the next task is
  // routed to it instead of the executor this test holds the secret for.
  await adminPost('/api/fill/executors/revoke', { executorId: other.body.executorId }, cookie)
}

// T7: a task credential is one-shot
{
  const task = await createTask()
  const claim = await execPost('/api/fill/tasks/claim', {}, execHeaders())
  if (claim.status !== 200) {
    fail('T7', 'the claim failed: ' + claim.status + ' ' + JSON.stringify(claim.body).slice(0, 120))
  } else {
    const credential = claim.body.credential ?? ''
    const first = await execPost('/api/fill/task/redeem', { taskId: task.taskId, credential }, execHeaders())
    const second = await execPost('/api/fill/task/redeem', { taskId: task.taskId, credential }, execHeaders())
    if (first.status === 200 && first.body.password === PASSWORD && second.status === 403) pass('T7 a task credential can be redeemed only once')
    else fail('T7', 'first=' + first.status + ' ' + JSON.stringify(first.body).slice(0, 120) + ' second=' + second.status)
  }
}
// T8: a credential from another task is refused
{
  const taskA = await createTask()
  const claimA = await execPost('/api/fill/tasks/claim', {}, execHeaders())
  const taskB = await createTask()
  const res = await execPost('/api/fill/task/redeem', { taskId: taskB.taskId, credential: claimA.body.credential }, execHeaders())
  if (res.status === 403 || res.status === 409) pass('T8 a credential from another task is refused')
  else fail('T8', 'status=' + res.status)
}

// T9: a tampered credential is refused
{
  const claim = await execPost('/api/fill/tasks/claim', {}, execHeaders())
  const tampered = claim.body.credential.slice(0, -4) + 'AAAA'
  const res = await execPost('/api/fill/task/redeem', { taskId: claim.body.taskId, credential: tampered }, execHeaders())
  if (res.status === 403) pass('T9 a tampered credential is refused')
  else fail('T9', 'status=' + res.status)
}

// T10: concurrent claims give the task to exactly one executor
{
  const task = await createTask()
  const calls = [1, 2, 3, 4].map(() => execPost('/api/fill/tasks/claim', {}, execHeaders()))
  const results = await Promise.all(calls)
  const winners = results.filter((r) => r.status === 200 && r.body.taskId === task.taskId)
  if (winners.length === 1) pass('T10 concurrent claims give the task to exactly one executor')
  else fail('T10', 'winners=' + winners.length)
}

// T11: the legacy shared token cannot redeem any more
{
  const res = await mf.dispatchFetch('https://broker.test/api/fill/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fill-execution-token': 'anything' },
    body: JSON.stringify({ nonce: 'n', itemId: ITEM_ID, agent: AGENT, origin: 'https://example.com' }),
  })
  if (res.status === 410) pass('T11 the legacy shared token path is disabled')
  else fail('T11', 'status=' + res.status)
}

// T12: a cancelled task cannot redeem a credential
{
  const task = await createTask()
  const claim = await execPost('/api/fill/tasks/claim', {}, execHeaders())
  await adminPost('/api/fill/tasks/cancel', { taskId: task.taskId, reason: 'test' }, cookie)
  const res = await execPost('/api/fill/task/redeem', { taskId: claim.body.taskId, credential: claim.body.credential }, execHeaders())
  if (res.status === 409 || res.status === 403) pass('T12 a cancelled task cannot redeem a credential')
  else fail('T12', 'status=' + res.status)
}

// T13: the executor can ask whether it may continue
{
  const task = await createTask()
  await adminPost('/api/fill/tasks/cancel', { taskId: task.taskId, reason: 'test' }, cookie)
  const res = await execPost('/api/fill/tasks/status', { taskId: task.taskId }, execHeaders())
  if (res.status === 200 && res.body.cancelRequested === true) pass('T13 the executor is told that the task was cancelled')
  else fail('T13', JSON.stringify(res.body).slice(0, 140))
}

// T14: a report cannot inject a sensitive field
{
  const task = await createTask()
  await execPost('/api/fill/tasks/claim', {}, execHeaders())
  const res = await execPost('/api/fill/tasks/report', {
    taskId: task.taskId, state: 'completed', password: PASSWORD, cookie: 'sid=abc',
    html: '<html>secret</html>', authorization: 'Bearer leak', outcome: 'submitted',
  }, execHeaders())
  const raw = JSON.stringify(res.body)
  const st = await getState()
  const audit = JSON.stringify(st.audit ?? [])
  if (!raw.includes(PASSWORD) && !audit.includes(PASSWORD) && !audit.includes('sid=abc') && !audit.includes('<html>')) {
    pass('T14 a report cannot inject a sensitive field')
  } else {
    fail('T14', 'a sensitive field reached the response or the audit')
  }
}

// T15: a completed task cannot be revived
{
  const task = await createTask()
  const claim = await execPost('/api/fill/tasks/claim', {}, execHeaders())
  const running = await execPost('/api/fill/tasks/report', { taskId: claim.body.taskId, state: 'running' }, execHeaders())
  const done = await execPost('/api/fill/tasks/report', { taskId: claim.body.taskId, state: 'completed' }, execHeaders())
  const res = await execPost('/api/fill/tasks/report', { taskId: claim.body.taskId, state: 'running' }, execHeaders())
  if (running.status === 200 && done.status === 200 && res.status === 409) pass('T15 a completed task cannot be revived')
  else fail('T15', 'running=' + running.status + ' done=' + done.status + ' res=' + res.status)
}

// T16: a task for another account cannot be redeemed
{
  const task = await createTask()
  const claim = await execPost('/api/fill/tasks/claim', {}, execHeaders())
  // Unlock the vault as a different account: the session decides which
  // account a redemption runs under.
  const otherPlain = JSON.stringify({ email: 'other@example.invalid', symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  const otherWrapped = await wrapWithKek(new TextEncoder().encode(otherPlain), Buffer.from(SESSION_KEK, 'base64'))
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped: otherWrapped, expiresAt: 0 }) })
  const res = await execPost('/api/fill/task/redeem', { taskId: claim.body.taskId, credential: claim.body.credential }, execHeaders())
  await putSession()
  if (res.status === 403 || res.status === 409 || res.status === 423) pass('T16 a task cannot be redeemed under another account')
  else fail('T16', 'status=' + res.status + ' ' + JSON.stringify(res.body).slice(0, 120))
}

// T17: locking the vault cancels the open tasks
{
  const task = await createTask()
  await adminPost('/api/lock', { password: 'p' }, cookie)
  const res = await execPost('/api/fill/tasks/status', { taskId: task.taskId }, execHeaders())
  await putSession()
  if (res.status === 200 && res.body.cancelRequested === true) pass('T17 locking the vault cancels the open tasks')
  else fail('T17', JSON.stringify(res.body).slice(0, 140))
}

// T18: a policy change cancels the open tasks for that credential
{
  const task = await createTask()
  await adminPost('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://other.test'], actions: ['login'] }, cookie)
  const res = await execPost('/api/fill/tasks/status', { taskId: task.taskId }, execHeaders())
  if (res.status === 200 && res.body.cancelRequested === true) pass('T18 a policy change cancels the open tasks')
  else fail('T18', JSON.stringify(res.body).slice(0, 140))
}

// T19: the audit never contains a secret
{
  const st = await getState()
  const audit = JSON.stringify(st.audit ?? [])
  if (!audit.includes(PASSWORD) && !audit.includes(executorSecret)) pass('T19 the audit never contains a secret or an executor secret')
  else fail('T19', 'the audit leaked sensitive data')
}

// T20: the rate limit stops a flood of task creations
{
  await seedState()
  await putSession()
  await adminPost('/api/fill/executors/register', { executorId: 'exec-rl' }, cookie)
  await adminPost('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] }, cookie)
  await seedFillCapability()
  let created = 0
  for (let i = 0; i < 40; i += 1) {
    const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
    if (toolText(res).includes('taskId')) created += 1
  }
  if (created > 0 && created < 40) pass('T20 the rate limit stops a flood of task creations')
  else fail('T20', 'created=' + created)
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== fill task control plane ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
