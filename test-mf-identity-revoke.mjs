// Migration identity binding + REAL revocation concurrency.
//
// Identity: the DO must only migrate a legacy grant when the grant's stable
// itemId (or a previously recorded immutable binding) matches. store.itemIds
// is a mutable cache and is treated as corroboration only.
//
// Revocation: all revokes go through the real HTTP API (admin session), never
// by rewriting whole state through the raw /state endpoint.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'idb-agent-token'
const KEK = Buffer.alloc(32, 61).toString('base64')
const SECRET = 'IDENTITY-BINDING-PLAINTEXT-q7'
const ITEM_ID = 'item-orig'
const ITEM = 'bound-item'
const OTHER_ID = 'item-other'
const AGENT = 'idb-agent'
const ACCT = 'vault@example.invalid'
const CK = AGENT + '\u0000' + ITEM_ID + '\u0000secret.read'
const GK = AGENT + '\u0000' + ITEM

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'idb-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const s of [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)",
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1','vault@example.invalid','k',0,600000,'2024-01-01')",
]) await db.exec(s)
const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
async function seedCipher(id, name, secret) {
  const data = { login: { username: '', password: await encryptStr(secret, E, M), totp: '', uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, 'u1', 1, null, await encryptStr(name, E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null, null).run()
}
await seedCipher(ITEM_ID, ITEM, SECRET)

const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const putState = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const ensure = (body) => stub.fetch('https://state/capability/ensure', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
async function putSession() {
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })
}
async function adminCookie() {
  const id = 'adm-' + Math.random().toString(36).slice(2)
  const expires = Date.now() + 7 * 86400 * 1000
  const payload = 'v2.' + id + '.' + expires
  const kb = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cookie:' + KEK))
  const key = await crypto.subtle.importKey('raw', kb, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).toString('base64')
  const st = await getState()
  st.adminSessions = st.adminSessions || {}
  st.adminSessions[id] = { id, ip: '', ua: '', createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), expiresAt: expires }
  await putState(st)
  return 'broker_admin=' + payload + '.' + sig
}
const post = (p, b, h = {}) => mf.dispatchFetch('https://broker.test' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
const mcp = (tool, args) => mf.dispatchFetch('https://broker.test/mcp', {
  method: 'POST', headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
}).then(async (r) => ({ status: r.status, body: await r.json() }))
const textOf = (r) => r.body?.result?.content?.[0]?.text ?? ''
function base(extra = {}) {
  return {
    agents: { [AGENT]: { hash, allow: [], groups: [], allowAll: false, write: false, legacy: true, account: ACCT } },
    policies: { [ITEM]: { noApproval: true } }, grants: {}, pending: {}, audit: [], settings: { notifications: {} },
    itemGroups: {}, actionGrants: {}, usePolicies: {}, capabilities: {}, itemIds: { [ITEM]: ITEM_ID }, ...extra,
  }
}
const grant = (extra = {}) => ({ agent: AGENT, name: ITEM, itemId: ITEM_ID, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: 5, revokedAt: null, account: ACCT, ...extra })

// ── Identity binding ─────────────────────────────────────────────────────
// I1: name + matching itemId migrates successfully
{
  await putState(base({ grants: { [GK]: grant() } }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (r.ok && st.capabilities[CK] && st.legacyItemBindings[AGENT + '\u0000' + ITEM]?.itemId === ITEM_ID) pass('I1 matching name+itemId migrates, binding recorded')
  else fail('I1', JSON.stringify({ r, caps: Object.keys(st.capabilities || {}) }))
}
// I2: name maps to a DIFFERENT itemId -> refused
{
  await putState(base({ grants: { [GK]: grant() } }))
  const r = await ensure({ subjectId: AGENT, itemId: OTHER_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (!r.ok && r.reason === 'grant-item-id-mismatch' && !st.capabilities[AGENT + '\u0000' + OTHER_ID + '\u0000secret.read']) pass('I2 same name, different itemId refused')
  else fail('I2', JSON.stringify(r))
}
// I3: after a rename the stale cache must not let the grant follow the name
{
  // Grant carries the ORIGINAL itemId; the cache now points the old name at a
  // recreated cipher. Migration must follow the grant's itemId, and any
  // request aimed at the other id must be refused.
  await putState(base({
    grants: { [GK]: grant({ itemId: ITEM_ID }) },
    itemIds: { [ITEM]: OTHER_ID },   // mutable cache re-pointed by recreate
  }))
  const r = await ensure({ subjectId: AGENT, itemId: OTHER_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (!r.ok && !st.capabilities[AGENT + '\u0000' + OTHER_ID + '\u0000secret.read']) pass('I3 re-pointed cache does not migrate the grant to the new cipher')
  else fail('I3', JSON.stringify({ r, caps: Object.keys(st.capabilities || {}) }))
}
// I4: delete + same-name recreate (new id) cannot inherit the old grant
{
  await putState(base({ grants: { [GK]: grant({ itemId: ITEM_ID }) }, itemIds: {} }))
  const r = await ensure({ subjectId: AGENT, itemId: OTHER_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (!r.ok && !st.capabilities[AGENT + '\u0000' + OTHER_ID + '\u0000secret.read']) pass('I4 same-name recreate does not inherit old grant')
  else fail('I4', JSON.stringify(r))
}
// I5: legacy grant with NO itemId is refused (cannot prove identity)
{
  const legacyNoId = grant(); delete legacyNoId.itemId
  await putState(base({ grants: { [GK]: legacyNoId } }))
  const r = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (!r.ok && r.reason === 'unbound-legacy-identity' && !st.capabilities[CK]) pass('I5 grant without itemId: safe reject, nothing minted')
  else fail('I5', JSON.stringify(r))
}
// I6: forged legacyName cannot reach another item
{
  await putState(base({
    grants: { [GK]: grant({ itemName: ITEM }) },
    itemIds: { [ITEM]: ITEM_ID, 'other-name': OTHER_ID },
  }))
  const r = await ensure({ subjectId: AGENT, itemId: OTHER_ID, action: 'secret.read', accountId: ACCT, legacyName: 'other-name' })
  const st = await getState()
  // No grant under 'other-name' and no binding -> refused
  if (!r.ok && !st.capabilities[AGENT + '\u0000' + OTHER_ID + '\u0000secret.read']) pass('I6 forged legacyName does not migrate')
  else fail('I6', JSON.stringify(r))
}

// ── REAL revocation concurrency ──────────────────────────────────────────
// Helper: migrate via ensure, then confirm the plaintext is readable.
async function readOnce() {
  const r = await mcp('get_secret', { name: ITEM })
  return textOf(r).includes(SECRET)
}
// R1: revoke BEFORE ensure -> ensure must not resurrect
{
  await putState(base({ grants: { [GK]: grant() } }))
  await putSession()
  const cookie = await adminCookie()
  const rev = await post('/api/grants/revoke', { agent: AGENT, name: ITEM }, { cookie })
  const e = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  if (rev.status === 200 && !e.ok && !st.capabilities[CK]) pass('R1 revoke before ensure: no capability created')
  else fail('R1', JSON.stringify({ rev: rev.status, e, caps: Object.keys(st.capabilities || {}) }))
}
// R2: ensure (migration) BEFORE revoke -> revoke must kill the new capability
{
  await putState(base({ grants: { [GK]: grant() } }))
  await putSession()
  const cookie = await adminCookie()
  const e = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const rev = await post('/api/grants/revoke', { agent: AGENT, name: ITEM }, { cookie })
  const st = await getState()
  const capRevoked = Boolean(st.capabilities[CK]?.revokedAt)
  const readable = await readOnce()
  if (e.ok && rev.status === 200 && capRevoked && !readable) pass('R2 revoke after migration revokes the capability; read denied')
  else fail('R2', JSON.stringify({ e, rev: rev.status, capRevoked, readable }))
}
// R3: 20-way ensure racing a real revoke -> never readable afterwards
{
  await putState(base({ grants: { [GK]: grant({ maxReads: null }) } }))
  await putSession()
  const cookie = await adminCookie()
  await Promise.all([
    ...Array.from({ length: 20 }, () => ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })),
    post('/api/grants/revoke', { agent: AGENT, name: ITEM }, { cookie }),
  ])
  // After the revoke has returned, no read may succeed.
  const st = await getState()
  const grantRevoked = Boolean(st.grants[GK]?.revokedAt)
  const cap = st.capabilities[CK]
  const readable = await readOnce()
  const consistent = !cap || Boolean(cap.revokedAt)
  if (grantRevoked && consistent && !readable) pass('R3 20-way ensure vs real revoke: grant revoked, no live capability, read denied')
  else fail('R3', JSON.stringify({ grantRevoked, capRevoked: cap && cap.revokedAt, readable }))
}
// R4: ensure again after revoke -> still refused
{
  // ensure is idempotent: an existing (even revoked) record is reported as
  // existed and is NEVER overwritten. What matters is that it stays revoked
  // and the plaintext remains unreadable.
  const e2 = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st = await getState()
  const readable = await readOnce()
  const capStillRevoked = Boolean(st.capabilities[CK]?.revokedAt)
  if (e2.existed === true && capStillRevoked && !readable) pass('R4 ensure after revoke: record untouched, still revoked, unreadable')
  else fail('R4', JSON.stringify({ e2, capStillRevoked, readable }))
}
// R5: revoke racing consume -> no read succeeds after revoke returns
{
  await putState(base({ grants: { [GK]: grant({ maxReads: null }) } }))
  await putSession()
  const cookie = await adminCookie()
  await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  await Promise.all([
    ...Array.from({ length: 10 }, () => mcp('get_secret', { name: ITEM })),
    post('/api/grants/revoke', { agent: AGENT, name: ITEM }, { cookie }),
  ])
  const readable = await readOnce()
  if (!readable) pass('R5 revoke racing consume: no further reads after revoke returns')
  else fail('R5', 'still readable')
}
// R6: migrated-then-revoked grant stays revoked across re-migration attempts
{
  const e3 = await ensure({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT, legacyName: ITEM })
  const st2 = await getState()
  const capRevoked = Boolean(st2.capabilities[CK]?.revokedAt)
  const readable = await readOnce()
  if (e3.existed === true && capRevoked && !readable) pass('R6 revoked capability not revived by re-migration')
  else fail('R6', JSON.stringify({ e3, capRevoked, readable }))
}
// R7: real action-grant revoke also blocks reads
{
  await putState(base({
    grants: {},
    actionGrants: { [AGENT + '\u0000' + ITEM_ID]: { id: 'g', subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.read'], legacy: false, createdAt: '2024-01-01' } },
    capabilities: { [CK]: { id: CK, subjectId: AGENT, accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 } },
  }))
  await putSession()
  const cookie = await adminCookie()
  const rev = await post('/api/action-grants/revoke', { agent: AGENT, itemId: ITEM_ID }, { cookie })
  const st = await getState()
  const readable = await readOnce()
  if (rev.status === 200 && st.capabilities[CK]?.revokedAt && !readable) pass('R7 real action-grant revoke blocks subsequent reads')
  else fail('R7', JSON.stringify({ rev: rev.status, capRevoked: st.capabilities[CK]?.revokedAt, readable }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== identity + revoke ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
