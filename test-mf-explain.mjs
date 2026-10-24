// explain_access answers "why was I refused" without reading a value.
// Every case here is a different reason an agent sees the same sentence.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'explain-agent-token'
const SESSION_KEK = Buffer.alloc(32, 9).toString('base64')
const API_ID = 'item-api'
const API = 'api-key'
const WEB_ID = 'item-web'
const WEB = 'website-login'
const AGENT = 'explain-agent'
const ACCT = 'vault@example.invalid'
const PASSWORD = 'EXPLAIN_TEST_VALUE_7f1c'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'explain-db' },
})

const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)`,
  `INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')`,
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  for (const [id, name] of [[API_ID, API], [WEB_ID, WEB]]) {
    const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr(PASSWORD, E, M), totp: '', uris: [] }, fields: [] }
    await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, 'u1', 1, null, await encryptStr(name, E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null)
      .run()
  }
}

const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
async function putSession() {
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0, issuedAt: Date.now() })
  const wrapped = await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(SESSION_KEK, 'base64'))
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
}
async function seedState(extra = {}) {
  const previous = (await stub.fetch('https://state/state').then((r) => r.json()))?.state ?? {}
  const s = {
    agents: { [AGENT]: { hash, allow: [API, WEB], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
    oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
    policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
    settings: { requireClassification: false, notifications: {}, vaultEmail: ACCT },
    capabilities: {}, actionGrants: {}, usePolicies: {},
    credentialKinds: { [API_ID]: 'api', [WEB_ID]: 'web' },
    itemIds: { [API]: API_ID, [WEB]: WEB_ID },
    fillExecutors: previous.fillExecutors ?? {},
    fillRateCounters: previous.fillRateCounters ?? {},
    adminSessions: previous.adminSessions ?? {},
    ...extra,
  }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
}
function call(tool, args) {
  return mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  }).then(async (r) => { const b = await r.json(); return b?.result?.content?.[0]?.text ?? '' })
}

await putSession()
await seedState()

// E1 - the tool is advertised, so a client can find it at all.
{
  const list = await mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST', headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }).then((r) => r.json())
  const names = (list?.result?.tools ?? []).map((t) => t.name)
  names.includes('explain_access') ? pass('E1 tools/list advertises explain_access') : fail('E1', names.join(','))
}

// E2 - a web credential: the kind is the reason, and the answer says so.
{
  await seedState()
  const out = JSON.parse(await call('explain_access', { name: WEB }))
  out.decision === 'deny' && out.kind === 'web' && out.reasons.some((r) => /网页登录/.test(r)) && out.suggestions.some((s) => /request_fill/.test(s))
    ? pass('E2 a website login explains the fill-only rule') : fail('E2', JSON.stringify(out))
}

// E3 - an api credential with a live read grant: allowed, and says why.
{
  const key = AGENT + String.fromCharCode(0) + API_ID + String.fromCharCode(0) + 'secret.read'
  await seedState({ capabilities: { [key]: { id: key, subjectId: AGENT, accountId: ACCT, itemId: API_ID, itemName: API, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', expiresAt: Date.now() + 3600e3, usedCount: 0, maxUses: null } } })
  const out = JSON.parse(await call('explain_access', { name: API }))
  out.decision === 'allow' && out.reason === 'capability'
    ? pass('E3 a live capability explains the allow') : fail('E3', JSON.stringify(out))
}

// E4 - an api credential with nothing granted: denial names the missing grant.
{
  await seedState()
  const out = JSON.parse(await call('explain_access', { name: API }))
  out.decision !== 'allow' && /no-capability|not-granted/.test(String(out.reason))
    ? pass('E4 no capability is reported as such') : fail('E4', JSON.stringify(out))
}

// E5 - an unknown name is a different answer from a refused one.
{
  await seedState()
  const raw = await call('explain_access', { name: 'does-not-exist' }); if (!raw.trim().startsWith('{')) { fail('E5', raw.slice(0, 200)); } const out = raw.trim().startsWith('{') ? JSON.parse(raw) : {}
  out.decision === 'deny' && out.reasons.some((r) => /没有这个条目/.test(r))
    ? pass('E5 an unknown name says the item is not here') : fail('E5', JSON.stringify(out))
}

// E6 - the whole point: it never returns the value.
{
  const key = AGENT + String.fromCharCode(0) + API_ID + String.fromCharCode(0) + 'secret.read'
  await seedState({ capabilities: { [key]: { id: key, subjectId: AGENT, accountId: ACCT, itemId: API_ID, itemName: API, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', expiresAt: Date.now() + 3600e3, usedCount: 0, maxUses: null } } })
  const raw = await call('explain_access', { name: API })
  const leak = raw.includes(PASSWORD) || raw.includes('alice')
  leak ? fail('E6', 'the explanation carried the value') : pass('E6 the explanation carries no value or username')
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== explain access ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
