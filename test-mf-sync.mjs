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

// S9 - the panel path: the operator stores the peer, an agent cannot.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const anon = await mf.dispatchFetch('https://broker.test/api/sync/remote', { method: 'POST', body: JSON.stringify({ url: 'https://peer.test', token: 'x'.repeat(20) }) })
  const cookie = await login(mf)
  const post = (body) => mf.dispatchFetch('https://broker.test/api/sync/remote', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const plain = await post({ url: 'http://peer.test', token: 'x'.repeat(20) })
  const creds = await post({ url: 'https://user:pass@peer.test', token: 'x'.repeat(20) })
  const short = await post({ url: 'https://peer.test', token: 'short' })
  anon.status === 401 && plain.status === 400 && creds.status === 400 && short.status === 400
    ? pass('S9 storing a peer needs the operator, and the address is checked')
    : fail('S9', JSON.stringify({ anon: anon.status, plain: plain.status, creds: creds.status, short: short.status }))
  await mf.dispose()
}

// S10 - comparing before anything is configured is a clear 409, not a 500.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const cookie = await login(mf)
  const r = await mf.dispatchFetch('https://broker.test/api/sync/compare', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })
  const text = await r.text()
  r.status === 409 && /还没有配置远端/.test(text) ? pass('S10 comparing without a peer says so') : fail('S10', r.status + ' ' + text.slice(0, 80))
  await mf.dispose()
}

// S11 - a failed save stores nothing, and the token never comes back out.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const cookie = await login(mf)
  await mf.dispatchFetch('https://broker.test/api/sync/remote', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://127.0.0.1:9', token: 'y'.repeat(24) }) })
  const settings = await mf.dispatchFetch('https://broker.test/api/settings', { headers: { cookie } }).then((r) => r.json()).catch(() => ({}))
  const blob = JSON.stringify(settings)
  settings.remoteBroker?.configured === false && !blob.includes('y'.repeat(24)) && !/tokenWrapped/.test(blob)
    ? pass('S11 an unreachable peer is not stored, and no token is echoed')
    : fail('S11', blob.slice(0, 160))
  await mf.dispose()
}

// S12..S14 - applying writes the peer's newer rows into this vault, and only
// those: a second run is a no-op, and a tombstone on the peer does not delete
// the local copy.
{
  const http = await import('node:http')
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  // A row this vault can actually read: same keys the session unlocks with.
  // A stranger's ciphertext is covered by S15 below.
  const remoteRow = {
    id: 'item-remote-1',
    type: 1,
    folderId: null,
    name: await encryptStr('remote-item', E, M),
    notes: null,
    data: JSON.stringify({ login: { username: await encryptStr('bob', E, M), password: await encryptStr('REMOTE_VALUE_77c1', E, M), totp: '', uris: [] }, fields: [] }),
    key: null,
    createdAt: '2024-02-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
  }
  let served = 0
  const peer = http.createServer((req, res) => {
    served += 1
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, account: ACCT, count: 1, items: [remoteRow] }))
  })
  await new Promise((r) => peer.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + peer.address().port

  const mf = await scenario({ SYNC_ENABLED: '1' })
  const anon = await mf.dispatchFetch('https://broker.test/api/sync/apply', { method: 'POST' })
  anon.status === 401 ? pass('S12 applying needs the administrator') : fail('S12', 'status ' + anon.status)

  const cookie = await login(mf)
  await mf.dispatchFetch('https://broker.test/api/unlock', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64') }) })
  const saved = await mf.dispatchFetch('https://broker.test/api/sync/remote', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ url: base, token: 'z'.repeat(24) }) })
  const saveText = await saved.text()
  const first = await mf.dispatchFetch('https://broker.test/api/sync/apply', { method: 'POST', headers: { cookie } })
  const firstBody = await first.json().catch(() => ({}))
  const db = await mf.getD1Database('NODEWARDEN_DB')
  const stored = await db.prepare('SELECT id, user_id FROM ciphers WHERE id = ?').bind(remoteRow.id).first().catch(() => null)
  saved.ok && firstBody.applied === 1 && stored?.user_id === 'u1'
    ? pass('S13 applying pulls the peer row into this vault')
    : fail('S13', JSON.stringify({ save: saveText.slice(0, 60), first: firstBody, stored }))

  const second = await mf.dispatchFetch('https://broker.test/api/sync/apply', { method: 'POST', headers: { cookie } })
  const secondBody = await second.json().catch(() => ({}))
  const count = await db.prepare('SELECT COUNT(*) AS n FROM ciphers WHERE id = ?').bind(remoteRow.id).first().catch(() => ({}))
  secondBody.applied === 0 && count?.n === 1
    ? pass('S14 applying twice changes nothing the second time')
    : fail('S14', JSON.stringify({ second: secondBody, count }))

  await mf.dispose()
  peer.close()
}

// S15 - a peer whose vault was encrypted with a different master password cannot
// be merged: the ciphertext would arrive and decrypt to an empty name.
{
  const http = await import('node:http')
  const foreignRow = {
    id: 'item-foreign-1',
    type: 1,
    folderId: null,
    name: '2.AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAA==',
    notes: null,
    data: JSON.stringify({ login: { uris: [] }, fields: [] }),
    key: null,
    createdAt: '2024-02-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
  }
  const peer = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, account: ACCT, count: 1, items: [foreignRow] }))
  })
  await new Promise((r) => peer.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + peer.address().port
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const db = await mf.getD1Database('NODEWARDEN_DB')
  const cookie = await login(mf)
  await mf.dispatchFetch('https://broker.test/api/unlock', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64') }) })
  await mf.dispatchFetch('https://broker.test/api/sync/remote', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ url: base, token: 'z'.repeat(24) }) })
  const apply = await mf.dispatchFetch('https://broker.test/api/sync/apply', { method: 'POST', headers: { cookie } })
  const body = await apply.json().catch(() => ({}))
  const landed = (await db.prepare('SELECT COUNT(*) AS n FROM ciphers WHERE id = ?').bind('item-foreign-1').first())?.n ?? 0
  apply.status === 409 && landed === 0 && /解不开/.test(String(body.error ?? ''))
    ? pass('S15 a vault with another key is refused, not merged')
    : fail('S15', JSON.stringify({ status: apply.status, landed, body }))
  await mf.dispose()
  peer.close()
}

// S16 - the rows that already got in stay invisible forever, so offer to sweep
// them out; the readable ones must survive.
{
  const mf = await scenario({ SYNC_ENABLED: '1' })
  const db = await mf.getD1Database('NODEWARDEN_DB')
  const cookie = await login(mf)
  await mf.dispatchFetch('https://broker.test/api/unlock', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64') }) })
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('item-junk-1', 'u1', 1, null, '2.AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAA==', null, JSON.stringify({ login: { uris: [] }, fields: [] }), null, 0, 0, '2024-02-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z', null)
    .run()
  const prune = await mf.dispatchFetch('https://broker.test/api/sync/prune-unreadable', { method: 'POST', headers: { cookie } })
  const pruned = await prune.json().catch(() => ({}))
  const junk = (await db.prepare('SELECT COUNT(*) AS n FROM ciphers WHERE id = ?').bind('item-junk-1').first())?.n ?? 0
  const good = (await db.prepare('SELECT COUNT(*) AS n FROM ciphers WHERE id = ?').bind(ITEM_ID).first())?.n ?? 0
  pruned.removed === 1 && junk === 0 && good === 1
    ? pass('S16 pruning removes only the rows this key cannot open')
    : fail('S16', JSON.stringify({ pruned, junk, good }))
  await mf.dispose()
}

const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== sync pull ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
