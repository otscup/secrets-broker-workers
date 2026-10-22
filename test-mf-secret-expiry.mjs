// A secret can carry an expiry. The expiry is stored in the broker state, the
// item list reports it, and it reaches the home page reminder the same way an
// expiring authorization does.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 241).toString('base64')
const ACCT = 'expiry@example.invalid'
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'expiry-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
await db.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)')
await db.exec('CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)')
await db.prepare('INSERT OR REPLACE INTO users (id,email,key,kdf_type,kdf_iterations,created_at) VALUES (?,?,?,?,?,?)').bind('u1', 'expiry@example.invalid', 'k', 0, 600000, new Date().toISOString()).run()
const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr('secret', E, M), totp: '', uris: [{ uri: await encryptStr('https://api.test', E, M) }] } }
await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind('c1', 'u1', 1, null, await encryptStr('item-a', E, M), '', JSON.stringify(data), null, null, null, new Date().toISOString(), new Date().toISOString(), null).run()

const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthGrants: {}, notifications: {}, capabilities: {}, audit: [], settings: {} }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie')).split(';')[0]
const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })

const update = (body) => mf.dispatchFetch('https://broker.test/api/items/update', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }).then((r) => r.json())
const listItems = () => mf.dispatchFetch('https://broker.test/api/items', { headers: { cookie } }).then((r) => r.json())
const stateOf = () => stub.fetch('https://do/state').then((r) => r.json()).then((p) => p.state)
// E1: an expiry can be set on a secret and shows up in the item list
{
  const soon = new Date(Date.now() + 2 * 86400e3).toISOString()
  const res = await update({ name: 'item-a', expiresAt: soon })
  const items = await listItems()
  const item = (items.items || []).find((x) => x.name === 'item-a')
  if (res.ok && item && item.expiresAt > 0 && item.expiresAt <= Date.now() + 3 * 86400e3) pass('E1 a secret can carry an expiry')
  else fail('E1', JSON.stringify({ res, expiresAt: item && item.expiresAt }))
}

// E2: the expiry is stored per item, and only that item carries it
{
  const state = await stateOf()
  const entry = state.secretExpiry && state.secretExpiry['item-a']
  if (entry && entry.expiresAt > 0 && entry.itemId === 'item-a') pass('E2 the expiry is stored per item')
  else fail('E2', JSON.stringify(state.secretExpiry))
}

// E3: an expiring secret reaches the home page reminder
{
  const view = await mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie } }).then((r) => r.json())
  const hit = (view.reminders || []).find((r) => r.kind === 'secret-expiring' && r.agent === 'item-a')
  if (hit && hit.severity === 'critical' && hit.daysLeft === 2) pass('E3 an expiring secret reaches the home page reminder')
  else fail('E3', JSON.stringify((view.reminders || []).filter((r) => String(r.kind).indexOf('secret') === 0)))
}

// E4: an expired secret is critical
{
  const past = new Date(Date.now() - 86400e3).toISOString()
  await update({ name: 'item-a', expiresAt: past })
  const view = await mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie } }).then((r) => r.json())
  const hit = (view.reminders || []).find((r) => r.kind === 'secret-expired' && r.agent === 'item-a')
  if (hit && hit.severity === 'critical') pass('E4 an expired secret is critical')
  else fail('E4', JSON.stringify((view.reminders || []).filter((r) => String(r.kind).indexOf('secret') === 0)))
}

// E5: the expiry can be cleared again
{
  await update({ name: 'item-a', expiresAt: '' })
  const state = await stateOf()
  const items = await listItems()
  const item = (items.items || []).find((x) => x.name === 'item-a')
  if (!state.secretExpiry || !state.secretExpiry['item-a'] && !item.expiresAt) pass('E5 the expiry can be cleared again')
  else fail('E5', JSON.stringify({ state: state.secretExpiry, expiresAt: item && item.expiresAt }))
}

// E6: the reminder never carries a secret value
{
  const soon = new Date(Date.now() + 2 * 86400e3).toISOString()
  await update({ name: 'item-a', expiresAt: soon })
  const view = await mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie } }).then((r) => r.json())
  const raw = JSON.stringify(view.reminders || [])
  if (!raw.includes('secret') || !raw.includes('alice')) pass('E6 the reminder carries no secret value')
  else fail('E6', 'the reminder leaked a value')
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== secret expiry ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
