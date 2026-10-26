// The storage adapter: once Vault 2.0 has live rows, every console and MCP item
// path reads and writes v2, and the old ciphers table is only a read-compatible
// fallback while v2 is locked. Runs both sides against two real D1 databases.
import { Miniflare } from 'miniflare'
import { readFileSync, readdirSync } from 'node:fs'
import { encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 7).toString('base64')
const ADMIN = 'adapter-admin-password'
const MASTER = 'adapter master password'
const ACCT = 'adapter@example.invalid'
const AUTH = 'adapter-agent-token'
const AGENT = 'adapter-agent'
const OLD_ID = 'old-item-id'
const OLD_NAME = 'old-only'
const OLD_VALUE = 'old-secret-value'
const V2_NAME = 'v2-openai'
const V2_VALUE = 'sk-v2-secret'
const BASE = 'https://broker.test'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN, MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN, MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'adapter-old-db', VAULT_DB: 'adapter-v2-db' },
})

const oldDb = await mf.getD1Database('NODEWARDEN_DB')
const v2Db = await mf.getD1Database('VAULT_DB')
for (const sql of [
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)',
  'CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT, name TEXT)',
  'CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)',
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', '" + ACCT + "', 'k', 0, 600000, '2024-01-01')",
]) await oldDb.exec(sql)
for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
  const schema = readFileSync('migrations/' + file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
    await v2Db.prepare(statement).run().catch((error) => { if (!/duplicate column/i.test(String(error.message))) throw error })
  }
}

const E = Buffer.alloc(32, 1)
const M = Buffer.alloc(32, 2)
const oldNameEnc = await encryptStr(OLD_NAME, E, M)
await oldDb.prepare('INSERT INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(OLD_ID, 'u1', 1, null, oldNameEnc, await encryptStr('', E, M), JSON.stringify({ login: { username: await encryptStr('old-user', E, M), password: await encryptStr(OLD_VALUE, E, M), totp: '', uris: [] }, fields: [] }), null, 0, 0, '2024-01-01', '2024-01-01', null)
  .run()

const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const putState = (state) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })

let cookie = ''
const call = async (path, options = {}) => {
  const response = await mf.dispatchFetch(BASE + path, {
    method: options.method || 'GET',
    headers: { cookie, origin: BASE, 'content-type': 'application/json' },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}
const mcp = (tool, args) => mf.dispatchFetch(BASE + '/mcp', {
  method: 'POST',
  headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
}).then(async (response) => ({ status: response.status, body: await response.json() }))
const toolText = (result) => {
  const content = result.body?.result?.content?.[0]?.text ?? ''
  return typeof content === 'string' ? content : JSON.stringify(content)
}
const names = (body) => (body.items || []).map((item) => item.name)

const tokenHash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
await putState({
  agents: { [AGENT]: { hash: tokenHash, allow: [], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
  oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  settings: { notifications: {}, vaultEmail: ACCT }, capabilities: {}, actionGrants: {}, usePolicies: {},
})
const login = await mf.dispatchFetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: ADMIN }) })
cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
if (!cookie) { console.log('FAIL  could not log in as admin'); process.exit(1) }
const unlock = await call('/api/unlock', { method: 'POST', body: { symEncKey: E.toString('base64'), symMacKey: M.toString('base64'), ttl: 'permanent' } })
if (unlock.status !== 200) { console.log('FAIL  could not unlock the old vault: ' + JSON.stringify(unlock)); process.exit(1) }

// A1: before Vault 2.0 has rows, the item page is still the old table.
{
  const { status, body } = await call('/api/items')
  const ok = status === 200 && names(body).join(',') === OLD_NAME && body.items[0].source !== 'v2'
  if (ok) pass('A1 the old ciphers table is still the source before v2 has items')
  else fail('A1', JSON.stringify({ status, body }).slice(0, 300))
}

// A2: an empty-but-initialised v2 vault does not take over yet.
{
  const init = await call('/api/v2/init', { method: 'POST', body: { password: MASTER } })
  const { body } = await call('/api/items')
  const ok = init.status === 200 && names(body).join(',') === OLD_NAME
  if (ok) pass('A2 initialising an empty v2 vault does not hide the old list')
  else fail('A2', JSON.stringify({ init, names: names(body) }))
}

// A3: as soon as v2 has a live row it becomes the item source.
let v2Id = ''
let v2WebId = ''
{
  const created = await call('/api/v2/items', { method: 'POST', body: { kind: 'api', payload: { name: V2_NAME, username: 'v2-user', password: V2_VALUE, totp: 'JBSWY3DP', url: 'https://v2.example', notes: 'v2 notes' } } })
  v2Id = created.body.id || ''
  const web = await call('/api/v2/items', { method: 'POST', body: { kind: 'web', payload: { name: 'v2-web', username: 'web-user', password: 'web-secret', url: 'https://web.example' } } })
  v2WebId = web.body.id || ''
  const { status, body } = await call('/api/items')
  const ok = status === 200 && names(body).join(',') === 'v2-openai,v2-web' && body.items.every((item) => item.source === 'v2')
  if (ok) pass('A3 v2 rows replace the old list and are marked as the source')
  else fail('A3', JSON.stringify({ status, names: names(body), source: body.items?.map((i) => i.source) }))
}

// A4: MCP list_secrets and explain_access resolve v2 too, not just the console.
{
  const state = await getState()
  state.agents[AGENT] = { hash: tokenHash, allow: [V2_NAME], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' }
  state.itemIds = { ...(state.itemIds || {}), [V2_NAME]: v2Id }
  state.credentialKinds = { ...(state.credentialKinds || {}), [v2Id]: 'api' }
  const key = AGENT + '\u0000' + v2Id + '\u0000secret.read'
  state.capabilities = { ...(state.capabilities || {}), [key]: { id: key, subjectId: AGENT, accountId: ACCT, itemId: v2Id, itemName: V2_NAME, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 'test', expiresAt: Date.now() + 3600e3, maxUses: null, usedCount: 0, revokedAt: null, policyVersion: 1 } }
  await putState(state)
  const listed = JSON.parse(toolText(await mcp('list_secrets', {})))
  const listedName = listed.find((item) => item.name === V2_NAME)
  const outside = listed.find((item) => item.name === 'v2-web')
  const explained = JSON.parse(toolText(await mcp('explain_access', { name: V2_NAME })))
  const ok = listed.map((item) => item.name).join(',') === 'v2-openai,v2-web' &&
    listedName?.kind === 'api' && listedName?.grant_status === 'granted' &&
    outside?.requestable === true && outside?.grant_status === 'none' &&
    explained.decision === 'allow' && explained.itemId === v2Id
  if (ok) pass('A4 list_secrets and explain_access read the v2 source')
  else fail('A4', JSON.stringify({ listed, explained }).slice(0, 500))
}

// A5: the actual secret read serves the v2 payload.
{
  const text = toolText(await mcp('get_secret', { name: V2_NAME }))
  if (text.includes(V2_VALUE) && !text.includes(OLD_VALUE)) pass('A5 get_secret returns the v2 value')
  else fail('A5', text.slice(0, 400))
}

// A6: editing writes v2, keeps blank fields, and leaves the old row untouched.
{
  const updated = await call('/api/items/update', { method: 'POST', body: { name: V2_NAME, newName: 'v2-renamed', value: 'sk-v2-updated', username: 'new-user', url: 'https://new.example', notes: 'new notes', group: 'prod', totp: '' } })
  const plain = await call('/api/v2/items?plain=1')
  const row = (plain.body.items || []).find((item) => item.id === v2Id)
  const oldRow = await oldDb.prepare('SELECT name, deleted_at FROM ciphers WHERE id = ?').bind(OLD_ID).first()
  const state = await getState()
  const ok = updated.status === 200 && row?.payload?.name === 'v2-renamed' && row.payload.password === 'sk-v2-updated' && row.payload.username === 'new-user' && row.payload.totp === 'JBSWY3DP' && oldRow?.name === oldNameEnc && !oldRow?.deleted_at && state.itemIds?.['v2-renamed'] === v2Id && !state.itemIds?.[V2_NAME]
  if (ok) pass('A6 update writes v2, keeps a blank TOTP, moves the name->id map, and does not touch the old row')
  else fail('A6', JSON.stringify({ updated, payload: row?.payload, itemIds: { new: state.itemIds?.['v2-renamed'], old: state.itemIds?.[V2_NAME] }, old: { same: oldRow?.name === oldNameEnc, deleted: oldRow?.deleted_at } }))
}

// A7: a delete is a v2 tombstone, and the old row is still not deleted.
{
  const deleted = await call('/api/items/delete', { method: 'POST', body: { name: 'v2-renamed' } })
  const plain = await call('/api/v2/items?plain=1')
  const row = (plain.body.items || []).find((item) => item.id === v2Id)
  const oldRow = await oldDb.prepare('SELECT deleted_at FROM ciphers WHERE id = ?').bind(OLD_ID).first()
  const ok = deleted.status === 200 && row?.deletedAt && !oldRow?.deleted_at
  if (ok) pass('A7 delete writes a v2 tombstone and leaves the old row alone')
  else fail('A7', JSON.stringify({ deleted, deletedAt: row?.deletedAt, oldDeleted: oldRow?.deleted_at }))
}

// A8: a create lands in v2 with its secret intact.
let createdId = ''
{
  const created = await call('/api/items/create', { method: 'POST', body: { name: 'v2-created', value: 'created-secret', username: 'creator', url: 'https://created.example' } })
  createdId = created.body.id || ''
  const plain = await call('/api/v2/items?plain=1')
  const row = (plain.body.items || []).find((item) => item.id === createdId)
  const duplicate = await call('/api/items/create', { method: 'POST', body: { name: 'v2-created', value: 'again' } })
  const state = await getState()
  const ok = created.status === 200 && row?.payload?.password === 'created-secret' && duplicate.status === 400 && state.itemIds?.['v2-created'] === createdId
  if (ok) pass('A8 create writes v2, records the id and refuses a duplicate')
  else fail('A8', JSON.stringify({ created, duplicate: duplicate.status, itemId: state.itemIds?.['v2-created'], row: row?.payload }).slice(0, 500))
}

// A9: locked v2 refuses writes instead of silently writing the stale table.
{
  await call('/api/v2/lock', { method: 'POST' })
  const update = await call('/api/items/update', { method: 'POST', body: { name: 'v2-web', value: 'must-not-write' } })
  const remove = await call('/api/items/delete', { method: 'POST', body: { name: 'v2-web' } })
  const create = await call('/api/items/create', { method: 'POST', body: { name: 'while-locked', value: 'x' } })
  const ok = update.status === 423 && remove.status === 423 && create.status === 423
  if (ok) pass('A9 a locked v2 refuses update, delete and create with 423')
  else fail('A9', JSON.stringify({ update: update.status, remove: remove.status, create: create.status }))
}

// A10: while locked the old table is still readable, so the console is not blank.
{
  const { status, body } = await call('/api/items')
  const ok = status === 200 && names(body).includes(OLD_NAME) && !body.items.some((item) => item.source === 'v2')
  if (ok) pass('A10 the old table remains the read-only fallback while v2 is locked')
  else fail('A10', JSON.stringify({ status, names: names(body), sources: body.items?.map((i) => i.source) }))
}

// A11: unlocking returns the item page to v2, with the web row still there.
{
  await call('/api/v2/unlock', { method: 'POST', body: { password: MASTER } })
  const { body } = await call('/api/items')
  const web = body.items?.find((item) => item.name === 'v2-web')
  const ok = names(body).includes('v2-web') && names(body).includes('v2-created') && !names(body).includes(OLD_NAME) && web?.type === 1 && web?.source === 'v2'
  if (ok) pass('A11 unlock restores the v2 list, including the web kind')
  else fail('A11', JSON.stringify(names(body)))
}

// A12: the id is the stable key even after a rename.
{
  const { body } = await call('/api/items')
  const created = body.items?.find((item) => item.name === 'v2-created')
  const ok = created?.id === createdId && body.items.every((item) => item.id !== OLD_ID)
  if (ok) pass('A12 v2 ids stay stable and old ids never leak into the list')
  else fail('A12', JSON.stringify({ created, old: body.items?.map((i) => i.id) }))
}

// A13: the old cross-broker import path cannot write the retired table after cutover.
{
  const stale = await call('/api/sync/apply', { method: 'POST', body: {} })
  if (stale.status === 410) pass('A13 the retired sync-apply path is refused once v2 is the store')
  else fail('A13', JSON.stringify(stale))
}

// A14: emptying v2 must not hand the console back to the old table.
{
  await call('/api/items/delete', { method: 'POST', body: { name: 'v2-web' } })
  await call('/api/items/delete', { method: 'POST', body: { name: 'v2-created' } })
  const empty = await call('/api/items')
  const created = await call('/api/items/create', { method: 'POST', body: { name: 'v2-after-empty', value: 'after-empty' } })
  const after = await call('/api/items')
  const plain = await call('/api/v2/items?plain=1')
  const row = (plain.body.items || []).find((item) => item.payload?.name === 'v2-after-empty')
  const ok = empty.status === 200 && names(empty.body).length === 0 && created.status === 200 && names(after.body).join(',') === 'v2-after-empty' && row?.payload?.password === 'after-empty'
  if (ok) pass('A14 an emptied v2 keeps the source, so the next create still lands there')
  else fail('A14', JSON.stringify({ empty: names(empty.body), created: created.status, after: names(after.body), row: row?.payload }).slice(0, 400))
}

// A15: an edit does not drop payload fields this console never knew about.
{
  await call('/api/v2/items', { method: 'POST', body: { kind: 'api', payload: { name: 'v2-extra', secret: 'extra-value', customKey: 'keep-me' } } })
  const updated = await call('/api/items/update', { method: 'POST', body: { name: 'v2-extra', value: 'extra-new' } })
  const plain = await call('/api/v2/items?plain=1')
  const row = (plain.body.items || []).find((item) => item.payload?.name === 'v2-extra')
  const ok = updated.status === 200 && row?.payload?.customKey === 'keep-me' && row?.payload?.password === 'extra-new' && row?.payload?.secret === undefined
  if (ok) pass('A15 update keeps unknown payload fields and replaces the old secret spelling')
  else fail('A15', JSON.stringify({ updated, payload: row?.payload }).slice(0, 400))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== v2 adapter ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
