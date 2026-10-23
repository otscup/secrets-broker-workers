// The auto-approval rule, end to end through the MCP path: an agent asks, the
// rule answers, and the value comes back without the operator touching anything.
// Also asserts the rule does NOT apply to a different agent, and that the grant
// it mints is attributed to auto-rule rather than to the operator.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 66).toString('base64')
const ACCT = 'vault@example.invalid'
const ITEM = 'auto-item'
const ITEM_ID = 'auto-item-id'
const SECRET = 'sk-auto-777'
const TOKEN = 'auto-agent-token'
const OTHER = 'other-agent-token'

const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'auto-db' },
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
const hashOf = async (v) => Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const put = (state) => stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(state) })
const get = async () => (await (await stub.fetch('https://do/state')).json()).state

const base = async (auto) => ({
  agents: {
    muse: { hash: await hashOf(TOKEN), allow: [ITEM], groups: [], allowAll: false, legacy: false, account: ACCT },
    codex: { hash: await hashOf(OTHER), allow: [ITEM], groups: [], allowAll: false, legacy: false, account: ACCT },
  },
  oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  capabilities: {}, actionGrants: {}, usePolicies: {}, deniedAttempts: {},
  itemIds: { [ITEM]: ITEM_ID }, credentialKinds: { [ITEM_ID]: 'api' },
  fillPolicies: {}, plaintextReadPolicies: {},
  settings: { notifications: {}, vaultEmail: ACCT, requireClassification: true, ...(auto ? { telegramAuto: auto } : {}) },
})

const mcp = async (token, name, args) => {
  const r = await mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  return JSON.stringify(await r.json().catch(() => ({})))
}
const unlock = async () => {
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })
}

// A1: with the rule live for muse, the read succeeds on the first call — no
// pending prompt, no operator action.
{
  await put(await base({ agent: 'muse', until: Date.now() + 60000 }))
  await unlock()
  const text = await mcp(TOKEN, 'get_secret', { name: ITEM })
  const state = await get()
  const auto = (state.audit || []).find((entry) => entry.event === 'request.auto-approve')
  // The plaintext guard still applies: an api credential needs a read policy, so
  // this first call may stop there. What must be true is that the APPROVAL was
  // granted without asking.
  const cap = Object.values(state.capabilities || {}).find((c) => c.subjectId === 'muse')
  const granted = Boolean(cap)
  const attributed = auto?.source === 'auto-rule'
  const noPending = Object.keys(state.pending || {}).length === 0
  if (granted && attributed && noPending) pass('A1 a live rule approves without asking, and the audit marks it auto-rule')
  else fail('A1', JSON.stringify({ granted, attributed, noPending, text: text.slice(0, 140) }))
}

// A2: the same rule does not cover a different agent. That agent never gets a
// capability; whether it lands in the pending queue or is refused outright
// depends on the action-grant model (a bare would-be request is a hard deny, by
// design), so the assertion is the one that matters: no grant.
{
  await put(await base({ agent: 'muse', until: Date.now() + 60000 }))
  await unlock()
  await mcp(OTHER, 'get_secret', { name: ITEM })
  const state = await get()
  const otherCap = Object.values(state.capabilities || {}).find((c) => c.subjectId === 'codex')
  if (!otherCap) pass('A2 the rule is scoped: another agent gets no grant')
  else fail('A2', JSON.stringify({ otherCap: Boolean(otherCap) }))
}

// A3: once the rule expires, the same agent gets nothing again.
{
  await put(await base({ agent: 'muse', until: Date.now() - 1000 }))
  await unlock()
  await mcp(TOKEN, 'get_secret', { name: ITEM })
  const state = await get()
  const cap = Object.values(state.capabilities || {}).find((c) => c.subjectId === 'muse')
  if (!cap) pass('A3 an expired rule stops approving; the agent gains nothing')
  else fail('A3', JSON.stringify({ cap: Boolean(cap) }))
}

// A4: with the plaintext policy in place, the auto-approved read returns the value.
{
  await put({ ...(await base({ agent: 'muse', until: Date.now() + 60000 })), plaintextReadPolicies: { [ITEM_ID]: { itemId: ITEM_ID, accountId: ACCT, expiresAt: Date.now() + 60000 } } })
  await unlock()
  const text = await mcp(TOKEN, 'get_secret', { name: ITEM })
  if (text.includes(SECRET)) pass('A4 with the read policy set, the auto-approved call returns the value')
  else fail('A4', text.slice(0, 200))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== auto approval ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
