// Unclassified credentials used to be readable in plaintext by any authorised
// agent. The switch defaults ON (deny), can be turned off, and the items list
// labels an unclassified credential so the risk is visible.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 167).toString('base64')
const ACCT = 'cls@example.invalid'
const AGENT = 'cls-agent'
const TOKEN = 'cls-agent-token'
const ITEM = 'unclassified-item'
const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'cls-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
await db.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)')
await db.exec('CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)')
await db.prepare('INSERT OR REPLACE INTO users (id,email,key,kdf_type,kdf_iterations,created_at) VALUES (?,?,?,?,?,?)').bind('u1', ACCT, 'k', 0, 600000, new Date().toISOString()).run()
const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
const ITEM_ID = 'cls-item-id'
const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr('super-plain-value', E, M), totp: '', uris: [] } }
await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), '', JSON.stringify(data), null, null, null, new Date().toISOString(), new Date().toISOString(), null).run()

// Same derivation the worker uses: base64(SHA-256(token)).
const AGENT_HASH = (await import('node:crypto')).createHash('sha256').update(TOKEN).digest('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const seed = (overrides = {}) => stub.fetch('https://do/state', {
  method: 'PUT', body: JSON.stringify({
    agents: { [AGENT]: { name: AGENT, allow: [], groups: [], allowAll: true, account: ACCT, hash: AGENT_HASH } },
    policies: {}, grants: {}, pending: {}, audit: [], itemIds: { [ITEM]: ITEM_ID }, legacyItemBindings: {},
    capabilities: {}, actionGrants: {}, usePolicies: {},
    settings: { vaultEmail: ACCT, notifications: {} }, profile: {},
    security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' },
    ...overrides,
  }),
})
const putSession = () => {
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.from(E).toString('base64'), symMacKey: Buffer.from(M).toString('base64'), expiresAt: 0 })
  return wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64'))
    .then((wrapped) => stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) }))
}
const adminLogin = async () => {
  const res = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })
  return String(res.headers.get('set-cookie') || '').split(';')[0]
}
// The agent reads through MCP with its bearer token.
const agentRead = () => mf.dispatchFetch('https://broker.test/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_secret', arguments: { name: ITEM } } }),
}).then((r) => r.text())

// A live read capability, which is what the plaintext guard is applied on top
// of. Issued directly so the test measures the classification rule.
const grantAccess = async () => {
  const cookie = await adminLogin()
  const st = await stub.fetch('https://do/state').then((r) => r.json()).then((p) => p.state)
  st.capabilities ??= {}
  const key = AGENT + '\u0000' + ITEM_ID + '\u0000secret.read'
  st.capabilities[key] = {
    id: key, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read',
    mode: 'preapproved', createdAt: new Date().toISOString(), createdBy: 'test',
    expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1,
  }
  st.grants ??= {}
  st.grants[AGENT + '\u0000' + ITEM] = { agent: AGENT, name: ITEM, mode: 'share', createdAt: new Date().toISOString(), expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT, itemId: ITEM_ID }
  st.itemIds = { [ITEM]: ITEM_ID }
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(st) })
  return cookie
}

// C1: the switch defaults ON, and an unclassified credential is refused.
{
  await seed()
  await putSession()
  const cookie = await grantAccess()
  const text = await agentRead()
  const refused = /unclassified|not allowed|denied/i.test(text) && !text.includes('super-plain-value')
  if (refused) pass('C1 by default an unclassified credential cannot be read in plaintext')
  else fail('C1', text.slice(0, 200))
}

// C2: the state view tells the UI the switch is on.
{
  await seed()
  await putSession()
  const cookie = await adminLogin()
  const view = await (await mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie } })).json()
  if (view.requireClassification === true) pass('C2 the state view reports the switch as on by default')
  else fail('C2', String(view.requireClassification))
}

// C3: turning it off restores the old readable behaviour.
{
  await seed()
  await putSession()
  const cookie = await grantAccess()
  const saved = await mf.dispatchFetch('https://broker.test/api/settings', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ requireClassification: false }),
  }).then((r) => r.json())
  const text = await agentRead()
  if (saved.ok && text.includes('super-plain-value')) pass('C3 turning the switch off allows the read again')
  else fail('C3', JSON.stringify({ saved, text: text.slice(0, 160) }))
}

// C4: the switch round-trips through /api/settings.
{
  await seed()
  await putSession()
  const cookie = await adminLogin()
  await mf.dispatchFetch('https://broker.test/api/settings', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ requireClassification: false }),
  })
  const off = await (await mf.dispatchFetch('https://broker.test/api/settings', { headers: { cookie } })).json()
  await mf.dispatchFetch('https://broker.test/api/settings', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ requireClassification: true }),
  })
  const on = await (await mf.dispatchFetch('https://broker.test/api/settings', { headers: { cookie } })).json()
  if (off.requireClassification === false && on.requireClassification === true) pass('C4 the switch round-trips and defaults to on when absent')
  else fail('C4', JSON.stringify({ off: off.requireClassification, on: on.requireClassification }))
}

// C5: an item classified as api WITH a read grant is still readable, so the
// switch narrows nothing that was explicitly allowed.
{
  await seed()
  await putSession()
  const cookie = await grantAccess()
  const policy = await mf.dispatchFetch('https://broker.test/api/fill/policy', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ item: ITEM, kind: 'api' }),
  }).then((r) => r.json())
  await mf.dispatchFetch('https://broker.test/api/fill/read-policy', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ item: ITEM, allow: true, ttlDays: 30 }),
  })
  const text = await agentRead()
  if (policy.ok && text.includes('super-plain-value')) pass('C5 an api credential with an explicit read grant stays readable')
  else fail('C5', JSON.stringify({ policy, text: text.slice(0, 160) }))
}

// C6: an item classified as web is never readable, switch on.
{
  await seed()
  await putSession()
  const cookie = await grantAccess()
  await mf.dispatchFetch('https://broker.test/api/fill/policy', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ item: ITEM, kind: 'web', origins: ['https://example.com'], actions: ['login'] }),
  })
  const text = await agentRead()
  if (!text.includes('super-plain-value')) pass('C6 a web credential is never readable as plaintext')
  else fail('C6', text.slice(0, 160))
}

// C7: only an authorised admin can change the switch.
{
  const res = await mf.dispatchFetch('https://broker.test/api/settings', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requireClassification: false }),
  })
  if (res.status === 401) pass('C7 only an admin can change the switch')
  else fail('C7', String(res.status))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== require classification ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
