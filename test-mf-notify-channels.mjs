// A muted channel must stop automatic pushes, and the explicit test button must
// still reach it. The first half is the bug: enabling/disabling was only a
// checkbox in the console, the sender never read it.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'notify-agent-token'
const SESSION_KEK = Buffer.alloc(32, 9).toString('base64')
const ITEM_ID = 'item-api'
const ITEM = 'api-key'
const AGENT = 'notify-agent'
const ACCT = 'vault@example.invalid'

// Every outbound request lands here instead of the network.
const outbound = []
const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  bindings: { SESSION_KEK, MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  outboundService: async (request) => {
    outbound.push(request.url)
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  },
  d1Databases: { NODEWARDEN_DB: 'notify-db' },
})

const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)`,
  `INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')`,
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr('VALUE', E, M), totp: '', uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null)
    .run()
}

const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://state/session', {
  method: 'PUT',
  body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0, issuedAt: Date.now() })), Buffer.from(SESSION_KEK, 'base64')), expiresAt: 0 }),
})

async function seedState(notifications, extra = {}) {
  const state = {
    agents: { [AGENT]: { hash, allow: [ITEM], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
    oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
    policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
    settings: { requireClassification: false, notifications, vaultEmail: ACCT },
    capabilities: {}, actionGrants: {}, usePolicies: {},
    credentialKinds: { [ITEM_ID]: 'api' }, itemIds: { [ITEM]: ITEM_ID },
    fillExecutors: {}, fillRateCounters: {}, adminSessions: {},
    ...extra,
  }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
}

function requestAccess() {
  return mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'request_access', arguments: { name: ITEM } } }),
  }).then((r) => r.json())
}

const telegram = {
  enabled: false, botToken: 'BOT', chatId: '1',
  ntfy: {}, gotify: {}, wxpush: {},
}

// N1 - switched off: the approval is still recorded, nothing is sent.
{
  outbound.length = 0
  await seedState({ telegram })
  const body = await requestAccess()
  const text = body?.result?.content?.[0]?.text ?? ''
  const hits = outbound.filter((url) => url.includes('api.telegram.org'))
  hits.length === 0 && /not allowed/.test(text)
    ? pass('N1 a muted channel sends nothing') : fail('N1', JSON.stringify({ hits, text: text.slice(0, 200) }))
}

// N2 - switched on: the same call reaches Telegram.
{
  outbound.length = 0
  await seedState({ telegram: { ...telegram, enabled: true } })
  await requestAccess()
  const hits = outbound.filter((url) => url.includes('api.telegram.org'))
  hits.length === 1 ? pass('N2 an enabled channel sends the push') : fail('N2', JSON.stringify(hits))
}

// N3 - an older config has no `enabled` field: it must keep sending.
{
  outbound.length = 0
  await seedState({ telegram: { botToken: 'BOT', chatId: '1' } })
  await requestAccess()
  const hits = outbound.filter((url) => url.includes('api.telegram.org'))
  hits.length === 1 ? pass('N3 a config without the flag still sends') : fail('N3', JSON.stringify(hits))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== notify channels ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
