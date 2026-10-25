// Bulk grant actions and the MCP write path.
// The batch bar was missing, and 恢复 used to only re-enable the row while the
// capability stayed revoked. put_secret is new: approval must be a one-shot
// ticket, not a standing permission.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr, decryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 181).toString('base64')
const E = Buffer.alloc(32, 1)
const M = Buffer.alloc(32, 2)
const ACCT = 'batch@example.invalid'
const AGENT = 'write-agent'
const NARROW = 'narrow-agent'
const TOKEN = 'write-agent-token'
const NARROW_TOKEN = 'narrow-agent-token'
const I1 = 'item-one'
const I2 = 'item-two'
const SEP = String.fromCharCode(0)

const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'batch-write-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)',
  'CREATE TABLE ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)',
  'CREATE TABLE folders (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at TEXT)',
  `INSERT INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', '${ACCT}', 'k', 0, 600000, '2024-01-01')`,
]) await db.exec(sql)

const hashOf = async (token) => Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const stateNow = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const seed = async (extra = {}) => {
  
  const s = {
    agents: {
      [AGENT]: { hash: await hashOf(TOKEN), allow: [], groups: [], allowAll: true, write: true, legacy: false, account: ACCT, createdAt: '2024-01-01' },
      [NARROW]: { hash: await hashOf(NARROW_TOKEN), allow: [], groups: [], allowAll: true, write: false, tools: ['list_secrets'], legacy: false, account: ACCT, createdAt: '2024-01-01' },
    },
    grants: {}, pending: {}, audit: [], itemIds: {}, itemGroups: {}, policies: {}, capabilities: {},
    oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
    writeTickets: {},
    settings: { notifications: {}, vaultEmail: ACCT },
    security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' },
    ...extra,
  }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
}
const putSession = async () => {
  const plain = JSON.stringify({ email: ACCT, symEncKey: E.toString('base64'), symMacKey: M.toString('base64'), expiresAt: 0, issuedAt: Date.now() })
  const wrapped = await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64'))
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped, expiresAt: 0 }) })
}
const login = async () => {
  const res = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })
  return String(res.headers.get('set-cookie') || '').split(';')[0]
}
const post = (path, body, cookie) => mf.dispatchFetch('https://broker.test' + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
const call = (token, tool, args) => mf.dispatchFetch('https://broker.test/mcp', {
  method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
}).then(async (r) => { const b = await r.json(); return b?.result?.content?.[0]?.text ?? '' })
const callRaw = (token, body) => mf.dispatchFetch('https://broker.test/mcp', {
  method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then((r) => r.json())

await putSession()

const grant = (name, extra = {}) => ({ agent: AGENT, name, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT, ...extra })
const cap = (itemId, itemName, extra = {}) => ({
  [AGENT + SEP + itemId + SEP + 'secret.read']: { id: AGENT + SEP + itemId + SEP + 'secret.read', subjectId: AGENT, accountId: ACCT, itemId, itemName, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', expiresAt: 0, usedCount: 0, maxUses: null, revokedAt: null, revokedBy: null, ...extra },
})

// B1 - bulk delete removes every selected grant and audits one line.
{
  await seed({ grants: { [AGENT + SEP + I1]: grant(I1), [AGENT + SEP + I2]: grant(I2) } })
  const cookie = await login()
  const res = await post('/api/grants/batch', { action: 'delete', keys: [{ agent: AGENT, name: I1 }, { agent: AGENT, name: I2 }] }, cookie)
  const st = await stateNow()
  const left = Object.keys(st.grants || {}).length
  const audit = (st.audit || []).find((e) => e.event === 'grant.batch')
  res.status === 200 && res.body.changed === 2 && left === 0 && audit && audit.count === 2 && audit.action === 'delete'
    ? pass('B1 bulk delete removes all selected and audits the count') : fail('B1', JSON.stringify({ status: res.status, body: res.body, left, audit }))
}

// B2 - restore really restores: duration applied, reads reset, capability live again.
{
  const revokedAt = new Date(Date.now() - 8000e3).toISOString()
  await seed({
    grants: { [AGENT + SEP + I1]: grant(I1, { revokedAt, reads: 4, maxReads: 5 }) },
    capabilities: cap(I1, I1, { revokedAt, revokedBy: 'admin:grant-revoke', usedCount: 4 }),
  })
  const cookie = await login()
  const before = Date.now()
  const res = await post('/api/grants/batch', { action: 'restore', keys: [{ agent: AGENT, name: I1 }], seconds: 3600 }, cookie)
  const st = await stateNow()
  const g = st.grants[AGENT + SEP + I1]
  const c = st.capabilities[AGENT + SEP + I1 + SEP + 'secret.read']
  const inAnHour = Math.abs((g.expiresAt - before) - 3600e3) < 5000
  res.body.changed === 1 && g.revokedAt === null && g.reads === 0 && inAnHour && c && c.revokedAt === null && c.usedCount === 0 && Math.abs((c.expiresAt - before) - 3600e3) < 5000
    ? pass('B2 bulk restore re-enables the capability for the chosen duration') : fail('B2', JSON.stringify({ body: res.body, g, c }))
}

// B3 - zero seconds means permanent, and it is not silently rewritten to something else.
{
  await seed({ grants: { [AGENT + SEP + I1]: grant(I1, { revokedAt: '2024-01-01T00:00:00Z', reads: 2 }) } })
  const cookie = await login()
  const res = await post('/api/grants/batch', { action: 'restore', keys: [{ agent: AGENT, name: I1 }], seconds: 0 }, cookie)
  const st = await stateNow()
  res.body.changed === 1 && st.grants[AGENT + SEP + I1].expiresAt === 0
    ? pass('B3 restore with 0 seconds is permanent') : fail('B3', JSON.stringify({ body: res.body, g: st.grants[AGENT + SEP + I1] }))
}

// B4 - unknown keys are reported, not silently counted as restored.
{
  await seed({})
  const cookie = await login()
  const res = await post('/api/grants/batch', { action: 'restore', keys: [{ agent: 'ghost', name: 'nothing' }], seconds: 60 }, cookie)
  res.status === 200 && res.body.changed === 0 && (res.body.missing || []).length === 1
    ? pass('B4 a missing grant is reported as missing') : fail('B4', JSON.stringify(res.body))
}

// W1 - the first put_secret asks a human and writes nothing.
{
  await seed({})
  const raw = await call(TOKEN, 'put_secret', { name: 'agent-written', value: 'WRITE_ME_9f2a' })
  let out = {}; try { out = JSON.parse(raw) } catch {}
  const st = await stateNow()
  const pending = Object.values(st.pending || {})[0]
  out.status === 'pending-approval' && pending && pending.action === 'secret.write' && Object.keys(st.writeTickets || {}).length === 0
    ? pass('W1 put_secret returns pending and stores no ticket') : fail('W1', JSON.stringify({ raw: raw.slice(0, 200), pending }))
}

// W2 - approving mints a ten-minute one-shot ticket, not a grant or a capability.
{
  const st0 = await stateNow()
  const id = Object.keys(st0.pending || {})[0]
  const cookie = await login()
  const before = Date.now()
  const res = await post('/api/pending/decide', { id, decision: 'once' }, cookie)
  const st = await stateNow()
  const ticket = (st.writeTickets || {})[AGENT + SEP + 'agent-written']
  const tenMinutes = ticket && Math.abs((ticket.expiresAt - before) - 600e3) < 5000
  const noGrant = Object.keys(st.grants || {}).length === 0
  res.status === 200 && tenMinutes && noGrant
    ? pass('W2 approving a write mints a 10-minute ticket and no grant') : fail('W2', JSON.stringify({ status: res.status, ticket, noGrant }))
}

// W3 - the retry inside the window actually writes the cipher under the session key.
{
  const raw = await call(TOKEN, 'put_secret', { name: 'agent-written', value: 'WRITE_ME_9f2a' })
  let out = {}; try { out = JSON.parse(raw) } catch {}
  const row = await db.prepare('SELECT name, data FROM ciphers').first()
  const name = row ? await decryptStr(row.name, E, M) : ''
  const data = row ? JSON.parse(row.data) : {}
  const stored = data.login ? await decryptStr(data.login.password, E, M) : ''
  out.status === 'written' && name === 'agent-written' && stored === 'WRITE_ME_9f2a'
    ? pass('W3 the approved retry writes the encrypted credential') : fail('W3', JSON.stringify({ raw: raw.slice(0, 200), name, stored }))
}

// W4 - the ticket is spent: a second write needs a new approval.
{
  const raw = await call(TOKEN, 'put_secret', { name: 'agent-written', value: 'WRITE_ME_9f2a' })
  let out = {}; try { out = JSON.parse(raw) } catch {}
  const st = await stateNow()
  out.status === 'pending-approval' && Object.values(st.pending || {}).some((e) => e.action === 'secret.write')
    ? pass('W4 a spent ticket cannot be replayed') : fail('W4', raw.slice(0, 200))
}

// W5 - creating a new item with no value is refused instead of storing an empty entry.
{
  const cookie = await login()
  await call(TOKEN, 'put_secret', { name: 'meta-only', notes: 'no value here' })
  const st0 = await stateNow()
  const id = Object.values(st0.pending || {}).find((e) => e.name === 'meta-only').id
  await post('/api/pending/decide', { id, decision: 'once' }, cookie)
  const raw = await call(TOKEN, 'put_secret', { name: 'meta-only', notes: 'no value here' })
  const complained = String(raw).includes('value is required')
  complained ? pass('W5 a new item needs a value') : fail('W5', raw.slice(0, 160))
}

// T1 - a restricted agent is advertised only its tools and refused the rest.
{
  await seed({})
  const list = await callRaw(NARROW_TOKEN, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
  const names = (list?.result?.tools ?? []).map((t) => t.name)
  const refused = await call(NARROW_TOKEN, 'get_secret', { name: 'whatever' })
  names.length === 1 && names[0] === 'list_secrets' && /restricted to/.test(refused)
    ? pass('T1 a tool allowlist hides and refuses the other tools') : fail('T1', JSON.stringify({ names, refused: refused.slice(0, 120) }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log(String.fromCharCode(10) + '==== batch and write ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
