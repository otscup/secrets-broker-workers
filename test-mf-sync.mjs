// /sync/pull hands a sibling broker the ciphertext, and nothing else.
// The endpoint is off by default, needs a credential, and must never return
// anything a reader could turn into a password without the master key.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'sync-agent-token'
const SESSION_KEK = Buffer.alloc(32, 7).toString('base64')
const AGENT = 'sync-agent'
const ACCT = 'vault@example.invalid'
const ITEM_ID = 'item-sync-1'
const ITEM_NAME = 'cloudflare-token'
const PASSWORD = 'SYNC_TEST_VALUE_41be'

const scenario = async (bindings) => {
  const mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    compatibilityDate: '2024-01-01',
    scriptPath: 'src/index.js',
    durableObjects: { BROKER_STATE: 'BrokerState' },
    bindings: { SESSION_KEK, ...bindings },
    serviceBindings: { NODEWARDEN: async () => new Response('{}') },
    d1Databases: { NODEWARDEN_DB: 'sync-db-' + Math.random().toString(36).slice(2) },
  })
  const db = await mf.getD1Database('NODEWARDEN_DB')
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)`,
    `INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', 'vault@example.invalid', 'k', 0, 600000, '2024-01-01')`,
  ]) await db.exec(sql)
  {
    const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
    const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr(PASSWORD, E, M), totp: '', uris: [] }, fields: [] }
    await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM_NAME, E, M), await encryptStr('note text', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01T00:00:00.000Z', '2024-10-01T00:00:00.000Z', null)
      .run()
  }
  const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
  const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
  const stub = ns.get(ns.idFromName('global'))
  const state = { agents: { [AGENT]: { hash, allow: [], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } }, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {}, settings: { vaultEmail: ACCT, notifications: {} }, capabilities: {}, actionGrants: {}, usePolicies: {}, credentialKinds: { [ITEM_ID]: 'api' }, itemIds: { [ITEM_NAME]: ITEM_ID } }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
  return mf
}

const pull = (mf, headers = {}) => mf.dispatchFetch('https://broker.test/sync/pull', { headers })

// S1 - off unless the deployment opts in.
{
  const mf = await scenario({})
  const r = await pull(mf, { authorization: 'Bearer ' + AUTH })
  const text = await r.text()
  const okS1 = r.status === 404 && /not enabled/.test(text)
  okS1 ? pass('S1 sync is refused until SYNC_ENABLED=1') : fail('S1', String(r.status) + ' ' + text.slice(0, 80))
  await mf.dispose()
}

// S2 - no credential, no rows.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const r = await pull(mf)
  r.status === 401 ? pass('S2 an anonymous caller gets 401') : fail('S2', String(r.status))
  await mf.dispose()
}

// S3 - an agent token gets the encrypted rows, and only those.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const body = await pull(mf, { authorization: 'Bearer ' + AUTH }).then((r) => r.json())
  const item = (body.items ?? [])[0] ?? {}
  const blob = JSON.stringify(body)
  const leaks = [PASSWORD, ITEM_NAME, 'alice', 'note text'].filter((needle) => blob.includes(needle))
  body.ok === true && body.count === 1 && item.id === ITEM_ID && item.data && item.name && leaks.length === 0
    ? pass('S3 the pull returns ciphertext and no cleartext')
    : fail('S3', JSON.stringify({ count: body.count, id: item.id, leaks }))
  await mf.dispose()
}

// S4 - a wrong token is not an empty answer: it is refused.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const r = await pull(mf, { authorization: 'Bearer not-a-token' })
  r.status === 401 ? pass('S4 a bad token is refused, not answered with nothing') : fail('S4', String(r.status))
  await mf.dispose()
}

const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== sync pull ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)