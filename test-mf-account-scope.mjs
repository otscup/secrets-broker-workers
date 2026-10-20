// Account scoping: capability issuance must never be account-agnostic, and
// revocation must never cross accounts for a same-named item.
import { Miniflare } from 'miniflare'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 71).toString('base64')
const AGENT = 'acct-agent'
const ITEM_ID = 'item-acct'
const ITEM = 'acct-item'
const ADMIN_PASS = 'synthetic-admin-pass'
const ACCT_A = 'owner-a@example.invalid'
const ACCT_B = 'owner-b@example.invalid'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN_PASS },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN_PASS },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'acct-scope-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)',
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1','owner-a@example.invalid','k',0,600000,'2024-01-01')",
]) await db.exec(sql)
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
// The Worker always addresses the DO as idFromName('global'); the test must
// use the same instance or it will read a different Durable Object.
const stub = ns.get(ns.idFromName('global'))
const putStateRaw = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
// Preserve admin sessions across test-state seeding (login registers one and a
// blind overwrite would log the caller out mid-test).
const putState = async (s) => {
  let sessions = {}
  try { const cur = await stub.fetch('https://state/state').then((r) => r.json()); sessions = (cur.state && cur.state.adminSessions) || {} } catch {}
  await putStateRaw({ ...s, adminSessions: sessions })
}
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const ensure = (b) => stub.fetch('https://state/capability/ensure', { method: 'POST', body: JSON.stringify(b) }).then((r) => r.json())
const consume = (key, accountId, action = 'secret.read') => stub.fetch('https://state/capability/consume', { method: 'POST', body: JSON.stringify({ key, accountId, action }) }).then((r) => r.json())
const keyFor = (itemId = ITEM_ID, action = 'secret.read') => AGENT + '\u0000' + itemId + '\u0000' + action

// Establish an admin session through the REAL routes:
//   /api/login  -> admin cookie + adminSessions record
//   /api/unlock -> vault session, encrypted by the Worker itself
// Using /api/unlock avoids writing a hand-rolled KEK-wrapped session from the
// Node side, which would depend on cross-runtime AES-GCM equivalence.
const UNLOCK_KEYS = { symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64') }
async function loginAdmin(email) {
  const st = await getState()
  st.security = { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' }
  // Pin the vault account so /api/unlock resolves the intended email.
  st.settings = { ...(st.settings || { notifications: {} }), vaultEmail: email }
  await putStateRaw(st)
  const r = await mf.dispatchFetch('https://broker.test/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASS }),
  })
  if (r.status !== 200) throw new Error('login failed: ' + r.status)
  const cookie = String(r.headers.get('set-cookie') || '').split(';')[0]
  const sessionId = cookie.split('.')[1]
  const u = await mf.dispatchFetch('https://broker.test/api/unlock', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ...UNLOCK_KEYS, ttl: 'permanent' }),
  })
  if (u.status !== 200) throw new Error('unlock failed: ' + u.status)
  return { cookie, sessionId }
}
// Seed test state while preserving the admin session record, then re-establish
// the vault session (the DO session key is separate, but unlocking again keeps
// the state and session in the exact order a real admin would produce).
async function seed(state, sessionId, cookie) {
  // ORDER MATTERS: unlock() runs updateState internally and would overwrite a
  // state written before it. Unlock first, then write the test state last.
  const u = await mf.dispatchFetch('https://broker.test/api/unlock', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ ...UNLOCK_KEYS, ttl: 'permanent' }),
  })
  if (u.status !== 200) throw new Error('re-unlock failed: ' + u.status)
  await putStateRaw({ ...state, adminSessions: { [sessionId]: { id: sessionId, ip: '', ua: '', createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), expiresAt: Date.now() + 3600000 } } })
}
const post = (p, b, h = {}) => mf.dispatchFetch('https://broker.test' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))

function base(extra = {}) {
  return {
    agents: { [AGENT]: { hash: '', allow: [], groups: [], allowAll: false, write: false, legacy: true, account: ACCT_A } },
    policies: { [ITEM]: { noApproval: true } }, grants: {}, pending: {}, audit: [],
    settings: { notifications: {} }, itemGroups: {}, actionGrants: {}, usePolicies: {},
    capabilities: {}, itemIds: { [ITEM]: ITEM_ID }, legacyItemBindings: {}, ...extra,
  }
}
const ag = (extra = {}) => ({ id: AGENT + '\u0000' + ITEM_ID, subjectId: AGENT, accountId: ACCT_A, itemId: ITEM_ID, itemName: ITEM, actions: ['secret.read'], legacy: false, createdAt: '2024-01-01', ...extra })
const body = (extra = {}) => ({ subjectId: AGENT, itemId: ITEM_ID, action: 'secret.read', accountId: ACCT_A, legacyName: ITEM, ...extra })

// ── 1. ensure account rules ─────────────────────────────────────────────
{
  const a = ag(); delete a.accountId
  await putState(base({ actionGrants: { [AGENT + '\u0000' + ITEM_ID]: a } }))
  const r = await ensure(body()); const st = await getState()
  if (!r.ok && r.reason === 'action-grant-account-missing' && !st.capabilities[keyFor()]) pass('A1 actionGrant without accountId refused')
  else fail('A1', JSON.stringify(r))
}
{
  await putState(base({ actionGrants: { [AGENT + '\u0000' + ITEM_ID]: ag({ accountId: '   ' }) } }))
  const r = await ensure(body()); const st = await getState()
  if (!r.ok && r.reason === 'action-grant-account-missing' && !st.capabilities[keyFor()]) pass('A2 blank accountId refused')
  else fail('A2', JSON.stringify(r))
}
{
  await putState(base({ actionGrants: { [AGENT + '\u0000' + ITEM_ID]: ag({ accountId: 'not-an-email' }) } }))
  const r = await ensure(body())
  if (!r.ok && r.reason === 'action-grant-account-missing') pass('A3 malformed accountId refused')
  else fail('A3', JSON.stringify(r))
}
{
  await putState(base({ actionGrants: { [AGENT + '\u0000' + ITEM_ID]: ag({ accountId: ACCT_B }) } }))
  const r = await ensure(body({ accountId: ACCT_A }))
  if (!r.ok && r.reason === 'action-grant-cross-account') pass('A4 cross-account refused')
  else fail('A4', JSON.stringify(r))
}
{
  await putState(base({ actionGrants: { [AGENT + '\u0000' + ITEM_ID]: ag() } }))
  const r = await ensure(body()); const cap = (await getState()).capabilities[keyFor()]
  if (r.ok && cap && cap.accountId === ACCT_A) pass('A5 matching account mints concrete accountId')
  else fail('A5', JSON.stringify({ r, cap }))
}
{
  await putState(base({ actionGrants: { [AGENT + '\u0000' + ITEM_ID]: ag() } }))
  const r = await ensure(body({ accountId: '' })); const st = await getState()
  if (!r.ok && r.reason === 'caller-account-missing' && !st.capabilities[keyFor()]) pass('A6 caller without accountId refused')
  else fail('A6', JSON.stringify(r))
}
{
  await putState(base({ actionGrants: { [AGENT + '\u0000' + ITEM_ID]: ag() } }))
  await ensure(body())
  const c = await consume(keyFor(), ACCT_B)
  if (!c.ok && c.reason === 'cross-account') pass('A7 minted capability is account-bound at consume')
  else fail('A7', JSON.stringify(c))
}

// ── 2. revoke isolation ─────────────────────────────────────────────────
{
  const cap = (acct) => ({ id: keyFor(), subjectId: AGENT, accountId: acct, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 })
  const KEY_A = keyFor()
  const KEY_B = AGENT + '\u0000' + ITEM_ID + '\u0000secret.read|b'
  const { cookie, sessionId } = await loginAdmin(ACCT_A)
  await seed(base({
    // A live grant for account A so revoke has a concrete target, plus two
    // same-named capabilities belonging to different accounts.
    grants: { [AGENT + '\u0000' + ITEM]: { agent: AGENT, name: ITEM, itemId: ITEM_ID, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT_A } },
    actionGrants: { [AGENT + '\u0000' + ITEM_ID]: ag({ accountId: ACCT_A }) },
    capabilities: { [KEY_A]: cap(ACCT_A), [KEY_B]: cap(ACCT_B) },
  }), sessionId, cookie)
  const preSess = await stub.fetch('https://state/session').then((x) => x.json())
  const preState = await getState()
  const rev = await post('/api/grants/revoke', { agent: AGENT, name: ITEM }, { cookie })
  const st = await getState()
  const aRevoked = Boolean(st.capabilities[KEY_A]?.revokedAt)
  const bIntact = !st.capabilities[KEY_B]?.revokedAt
  if (rev.status === 200 && aRevoked && bIntact) pass('R1 revoke account A leaves same-named account B capability intact')
  else fail('R1', JSON.stringify({ s: rev.status, body: rev.body, audit: (st.audit || []).slice(0, 3).map((e) => e.event + ':' + (e.error || e.account || '')), grantsKeys: Object.keys(preState.grants || {}) }))
}
{
  const grants = { [AGENT + '\u0000' + ITEM]: { agent: AGENT, name: ITEM, itemId: ITEM_ID, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT_B } }
  const { cookie, sessionId } = await loginAdmin(ACCT_A)
  await seed(base({ grants, capabilities: {} }), sessionId, cookie)
  const rev = await post('/api/grants/revoke', { agent: AGENT, name: ITEM }, { cookie })
  const st = await getState()
  const untouched = !st.grants[AGENT + '\u0000' + ITEM]?.revokedAt
  if (rev.status === 403 && untouched) pass('R2 cross-account grant revoke refused 403, untouched')
  else fail('R2', JSON.stringify({ s: rev.status, untouched }))
}
{
  const grants = { [AGENT + '\u0000' + ITEM]: { agent: AGENT, name: ITEM, itemId: ITEM_ID, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: null, revokedAt: null } }
  const { cookie, sessionId } = await loginAdmin(ACCT_A)
  await seed(base({ grants, capabilities: {} }), sessionId, cookie)
  const rev = await post('/api/grants/revoke', { agent: AGENT, name: ITEM }, { cookie })
  const st = await getState()
  const untouched = !st.grants[AGENT + '\u0000' + ITEM]?.revokedAt
  if (rev.status === 403 && untouched) pass('R3 account-less legacy grant refused (no guessing)')
  else fail('R3', JSON.stringify({ s: rev.status, untouched }))
}
{
  const KEY_A = keyFor()
  const capA = { id: KEY_A, subjectId: AGENT, accountId: ACCT_A, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: null, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 }
  const { cookie, sessionId } = await loginAdmin(ACCT_A)
  await seed(base({
    grants: { [AGENT + '\u0000' + ITEM]: { agent: AGENT, name: ITEM, itemId: ITEM_ID, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT_A } },
    capabilities: { [KEY_A]: capA },
  }), sessionId, cookie)
  const rev = await post('/api/grants/revoke', { agent: AGENT, name: ITEM }, { cookie })
  const st = await getState()
  const both = Boolean(st.grants[AGENT + '\u0000' + ITEM]?.revokedAt) && Boolean(st.capabilities[KEY_A]?.revokedAt)
  if (rev.status === 200 && both) pass('R4 same-account revoke revokes grant AND migrated capability')
  else fail('R4', JSON.stringify({ s: rev.status, both }))
}
{
  const { cookie, sessionId } = await loginAdmin(ACCT_A)
  await seed(base({}), sessionId, cookie)
  await stub.fetch('https://state/session', { method: 'DELETE' })
  const rev = await post('/api/grants/revoke', { agent: AGENT, name: ITEM }, { cookie })
  if (rev.status === 423) pass('R5 locked vault: revoke 423')
  else fail('R5', JSON.stringify({ s: rev.status }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== account scoping ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
