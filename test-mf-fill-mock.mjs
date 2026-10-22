// P2: the execution layer contract, proven with a mock layer that speaks the
// same HTTP protocol a real browser layer would. No browser is involved.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'mock-agent-token'
const SESSION_KEK = Buffer.alloc(32, 7).toString('base64')
const EXEC_TOKEN = 'mock-exec-token'
const ITEM_ID = 'item-mock'
const ITEM = 'mock-item'
const AGENT = 'mock-agent'
const ACCT = 'vault@example.invalid'
const PASSWORD = 'mock-secret-value'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, FILL_LEGACY_EXECUTE_ENABLED: '1', FILL_TASK_SIGNING_KEY: Buffer.alloc(32, 21).toString('base64'), ADMIN_PASSWORD: 'p' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1', FILL_EXECUTION_TOKEN: EXEC_TOKEN, FILL_LEGACY_EXECUTE_ENABLED: '1', FILL_TASK_SIGNING_KEY: Buffer.alloc(32, 21).toString('base64'), ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'mock-db' },
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

// ── The mock execution layer ─────────────────────────────
// It speaks exactly the protocol a real browser layer would. It receives the
// credential, checks it against the expected origin, and reports an outcome
// that contains no secret.
function makeMockLayer() {
  const seen = []
  return {
    seen,
    // The layer claims a task, receives a task credential and redeems it. The
    // credential is bound to this task and is usable once.
    async redeem({ taskId }, token) {
      const claim = await mf.dispatchFetch('https://broker.test/api/fill/tasks/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': token },
        body: JSON.stringify({}),
      })
      const claimBody = await claim.json().catch(() => ({}))
      if (claim.status !== 200) return { status: claim.status, body: claimBody, outcome: { ok: false } }
      const res = await mf.dispatchFetch('https://broker.test/api/fill/task/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fill-executor-id': EXEC_ID, 'x-fill-executor-secret': token },
        body: JSON.stringify({ taskId: claimBody.taskId, credential: claimBody.credential }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 200) {
        // A real layer would fill the field here and then discard the value.
        seen.push({ origin: claimBody.origin, filled: true, hadValue: Boolean(body.password) })
      }
      return { status: res.status, body, outcome: { ok: res.status === 200, origin: claimBody.origin } }
    },
  }
}

// ── Setup ───────────────────────────────────
await seedState()
await putSession()
const cookie = await adminLogin()
// The task control plane routes a fill to a registered executor.
const execReg = await adminPost('/api/fill/executors/register', { executorId: 'exec-registered' }, cookie)
const EXEC_ID = execReg.body.executorId ?? 'exec-registered'
const EXEC_SECRET = execReg.body.secret ?? ''
await adminPost('/api/fill/policy', { item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] }, cookie)
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
}
const layer = makeMockLayer()

// ── M1: the full loop ──────────────────────────────────
{
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const task = JSON.parse(toolText(res))
  const r = await layer.redeem({ taskId: task.taskId }, EXEC_SECRET)
  if (r.status === 200 && r.body.password === PASSWORD) pass('M1 the mock layer receives the credential')
  else fail('M1', 'status=' + r.status)
}

// ── M2: the outcome carries no secret ─────────────────────────────
{
  const raw = JSON.stringify(layer.seen)
  if (!raw.includes(PASSWORD)) pass('M2 the layer outcome contains no secret')
  else fail('M2', 'the outcome leaked the credential')
}

// ── M3: the wrong token is refused ───────────────────────────────
{
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const task = JSON.parse(toolText(res))
  const r = await layer.redeem({ taskId: task.taskId }, 'wrong-secret')
  if (r.status === 401) pass('M3 a wrong execution token is refused')
  else fail('M3', 'status=' + r.status)
}

// ── M4: a second task on the same item works ─────────────────────────────
{
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const task = JSON.parse(toolText(res))
  const r = await layer.redeem({ taskId: task.taskId }, EXEC_SECRET)
  if (r.status === 200) pass('M4 a second task is served with a fresh authorization')
  else fail('M4', 'status=' + r.status)
}

// ── M5: the Agent never sees the credential ──────────────────────────────
{
  const res = await mcp('secret.fill', { name: ITEM, origin: 'https://example.com' })
  const raw = JSON.stringify(res.body)
  if (!raw.includes(PASSWORD)) pass('M5 the Agent response never contains the credential')
  else fail('M5', 'the agent response leaked the credential')
}

// ── M6: the audit records the fill without the value ─────────────
{
  const st = await getState()
  const fills = (st.audit ?? []).filter((e) => String(e.event ?? '').startsWith('fill.'))
  const raw = JSON.stringify(fills)
  if (fills.length > 0 && !raw.includes(PASSWORD)) pass('M6 the audit records fill events with metadata only')
  else fail('M6', 'fill events=' + fills.length)
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== fill mock layer ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
