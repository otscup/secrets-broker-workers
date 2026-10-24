// /sync/pull hands a sibling broker the ciphertext, and nothing else.
// The endpoint is off by default, needs a *device* credential (never an agent
// token), and must never return anything a reader could turn into a password
// without the master key.
import { Miniflare } from 'miniflare'
import { encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'sync-agent-token'
const DEVICE_TOKEN = 'device-token-2f9c'
const SESSION_KEK = Buffer.alloc(32, 7).toString('base64')
const AGENT = 'sync-agent'
const ACCT = 'vault@example.invalid'
const ITEM_ID = 'item-sync-1'
const ITEM_NAME = 'cloudflare-token'
const PASSWORD = 'SYNC_TEST_VALUE_41be'

const sha256 = async (text) => Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).toString('base64')

const scenario = async (bindings, deviceOverrides = {}) => {
  const mf = new Miniflare({
    modules: true,
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    compatibilityDate: '2024-01-01',
    scriptPath: 'src/index.js',
    durableObjects: { BROKER_STATE: 'BrokerState' },
    bindings: { SESSION_KEK, ADMIN_PASSWORD: 'operator-pw', ...bindings },
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
  const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
  const stub = ns.get(ns.idFromName('global'))
  const state = {
    agents: { [AGENT]: { hash: await sha256(AUTH), allow: [], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
    oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {},
    security: {}, settings: { vaultEmail: ACCT, notifications: {} }, capabilities: {}, actionGrants: {}, usePolicies: {},
    syncDevices: { sdev_test: { id: 'sdev_test', name: 'local-broker', hash: await sha256(DEVICE_TOKEN), account: ACCT, createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null, revokedAt: null, ...deviceOverrides } },
    credentialKinds: { [ITEM_ID]: 'api' },
    itemIds: { [ITEM_NAME]: ITEM_ID },
  }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
  return mf
}

const login = async (mf) => {
  const r = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'operator-pw' }) })
  return String(r.headers.get('set-cookie') ?? '').split(';')[0]
}

// S1 - off unless the deployment opts in.
{
  const mf = await scenario({})
  const r = await mf.dispatchFetch('https://broker.test/sync/pull', { headers: { authorization: 'Bearer ' + DEVICE_TOKEN } })
  const text = await r.text()
  r.status === 404 && /not enabled/.test(text) ? pass('S1 sync is refused until SYNC_ENABLED=1') : fail('S1', r.status + ' ' + text.slice(0, 80))
  await mf.dispose()
}

// S2 - no credential, no rows.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const r = await mf.dispatchFetch('https://broker.test/sync/pull')
  r.status === 401 ? pass('S2 an anonymous caller gets 401') : fail('S2', String(r.status))
  await mf.dispose()
}

// S3 - a device token gets the encrypted rows, and only those.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const r = await mf.dispatchFetch('https://broker.test/sync/pull', { headers: { authorization: 'Bearer ' + DEVICE_TOKEN } })
  const body = await r.json().catch(() => ({}))
  const item = (body.items ?? [])[0] ?? {}
  const blob = JSON.stringify(body)
  const leaks = [PASSWORD, ITEM_NAME, 'alice', 'note text'].filter((needle) => blob.includes(needle))
  body.ok === true && body.count === 1 && item.id === ITEM_ID && item.data && item.name && leaks.length === 0
    ? pass('S3 a device token gets ciphertext and no cleartext')
    : fail('S3', JSON.stringify({ status: r.status, count: body.count, id: item.id, leaks }))
  await mf.dispose()
}

// S4 - a wrong token is not an empty answer, and not a 500 either.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const r = await mf.dispatchFetch('https://broker.test/sync/pull', { headers: { authorization: 'Bearer not-a-token' } })
  const text = await r.text()
  r.status === 403 && /not a sync device/.test(text) ? pass('S4 a bad token is refused, not answered with nothing') : fail('S4', r.status + ' ' + text.slice(0, 80))
  await mf.dispose()
}

// S5 - the point of the split: an agent token cannot walk the vault.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const r = await mf.dispatchFetch('https://broker.test/sync/pull', { headers: { authorization: 'Bearer ' + AUTH } })
  const text = await r.text()
  r.status === 403 && /not a sync device/.test(text) ? pass('S5 an agent token is refused') : fail('S5', r.status + ' ' + text.slice(0, 80))
  await mf.dispose()
}

// S6 - a revoked device is refused as well, even though the hash still matches.
{
  const mf = await scenario({ SYNC_ENABLED: '1' }, { revokedAt: '2026-02-01T00:00:00.000Z' })
  const r = await mf.dispatchFetch('https://broker.test/sync/pull', { headers: { authorization: 'Bearer ' + DEVICE_TOKEN } })
  r.status === 403 ? pass('S6 a revoked device is refused') : fail('S6', String(r.status))
  await mf.dispose()
}

// S7 - the device list is admin-only, and never carries the hash.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const anon = await mf.dispatchFetch('https://broker.test/api/sync/devices')
  const cookie = await login(mf)
  const listed = await mf.dispatchFetch('https://broker.test/api/sync/devices', { headers: { cookie } }).then((r) => r.json()).catch(() => ({}))
  const first = (listed.devices ?? [])[0] ?? {}
  anon.status === 401 && first.name === 'local-broker' && !('hash' in first)
    ? pass('S7 the device list is admin-only and has no hash')
    : fail('S7', JSON.stringify({ anon: anon.status, first }))
  await mf.dispose()
}

// S8 - only the operator mints one, and the token comes back exactly once.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const anon = await mf.dispatchFetch('https://broker.test/api/sync/devices/create', { method: 'POST', body: JSON.stringify({ name: 'x' }) })
  const cookie = await login(mf)
  const created = await mf.dispatchFetch('https://broker.test/api/sync/devices/create', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'home-laptop' }),
  }).then((r) => r.json()).catch(() => ({}))
  const after = await mf.dispatchFetch('https://broker.test/api/sync/devices', { headers: { cookie } }).then((r) => r.json()).catch(() => ({}))
  const device = (after.devices ?? []).find((d) => d.name === 'home-laptop') ?? {}
  const leaks = JSON.stringify(after).includes(created.token ?? ' ')
  anon.status === 401 && typeof created.token === 'string' && created.token.length > 20 && device.id && !leaks
    ? pass('S8 an admin mints a device token, and it is only shown once')
    : fail('S8', JSON.stringify({ anon: anon.status, hasToken: typeof created.token, device, leaks }))
  await mf.dispose()
}

const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== sync pull ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
