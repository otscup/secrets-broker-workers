// P5: materialise - an approved write of one credential into one allowlisted
// file. The property under test is segregation: approving "write this into
// /tmp/.../secrets.env" must never become a standing plaintext read, and the
// path must be on the operator's list at approval time AND at redemption.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'materialize-agent-token'
const OTHER_AUTH = 'other-agent-token'
const SESSION_KEK = Buffer.alloc(32, 7).toString('base64')
const ITEM_ID = 'item-mat'
const ITEM = 'mat-item'
const AGENT = 'mat-agent'
const OTHER_AGENT = 'other-agent'
const ACCT = 'vault@example.invalid'
const VALUE = 'sk-live-materialize-4a19'
const TARGET = '/tmp/sb-materialize/secrets.env'
const WEB_ITEM = 'web-item'
const WEB_ITEM_ID = 'item-web'

const vars = { SESSION_KEK, MCP_ALLOW_READ: '1', ADMIN_PASSWORD: 'p' }

// M13 needs the Worker with reads switched off, and Miniflare cannot change vars
// after construction, so the whole harness is a factory.
async function boot(extra) {
  const mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    compatibilityDate: '2024-01-01',
    scriptPath: 'src/index.js',
    durableObjects: { BROKER_STATE: 'BrokerState' },
    vars: { ...vars, ...extra },
    bindings: { ...vars, ...extra },
    serviceBindings: { NODEWARDEN: async () => new Response('{}') },
    d1Databases: { NODEWARDEN_DB: 'mat-db' },
  })
  const db = await mf.getD1Database('NODEWARDEN_DB')
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT, organization_id TEXT)`,
    `INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')`,
  ]) await db.exec(sql)
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const rows = [
    { id: ITEM_ID, name: ITEM, password: VALUE },
    { id: WEB_ITEM_ID, name: WEB_ITEM, password: 'web-password' },
  ]
  for (const row of rows) {
    const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr(row.password, E, M), totp: '', uris: [] }, fields: [] }
    await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(row.id, 'u1', 1, null, await encryptStr(row.name, E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null)
      .run()
  }
  const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
  const stub = ns.get(ns.idFromName('global'))
  return { mf, stub }
}

const { mf, stub } = await boot({})

const sha = async (text) => Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).toString('base64')
const hash = await sha(AUTH)
const otherHash = await sha(OTHER_AUTH)
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const putState = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })

async function putSession() {
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  const wrapped = await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(SESSION_KEK, 'base64'))
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
}

function agent(name, tokenHash) {
  return { hash: tokenHash, allow: [ITEM, WEB_ITEM], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' }
}

function stateOf({ allowlist = [TARGET] } = {}) {
  return {
    agents: { [AGENT]: agent(AGENT, hash), [OTHER_AGENT]: agent(OTHER_AGENT, otherHash) },
    oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
    policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
    settings: { notifications: {}, vaultEmail: ACCT, materializePaths: allowlist },
    capabilities: {}, actionGrants: {}, usePolicies: {},
    itemIds: { [ITEM]: ITEM_ID, [WEB_ITEM]: WEB_ITEM_ID },
    credentialKinds: { [ITEM_ID]: 'api', [WEB_ITEM_ID]: 'web' },
    plaintextReadPolicies: { [ITEM_ID]: { account: ACCT, createdAt: '2024-01-01', expiresAt: Date.now() + 3600e3 } },
    adminSessions: {}, fillRateCounters: {}, materializeJobs: {},
  }
}

async function seedState(options) {
  await putState(stateOf(options))
}

const mcp = (tool, args, token = AUTH) => mf.dispatchFetch('https://broker.test/mcp', {
  method: 'POST',
  headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))

const toolText = (res) => {
  const content = res.body?.result?.content?.[0]?.text ?? ''
  return typeof content === 'string' ? content : JSON.stringify(content)
}
const toolError = (res) => res.body?.result?.isError === true

async function adminCookie() {
  const res = await mf.dispatchFetch('https://broker.test/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }),
  })
  return String(res.headers.get('set-cookie') || '').split(';')[0]
}
const adminPost = (path, body, cookie) => mf.dispatchFetch('https://broker.test' + path, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
const listTools = () => mf.dispatchFetch('https://broker.test/mcp', {
  method: 'POST', headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
}).then((r) => r.json())

// ── M1 the tools exist ───────────────────────────────────────────────────
await seedState()
await putSession()
{
  const list = await listTools()
  const names = (list.result?.tools ?? []).map((tool) => tool.name)
  if (names.includes('materialize') && names.includes('materialize_redeem')) pass('M1 materialize is advertised')
  else fail('M1', JSON.stringify(names))
}

// ── M2 a path that is not on the allowlist is refused, and queues nothing ─
{
  const before = await getState()
  const res = await mcp('materialize', { name: ITEM, path: '/etc/passwd', key: 'NOPE' })
  const after = await getState()
  const queued = Object.keys(after.pending ?? {}).length
  if (toolError(res) && queued === Object.keys(before.pending ?? {}).length) pass('M2 a path outside the allowlist is refused')
  else fail('M2', JSON.stringify({ text: toolText(res), queued }))
}

// ── M3 an allowlisted path queues one approval that names the target ─────
let jobId = ''
{
  const res = await mcp('materialize', { name: ITEM, path: TARGET, key: 'OPENAI_API_KEY' })
  const payload = JSON.parse(toolText(res))
  jobId = payload.id ?? ''
  const state = await getState()
  const entry = state.pending?.[jobId]
  if (payload.status === 'pending' && entry?.action === 'secret.materialize' && entry?.target?.path === TARGET && entry?.target?.key === 'OPENAI_API_KEY') {
    pass('M3 the request carries its target into the approval')
  } else fail('M3', JSON.stringify({ payload, entry }))
}

// ── M4 approving records a job and mints no read capability ──────────────
{
  const cookie = await adminCookie()
  const decided = await adminPost('/api/pending/decide', { id: jobId, decision: 'once' }, cookie)
  const state = await getState()
  const job = state.materializeJobs?.[jobId]
  const capabilityKey = AGENT + '\u0000' + ITEM_ID + '\u0000secret.materialize'
  const readKey = AGENT + '\u0000' + ITEM_ID + '\u0000secret.read'
  const granted = state.grants?.[AGENT + '\u0000' + ITEM]
  if (decided.status === 200 && job?.status === undefined && job?.target?.path === TARGET && !state.capabilities?.[capabilityKey] && !state.capabilities?.[readKey] && !granted) {
    pass('M4 approval records a job and mints no capability or grant')
  } else fail('M4', JSON.stringify({ job, caps: Object.keys(state.capabilities ?? {}), granted: Boolean(granted) }))
}

// ── M5 redeem hands the value over exactly once ──────────────────────────
{
  const first = await mcp('materialize_redeem', { id: jobId })
  const second = await mcp('materialize_redeem', { id: jobId })
  const state = await getState()
  const audited = (state.audit ?? []).some((entry) => entry.event === 'secret.materialize' && entry.path === TARGET && entry.key === 'OPENAI_API_KEY')
  const body = JSON.parse(toolText(first))
  if (body.value === VALUE && body.key === 'OPENAI_API_KEY' && toolError(second) && audited) pass('M5 the job redeems once, audits, then refuses')
  else fail('M5', JSON.stringify({ body, second: toolText(second), audited }))
}

// ── M6 another agent cannot redeem it ────────────────────────────────────
{
  await seedState()
  await putSession()
  const res = await mcp('materialize', { name: ITEM, path: TARGET, key: 'K1' })
  const id = JSON.parse(toolText(res)).id
  const cookie = await adminCookie()
  await adminPost('/api/pending/decide', { id, decision: 'once' }, cookie)
  const stolen = await mcp('materialize_redeem', { id }, OTHER_AUTH)
  if (toolError(stolen) && toolText(stolen) === 'unknown materialize request') pass('M6 another agent gets the same answer as "no such job"')
  else fail('M6', toolText(stolen))
}

// ── M7 a website login stays fill-only ───────────────────────────────────
{
  await seedState()
  await putSession()
  const res = await mcp('materialize', { name: WEB_ITEM, path: TARGET, key: 'K2' })
  const id = JSON.parse(toolText(res)).id
  const cookie = await adminCookie()
  await adminPost('/api/pending/decide', { id, decision: 'once' }, cookie)
  const redeemed = await mcp('materialize_redeem', { id })
  if (toolError(redeemed) && /not allowed/.test(toolText(redeemed))) pass('M7 a web credential is refused even with an approval')
  else fail('M7', toolText(redeemed))
}

// ── M8 removing the path after approval revokes the job ──────────────────
{
  await seedState()
  await putSession()
  const res = await mcp('materialize', { name: ITEM, path: TARGET, key: 'K3' })
  const id = JSON.parse(toolText(res)).id
  const cookie = await adminCookie()
  await adminPost('/api/pending/decide', { id, decision: 'once' }, cookie)
  const state = await getState()
  state.settings.materializePaths = []
  await putState(state)
  const redeemed = await mcp('materialize_redeem', { id })
  if (toolError(redeemed) && /no longer on the materialize allowlist/.test(toolText(redeemed))) pass('M8 a de-listed path stops working at redemption')
  else fail('M8', toolText(redeemed))
}

// ── M9 denying queues no job ─────────────────────────────────────────────
{
  await seedState()
  await putSession()
  const res = await mcp('materialize', { name: ITEM, path: TARGET, key: 'K4' })
  const id = JSON.parse(toolText(res)).id
  const cookie = await adminCookie()
  await adminPost('/api/pending/decide', { id, decision: 'deny' }, cookie)
  const state = await getState()
  if (!state.materializeJobs?.[id]) pass('M9 a denial creates no job')
  else fail('M9', JSON.stringify(state.materializeJobs))
}

// ── M10 ".." cannot climb out of an allowlisted directory ────────────────
// The bridge writes with path.resolve(), which collapses ".."; comparing the
// raw string let "/srv/app/../../etc/passwd" keep the allowlisted "/srv/app/"
// prefix and land outside it.
{
  await seedState({ allowlist: ['/srv/app/'] })
  await putSession()
  const before = await getState()
  const escaped = await mcp('materialize', { name: ITEM, path: '/srv/app/../../../etc/passwd', key: 'K5' })
  const after = await getState()
  const queued = Object.keys(after.pending ?? {}).length - Object.keys(before.pending ?? {}).length
  if (toolError(escaped) && queued === 0) pass('M10 a traversal path is refused and queues nothing')
  else fail('M10', JSON.stringify({ text: toolText(escaped), queued }))
}

// ── M11 a normalised path still works, and stores the collapsed form ─────
// The fix must not simply refuse everything that contains "..": a path that
// stays inside the directory is legitimate and the stored target has to be the
// collapsed one, because that is the file the bridge opens.
{
  await seedState({ allowlist: ['/srv/app/'] })
  await putSession()
  const ok = await mcp('materialize', { name: ITEM, path: '/srv/app/sub/../secrets.env', key: 'K6' })
  const state = await getState()
  const id = JSON.parse(toolText(ok)).id
  const stored = state.pending?.[id]?.target?.path
  if (!toolError(ok) && stored === '/srv/app/secrets.env') pass('M11 a traversal that stays inside is stored collapsed')
  else fail('M11', JSON.stringify({ text: toolText(ok), stored }))
}

// ── M12 a directory entry does not match a sibling with the same prefix ──
{
  await seedState({ allowlist: ['/srv/app/'] })
  await putSession()
  const sibling = await mcp('materialize', { name: ITEM, path: '/srv/app-evil/x', key: 'K7' })
  if (toolError(sibling)) pass('M12 "/srv/app-evil/x" is not inside "/srv/app/"')
  else fail('M12', toolText(sibling))
}

// ── M14 a UNC allowlist entry cannot be satisfied by a local path ────
// A UNC entry ("//server/share/") loses its leading slashes when it is
// normalised, so a local "/server/share/x" would match it while the bridge
// resolves that path somewhere else entirely. UNC entries are refused, so the
// operator cannot allow one path and get another written.
{
  const sep = String.fromCharCode(92)
  await seedState({ allowlist: [sep + sep + 'srv' + sep + 'share' + sep] })
  await putSession()
  const before = await getState()
  const reply = await mcp('materialize', { name: ITEM, path: '/srv/share/creds.env', key: 'K6' })
  const after = await getState()
  const queued = Object.keys(after.pending ?? {}).length - Object.keys(before.pending ?? {}).length
  if (toolError(reply) && queued === 0) pass('M14 a UNC allowlist entry refuses the local path it collapses to')
  else fail('M14', JSON.stringify({ text: toolText(reply), queued }))
}
// ── M13 MCP_ALLOW_READ=0 keeps the plaintext in the broker ───────────────
// Redeeming hands the value over MCP, so it is a read. A deployment that turned
// reads off must not regain them through materialize.
{
  const off = await boot({ MCP_ALLOW_READ: '0' })
  const offStub = off.stub
  const offMcp = (tool, args) => off.mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  await offStub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(stateOf()) })
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  const wrapped = await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(SESSION_KEK, 'base64'))
  await offStub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
  const res = await offMcp('materialize', { name: ITEM, path: TARGET, key: 'K8' })
  const id = JSON.parse(toolText(res)).id
  const login = await off.mf.dispatchFetch('https://broker.test/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }),
  })
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
  await off.mf.dispatchFetch('https://broker.test/api/pending/decide', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ id, decision: 'once' }),
  })
  const redeemed = await offMcp('materialize_redeem', { id })
  const body = toolText(redeemed)
  if (toolError(redeemed) && /MCP_ALLOW_READ/.test(body) && !body.includes(VALUE)) pass('M13 redeeming is refused when reads are disabled')
  else fail('M13', JSON.stringify({ text: body, isError: toolError(redeemed) }))
  await off.mf.dispose()
}

await mf.dispose()
const okay = results.filter((r) => r.ok).length
console.log(`==== materialize ${okay}/${results.length} passed ====`)
if (okay !== results.length) process.exit(1)
