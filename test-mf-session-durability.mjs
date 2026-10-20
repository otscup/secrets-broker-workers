// Login sessions must survive concurrent state churn. createAdminCookie and the
// lastSeen touch both used read-modify-write over the whole state, so a parallel
// request could overwrite a freshly created session record. validCookie then
// rejected a perfectly signed cookie and the user bounced login<->authorize.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 221).toString('base64')
const PASS = 'p'
const RED = 'https://agent.meta.ai/api/hatch/oauth/callback'

const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const seed = () => stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'p@example.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const getState = () => stub.fetch('https://do/state').then((x) => x.json()).then((p) => p.state)
const login = () => mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })

// S1: the session record exists right after login
{
  await seed()
  const r = await login()
  const cookie = String(r.headers.get('set-cookie') || '').split(';')[0]
  const sid = cookie.split('.')[1]
  const st = await getState()
  if (r.status === 200 && st.adminSessions && st.adminSessions[sid]) pass('S1 session persisted on login')
  else fail('S1', JSON.stringify({ status: r.status, has: Boolean(st.adminSessions && st.adminSessions[sid]) }))
}
// S2: 10 concurrent logins -> every session survives
{
  await seed()
  const out = await Promise.all(Array.from({ length: 10 }, () => login()))
  const sids = out.map((r) => String(r.headers.get('set-cookie') || '').split(';')[0].split('.')[1]).filter(Boolean)
  const st = await getState()
  const missing = sids.filter((sid) => !(st.adminSessions && st.adminSessions[sid]))
  if (sids.length === 10 && missing.length === 0) pass('S2 all 10 concurrent login sessions persisted')
  else fail('S2', JSON.stringify({ created: sids.length, missing: missing.length }))
}
// S3: a session survives concurrent unrelated traffic
{
  await seed()
  const cookie = String((await login()).headers.get('set-cookie') || '').split(';')[0]
  await Promise.all(Array.from({ length: 12 }, () => mf.dispatchFetch('https://broker.test/api/status')))
  const st = await getState()
  const sid = cookie.split('.')[1]
  if (st.adminSessions && st.adminSessions[sid]) pass('S3 session survives concurrent traffic')
  else fail('S3', 'session lost')
}
// S4: after login the authorize consent page renders (no bounce to login)
{
  await seed()
  const cookie = String((await login()).headers.get('set-cookie') || '').split(';')[0]
  const reg = await mf.dispatchFetch('https://broker.test/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Muse', redirect_uris: [RED] }) })
  const id = (await reg.json()).client_id
  const q = '?response_type=code&client_id=' + id + '&redirect_uri=' + encodeURIComponent(RED) + '&scope=secrets.read&state=st&code_challenge_method=S256&code_challenge=WrFNfSwjyG-cECycNL-TXPwnsOxTmev7_8dB3ERKpUk'
  await Promise.all(Array.from({ length: 10 }, () => mf.dispatchFetch('https://broker.test/api/status')))
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize' + q, { headers: { cookie }, redirect: 'manual' })
  const html = await r.text()
  if (r.status === 200 && html.includes('decision')) pass('S4 consent renders after login under churn (no loop)')
  else fail('S4', JSON.stringify({ status: r.status, snippet: html.slice(0, 60) }))
}
// S5: logout still removes only that session
{
  const cookie = String((await login()).headers.get('set-cookie') || '').split(';')[0]
  const sid = cookie.split('.')[1]
  await mf.dispatchFetch('https://broker.test/api/logout', { method: 'POST', headers: { cookie } })
  const st = await getState()
  if (!(st.adminSessions && st.adminSessions[sid])) pass('S5 logout removes the session')
  else fail('S5', 'session still present')
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== session durability ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
