// Items list shows last activity and last actor; the detail-only fields
// (username, group, url) must no longer appear as columns.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 233).toString('base64')
const ACCT = 'items@example.invalid'
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') }, d1Databases: { NODEWARDEN_DB: 'items-db' } })
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const s of ['CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)', 'CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)', "INSERT OR REPLACE INTO users VALUES ('u1','items@example.invalid','k',0,600000,'2024-01-01')"]) await db.exec(s)
const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr('v', E, M), totp: '', uris: [{ uri: await encryptStr('https://api.test/x', E, M) }] }, fields: [] }
await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('c1', 'u1', 1, null, await encryptStr('item-a', E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null, null).run()

const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const ago = new Date(Date.now() - 2 * 3600e3).toISOString()
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [{ time: ago, event: 'secret.read', agent: 'muse', name: 'item-a', via: 'agent' }], settings: { notifications: {}, vaultEmail: ACCT }, itemGroups: { 'item-a': 'grp' }, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
const s0 = (await stub.fetch('https://do/state').then((r) => r.json())).state
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ ...s0, audit: [{ time: ago, event: 'secret.read', agent: 'muse', name: 'item-a', via: 'agent' }] }) })
const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })

const items = await mf.dispatchFetch('https://broker.test/api/items', { headers: { cookie } }).then((r) => r.json())
// I1: last activity + actor present
{
  const item = (items.items || []).find((x) => x.name === 'item-a')
  const hasTime = Boolean(item && item.lastActivityAt)
  const actor = item && item.lastActor
  if (hasTime && actor === 'muse') pass('I1 items carry last activity time and actor')
  else fail('I1', JSON.stringify(item && { lastActivityAt: item.lastActivityAt, lastActor: item.lastActor }))
}
// I2: detail fields still available for the detail view
{
  const item = (items.items || []).find((x) => x.name === 'item-a')
  const ok = item && item.username === 'alice' && item.group === 'grp' && String(item.url).includes('api.test')
  if (ok) pass('I2 username/group/url still returned for the detail view')
  else fail('I2', JSON.stringify(item && { u: item.username, g: item.group, url: item.url }))
}
// I3: the served UI renders the list as grouped rows, not a table, and the
// detail-only fields (username, group, url) never became columns again.
{
  const html = await mf.dispatchFetch('https://broker.test/', { headers: { cookie } }).then((r) => r.text())
  const hasCols = /<th>用户名<\/th>/.test(html) || /<th>分组<\/th>/.test(html) || /<th>网址<\/th>/.test(html)
  const grouped = /class="ios-row/.test(html) && /ios-check/.test(html)
  const showsActivity = /lastActivityAt/.test(html) && /lastActor/.test(html)
  if (!hasCols && grouped && showsActivity) pass('I3 grouped rows carry activity, no detail columns')
  else fail('I3', JSON.stringify({ hasCols, grouped, showsActivity }))
}
// I4: items with no audit history get an explicit empty marker, not a fake time
{
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('c2', 'u1', 1, null, await encryptStr('item-b', E, M), await encryptStr('', E, M), JSON.stringify({ login: { username: '', password: await encryptStr('v2', E, M), totp: '', uris: [] }, fields: [] }), null, 0, 0, '2024-01-01', '2024-01-01', null, null).run()
  const fresh = await mf.dispatchFetch('https://broker.test/api/items', { headers: { cookie } }).then((r) => r.json())
  const item = (fresh.items || []).find((x) => x.name === 'item-b')
  if (item && item.lastActivityAt === '' && item.lastActor === '') pass('I4 unseen item reports empty activity, no fabricated timestamp')
  else fail('I4', JSON.stringify(item && { t: item.lastActivityAt, a: item.lastActor }))
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== items activity ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
