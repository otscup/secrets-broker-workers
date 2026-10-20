// OAuth client management: /api/state exposes registrations, revoke prunes one.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 151).toString('base64')
const PASS = 'p'
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const H = 'https://do'
const put = (s) => stub.fetch(H + '/state', { method: 'PUT', body: JSON.stringify(s) })
const get = () => stub.fetch(H + '/state').then((x) => x.json()).then((p) => p.state)
const register = (name) => mf.dispatchFetch('https://broker.test/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: ['http://127.0.0.1:9999/cb'] }) }).then(async (r) => (await r.json()).client_id)
async function login() {
  const r = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })
  return String(r.headers.get('set-cookie') || '').split(';')[0]
}
const base = () => ({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'p@example.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } })

// M1: /api/state lists registrations with names and token counts
{
  await put(base())
  const cookie = await login()
  const idA = await register('Muse')
  const idB = await register('Codex')
  const st = await mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie } }).then((r) => r.json())
  const names = (st.oauthClients || []).map((c) => c.clientName).sort()
  const hasBoth = names.includes('Muse') && names.includes('Codex')
  const shape = (st.oauthClients || []).every((c) => 'clientId' in c && 'tokens' in c && 'liveTokens' in c)
  if (hasBoth && shape && st.oauthClients.length === 2) pass('M1 /api/state lists clients with token counts')
  else fail('M1', JSON.stringify({ n: (st.oauthClients || []).length, names }))
}
// M2: revoking one client removes only that one
{
  const cookie = await login()
  const ids = (await get()).oauthClients
  const target = Object.values(ids).find((c) => c.clientName === 'Muse')
  const r = await mf.dispatchFetch('https://broker.test/api/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ clientId: target.clientId }) })
  const after = Object.keys((await get()).oauthClients || {})
  if (r.status === 200 && !after.includes(target.clientId) && after.length === 1) pass('M2 revoke removes exactly one client')
  else fail('M2', JSON.stringify({ s: r.status, left: after.length }))
}
// M3: revoke also drops that client's tokens
{
  await put(base())
  const cookie = await login()
  const id = await register('TokenTest')
  await stub.fetch(H + '/state/mutate', { method: 'POST', body: JSON.stringify({ ops: [{ op: 'set', path: ['oauthTokens', 'h1'], value: { hash: 'h1', agent: 'oauth:' + id, clientId: id, account: 'p@example.invalid', expiresAt: Date.now() + 3600e3 } }] }) })
  const before = (await get()).oauthTokens
  await mf.dispatchFetch('https://broker.test/api/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ clientId: id }) })
  const after = (await get()).oauthTokens
  if (Object.keys(before).length === 1 && Object.keys(after).length === 0) pass('M3 revoke drops the client tokens')
  else fail('M3', JSON.stringify({ before: Object.keys(before).length, after: Object.keys(after).length }))
}
// M4: /api/state requires admin auth
{
  await put(base())
  const r = await mf.dispatchFetch('https://broker.test/api/state')
  if (r.status === 401) pass('M4 /api/state requires admin')
  else fail('M4', 'status=' + r.status)
}
// M5: liveTokens reflects expiry
{
  await put(base())
  const cookie = await login()
  const id = await register('Expiry')
  await stub.fetch(H + '/state/mutate', { method: 'POST', body: JSON.stringify({ ops: [
    { op: 'set', path: ['oauthTokens', 'live'], value: { hash: 'live', agent: 'oauth:' + id, clientId: id, account: 'p@example.invalid', expiresAt: Date.now() + 3600e3 } },
    { op: 'set', path: ['oauthTokens', 'dead'], value: { hash: 'dead', agent: 'oauth:' + id, clientId: id, account: 'p@example.invalid', expiresAt: Date.now() - 1000 } },
  ] }) })
  const st = await mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie } }).then((r) => r.json())
  const c = (st.oauthClients || []).find((x) => x.clientId === id)
  if (c && c.tokens === 2 && c.liveTokens === 1) pass('M5 liveTokens counts only unexpired')
  else fail('M5', JSON.stringify(c))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== oauth client management ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
