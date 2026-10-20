// Does concurrent state churn drop a freshly registered OAuth client?
// Reproduces the lost-update window, then verifies the atomic register path.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 131).toString('base64')
const PASS = 'p'
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const raw = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const baseState = () => ({ agents: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'probe@example.invalid' }, itemGroups: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } })
const register = (name) => mf.dispatchFetch('https://broker.test/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: ['http://127.0.0.1:9999/cb'] }) }).then(async (r) => ({ s: r.status, b: await r.json().catch(() => null) }))

// C1: register alone persists
{
  await raw(baseState())
  const r = await register('solo')
  const st = await getState()
  if (r.s === 201 && st.oauthClients[r.b.client_id]) pass('C1 single registration persists')
  else fail('C1', JSON.stringify({ s: r.s, keys: Object.keys(st.oauthClients || {}) }))
}
// C2: 10 concurrent registrations must ALL persist (atomic path)
{
  await raw(baseState())
  const out = await Promise.all(Array.from({ length: 10 }, (_, i) => register('c' + i)))
  const ids = out.map((r) => r.b && r.b.client_id).filter(Boolean)
  const st = await getState()
  const stored = Object.keys(st.oauthClients || {})
  const missing = ids.filter((id) => !stored.includes(id))
  if (ids.length === 10 && missing.length === 0) pass('C2 10 concurrent registrations all persisted')
  else fail('C2', JSON.stringify({ created: ids.length, stored: stored.length, missing: missing.length }))
}
// C3: a newly registered client is recognised by /oauth/authorize. Without a
// session it must redirect to /login (not "unknown client"), which proves the
// registration persisted.
{
  await raw(baseState())
  const r = await register('flow')
  const id = r.b.client_id
  const u = '/oauth/authorize?client_id=' + id + '&redirect_uri=' + encodeURIComponent('http://127.0.0.1:9999/cb') + '&response_type=code&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256'
  const a = await mf.dispatchFetch('https://broker.test' + u, { redirect: 'manual' })
  const body = await a.text()
  const recognised = a.status === 302 && String(a.headers.get('location') || '').includes('/login')
  if (recognised) pass('C3 fresh client recognised by authorize (redirects to login, no unknown client)')
  else fail('C3', JSON.stringify({ status: a.status, body: body.slice(0, 60) }))
}
// C4: registration survives unrelated concurrent state churn
{
  await raw(baseState())
  const cookie = (await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })).headers.get('set-cookie').split(';')[0]
  const [reg] = await Promise.all([
    register('churn'),
    ...Array.from({ length: 8 }, () => mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie } })),
  ])
  const st = await getState()
  if (reg.s === 201 && st.oauthClients[reg.b.client_id]) pass('C4 registration survives concurrent state reads')
  else fail('C4', JSON.stringify({ s: reg.s }))
}
// C5: mutate endpoint rejects bad ops without writing
{
  await raw(baseState())
  const r = await stub.fetch('https://state/mutate', { method: 'POST', body: JSON.stringify({ ops: [{ op: 'bogus', path: ['x'], value: 1 }] }) }).then((x) => x.json())
  const st = await getState()
  if (!r.ok && !('x' in st)) pass('C5 mutate rejects unknown op, no write')
  else fail('C5', JSON.stringify({ r, hasX: 'x' in st }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== oauth client persistence ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
