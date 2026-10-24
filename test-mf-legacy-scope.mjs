// Legacy-agent first-read behaviour: an old agent that has ONLY allow /
// allowAll / groups (no legacy grant, no actionGrant) — what actually happens?
//
// Drives the REAL Worker (/mcp get_secret) + DO + D1 under Miniflare with
// synthetic data, so the answer is empirical rather than inferred from source.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const AUTH = 'legacy-scope-token'
const KEK = Buffer.alloc(32, 51).toString('base64')
const SECRET = 'LEGACY-SCOPE-PLAINTEXT-v4'
const ITEM_ID = 'item-legacy'
const ITEM = 'legacy-item'
const ACCT = 'vault@example.invalid'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'legacy-scope-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const s of [
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)",
  "CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)",
  "INSERT OR REPLACE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1','vault@example.invalid','k',0,600000,'2024-01-01')",
]) await db.exec(s)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const data = { login: { username: '', password: await encryptStr(SECRET, E, M), totp: '', uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), await encryptStr('', E, M), JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null, null).run()
}
const hash = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(AUTH)))).toString('base64')
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const putState = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
async function putSession() {
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
  await stub.fetch('https://state/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })
}
const mcp = (tool, args) => mf.dispatchFetch('https://broker.test/mcp', {
  method: 'POST', headers: { authorization: 'Bearer ' + AUTH, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
}).then(async (r) => ({ status: r.status, body: await r.json() }))
const textOf = (r) => r.body?.result?.content?.[0]?.text ?? ''
const CK = 'legacy-agent\u0000' + ITEM_ID + '\u0000secret.read'
function state(agent, extra = {}) {
  return {
    agents: { 'legacy-agent': { hash, write: false, legacy: true, account: ACCT, ...agent } },
    policies: {}, grants: {}, pending: {}, audit: [], settings: { requireClassification: false, unclassifiedPlaintext: true, notifications: {} },
    itemGroups: {}, actionGrants: {}, usePolicies: {}, capabilities: {}, itemIds: { [ITEM]: ITEM_ID }, ...extra,
  }
}

// L1: legacy agent with explicit allow list, NO grant / NO actionGrant.
// Empirically: legacy scope only grants ELIGIBILITY; the approval gate still
// requires a grant or an approved capability. So the first read produces a
// pending approval — this is long-standing behaviour (present since bd531f4:
// `if (!policy?.noApproval && !grant)`), not a regression from this patch.
{
  await putState(state({ allow: [ITEM], groups: [], allowAll: false }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const st = await getState()
  const pending = /pending approval/i.test(textOf(r))
  const noPlaintext = !textOf(r).includes(SECRET)
  const noCaps = Object.keys(st.capabilities || {}).length === 0
  const hasPending = Object.keys(st.pending || {}).length === 1
  if (pending && noPlaintext && noCaps && hasPending) pass('L1 legacy allow-list, no grant: pending approval (eligibility only, no capability minted)')
  else fail('L1', JSON.stringify({ t: textOf(r).slice(0, 90), caps: st.capabilities, pending: Object.keys(st.pending || {}).length }))
}
// L2: same agent, allowAll=true -> identical semantics
{
  await putState(state({ allow: [], groups: [], allowAll: true }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const pending = /pending approval/i.test(textOf(r))
  const noPlaintext = !textOf(r).includes(SECRET)
  if (pending && noPlaintext) pass('L2 legacy allowAll, no grant: pending approval (same rule)')
  else fail('L2', JSON.stringify({ t: textOf(r).slice(0, 90) }))
}
// L2b: legacy scope + LIVE legacy grant -> reads without pending (compat path)
{
  await putState(state({ allow: [ITEM], groups: [], allowAll: false }, {
    grants: { ['legacy-agent\u0000' + ITEM]: { agent: 'legacy-agent', name: ITEM, itemId: ITEM_ID, mode: 'share', createdAt: '2024-01-01', expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT } },
  }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  if (textOf(r).includes(SECRET)) pass('L2b legacy scope + live grant: reads (compat path intact)')
  else fail('L2b', JSON.stringify({ t: textOf(r).slice(0, 90) }))
}
// L3: legacy agent whose scope does NOT cover the item -> denied
{
  await putState(state({ allow: ['other-item'], groups: [], allowAll: false }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const denied = !textOf(r).includes(SECRET)
  if (denied) pass('L3 legacy scope miss: denied')
  else fail('L3', textOf(r).slice(0, 90))
}
// L4: the legacy read leaves NO capability behind (no silent minting)
{
  await putState(state({ allow: [ITEM], groups: [], allowAll: false }))
  await putSession()
  await mcp('get_secret', { name: ITEM })
  const st = await getState()
  if (!st.capabilities[CK] && Object.keys(st.capabilities || {}).length === 0) pass('L4 legacy read mints no capability (no authority escalation)')
  else fail('L4', JSON.stringify(st.capabilities))
}
// L5: once an EXPIRED capability exists, the same legacy agent loses access
{
  await putState(state({ allow: [ITEM], groups: [], allowAll: false }, {
    capabilities: { [CK]: { id: CK, subjectId: 'legacy-agent', accountId: ACCT, itemId: ITEM_ID, itemName: ITEM, action: 'secret.read', mode: 'preapproved', createdAt: '2024-01-01', createdBy: 't', expiresAt: Date.now() - 1000, maxUses: null, usedCount: 0, revokedAt: null, revokedBy: null, approvalId: null, policyVersion: 1 } },
  }))
  await putSession()
  const r = await mcp('get_secret', { name: ITEM })
  const denied = !textOf(r).includes(SECRET)
  if (denied) pass('L5 legacy agent + expired capability: denied (capability supersedes scope)')
  else fail('L5', textOf(r).slice(0, 90))
}
// L6: secret.use is never available to a scope-only legacy agent
{
  await putState(state({ allow: [ITEM], groups: [], allowAll: true }))
  await putSession()
  const r = await mcp('http_request', { name: ITEM, url: 'https://api.example.invalid/', method: 'GET' })
  const st = await getState()
  const noUse = !Object.keys(st.capabilities || {}).some((k) => k.endsWith('secret.use'))
  if (!textOf(r).includes(SECRET) && noUse) pass('L6 legacy scope-only agent cannot use (no use capability)')
  else fail('L6', JSON.stringify({ t: textOf(r).slice(0, 60), caps: Object.keys(st.capabilities || {}) }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== legacy scope behaviour ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
