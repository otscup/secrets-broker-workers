// Agent authorization extension: static agents and OAuth subjects.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 101).toString('base64')
const PASS = 'synthetic-admin-pass'
const ACCT = 'ext@example.invalid'
const AGENT_TOKEN = 'static-agent-token'
const OAUTH_TOKEN = 'oauth-agent-token'

const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01', scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const raw = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
// Seed while preserving the admin session created by /api/login.
const seedState = async (s) => {
  let sessions = {}
  try { const cur = await stub.fetch('https://state/state').then((r) => r.json()); sessions = (cur.state && cur.state.adminSessions) || {} } catch {}
  await raw({ ...s, adminSessions: sessions })
}
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const sha = async (t) => Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))).toString('base64')
const staticHash = await sha(AGENT_TOKEN)
const oauthHash = await sha(OAUTH_TOKEN)

async function loginCookie() {
  await raw({ agents: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: ACCT }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } })
  const r = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })
  if (r.status !== 200) throw new Error('login ' + r.status)
  const cookie = String(r.headers.get('set-cookie') || '').split(';')[0]
  const u = await mf.dispatchFetch('https://broker.test/api/unlock', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), ttl: 'permanent' }),
  })
  if (u.status !== 200) throw new Error('unlock ' + u.status)
  return cookie
}
const post = (p, b, h = {}) => mf.dispatchFetch('https://broker.test' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then(async (r) => ({ s: r.status, b: await r.json().catch(() => null) }))
const mcp = (token) => mf.dispatchFetch('https://broker.test/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then((r) => r.status)

function seed(extra = {}) {
  return {
    agents: { static1: { hash: staticHash, allow: [], groups: [], allowAll: true, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
    policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: ACCT },
    itemGroups: {}, actionGrants: {}, usePolicies: {}, capabilities: {}, itemIds: {},
    oauthTokens: { [oauthHash]: { hash: oauthHash, agent: 'oauth:client1', clientId: 'client1', account: ACCT, createdAt: '2024-01-01', expiresAt: Date.now() + 3600e3 } },
    oauthAgentProfiles: { 'oauth:client1': { alias: '', note: '', allow: [], groups: [], allowAll: true, write: false, legacy: false } },
    ...extra,
  }
}

// X1: extend a static agent to 30 days
{
  const cookie = await loginCookie()
  await seedState(seed())
  const before = Date.now()
  const r = await post('/api/agents/extend', { name: 'static1', days: 30 }, { cookie })
  const st = await getState()
  const exp = st.agents.static1.expiresAt
  const ok = r.s === 200 && typeof exp === 'number' && exp > before + 29 * 86400e3 && exp < before + 31 * 86400e3
  if (ok) pass('X1 static agent extended to ~30 days')
  else fail('X1', JSON.stringify({ s: r.s, exp, delta: exp && (exp - before) / 86400e3 }))
}
// X2: extend an OAuth subject -> token window updated
{
  const cookie = await loginCookie()
  await seedState(seed())
  const before = Date.now()
  const r = await post('/api/agents/extend', { name: 'oauth:client1', days: 7 }, { cookie })
  const st = await getState()
  const tok = Object.values(st.oauthTokens)[0]
  const ok = r.s === 200 && tok.expiresAt > before + 6 * 86400e3 && tok.expiresAt < before + 8 * 86400e3
  if (ok) pass('X2 OAuth subject extended to ~7 days')
  else fail('X2', JSON.stringify({ s: r.s, exp: tok.expiresAt, delta: (tok.expiresAt - before) / 86400e3 }))
}
// X3: permanent
{
  const cookie = await loginCookie()
  await seedState(seed())
  const r = await post('/api/agents/extend', { name: 'static1', days: 'permanent' }, { cookie })
  const st = await getState()
  if (r.s === 200 && st.agents.static1.expiresAt === null) pass('X3 permanent sets null')
  else fail('X3', JSON.stringify({ s: r.s, exp: st.agents.static1.expiresAt }))
}
// X4: invalid days rejected
{
  const cookie = await loginCookie()
  await seedState(seed())
  const bad = await Promise.all([0, -1, 99999, 'abc'].map((d) => post('/api/agents/extend', { name: 'static1', days: d }, { cookie })))
  if (bad.every((r) => r.s === 400)) pass('X4 invalid durations rejected')
  else fail('X4', JSON.stringify(bad.map((r) => r.s)))
}
// X5: unauthenticated rejected
{
  const r = await post('/api/agents/extend', { name: 'static1', days: 30 })
  if (r.s === 401) pass('X5 unauthenticated extend rejected')
  else fail('X5', JSON.stringify({ s: r.s }))
}
// X6: expired static agent can no longer authenticate
{
  await seedState(seed({ agents: { static1: { hash: staticHash, allow: [], groups: [], allowAll: true, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01', expiresAt: Date.now() - 1000 } } }))
  const s = await mcp(AGENT_TOKEN)
  if (s === 401) pass('X6 expired static agent rejected at /mcp')
  else fail('X6', 'status=' + s)
}
// X7: extending an expired agent restores access
{
  const cookie = await loginCookie()
  await seedState(seed({ agents: { static1: { hash: staticHash, allow: [], groups: [], allowAll: true, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01', expiresAt: Date.now() - 1000 } } }))
  await post('/api/agents/extend', { name: 'static1', days: 1 }, { cookie })
  const s = await mcp(AGENT_TOKEN)
  if (s === 200) pass('X7 after extension the agent authenticates again')
  else fail('X7', 'status=' + s)
}
// X8: unknown agent -> 404
{
  const cookie = await loginCookie()
  await seedState(seed())
  const r = await post('/api/agents/extend', { name: 'nope', days: 7 }, { cookie })
  if (r.s === 404) pass('X8 unknown agent 404')
  else fail('X8', JSON.stringify({ s: r.s }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== agent extend ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
