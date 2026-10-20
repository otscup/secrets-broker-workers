// The whole-state writer must not lose concurrent updates. Before CAS, a login
// racing an audit write could have its session record overwritten, making
// validCookie reject a fresh cookie and bounce login <-> authorize forever.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 231).toString('base64')
const PASS = 'p'
const RED = 'https://agent.meta.ai/api/hatch/oauth/callback'

const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const seed = () => stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'p@example.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const getState = () => stub.fetch('https://do/state').then((x) => x.json()).then((p) => p.state)
const login = () => mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })
const sidOf = (r) => String(r.headers.get('set-cookie') || '').split(';')[0].split('.')[1]

// C1: login racing audit-producing traffic keeps every session
{
  await seed()
  const logins = Array.from({ length: 6 }, () => login())
  const noise = Array.from({ length: 12 }, () => mf.dispatchFetch('https://broker.test/api/status'))
  const out = await Promise.all([...logins, ...noise])
  const sids = out.slice(0, 6).map(sidOf).filter(Boolean)
  const st = await getState()
  const missing = sids.filter((sid) => !(st.adminSessions && st.adminSessions[sid]))
  if (sids.length === 6 && missing.length === 0) pass('C1 login racing traffic keeps all sessions')
  else fail('C1', JSON.stringify({ created: sids.length, missing: missing.length }))
}
// C2: audit entries are not silently dropped either
{
  await seed()
  await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })
  const st1 = (await getState()).audit.length
  await Promise.all(Array.from({ length: 8 }, () => mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })))
  const st2 = (await getState()).audit.length
  if (st2 > st1) pass('C2 audit entries survive concurrent writes')
  else fail('C2', JSON.stringify({ before: st1, after: st2 }))
}
// C3: a session created during heavy write churn is still usable for authorize
{
  await seed()
  const cookie = String((await login()).headers.get('set-cookie') || '').split(';')[0]
  const reg = await mf.dispatchFetch('https://broker.test/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Muse', redirect_uris: [RED] }) })
  const id = (await reg.json()).client_id
  const q = '?response_type=code&client_id=' + id + '&redirect_uri=' + encodeURIComponent(RED) + '&scope=secrets.read&state=st&code_challenge_method=S256&code_challenge=F3siqvmfNJl2t82cMVUfoylc43Lw0Z5MLFbImNsqt38'
  await Promise.all(Array.from({ length: 10 }, () => mf.dispatchFetch('https://broker.test/api/status')))
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize' + q, { headers: { cookie }, redirect: 'manual' })
  const html = await r.text()
  if (r.status === 200 && html.includes('decision')) pass('C3 session usable for authorize after churn')
  else fail('C3', JSON.stringify({ status: r.status }))
}
// C4: cookie from the FIRST login still works after many later logins
{
  await seed()
  const first = String((await login()).headers.get('set-cookie') || '').split(';')[0]
  await Promise.all(Array.from({ length: 8 }, () => login()))
  const r = await mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie: first } })
  if (r.status === 200) pass('C4 earliest session survives later logins')
  else fail('C4', 'status=' + r.status)
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== state write safety ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
