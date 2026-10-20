// Legacy / malformed session cookies must be cleared, otherwise they shadow a
// freshly issued cookie and the login <-> authorize bounce never terminates.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 241).toString('base64')
const PASS = 'p'
const RED = 'https://manus.im/api/webhook/mcp/callback'
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'p@example.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const reg = await mf.dispatchFetch('https://broker.test/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Manus', redirect_uris: [RED] }) })
const id = (await reg.json()).client_id
const q = '?response_type=code&client_id=' + id + '&redirect_uri=' + encodeURIComponent(RED) + '&scope=secrets.read&state=st&code_challenge_method=S256&code_challenge=F3siqvmfNJl2t82cMVUfoylc43Lw0Z5MLFbImNsqt38'

// L1: a v1 legacy cookie is rejected AND cleared
{
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize' + q, { headers: { cookie: 'broker_admin=v1.99999999999999.abc' }, redirect: 'manual' })
  const sc = r.headers.get('set-cookie') || ''
  if (r.status === 302 && sc.includes('broker_admin=') && sc.includes('Max-Age=0')) pass('L1 v1 cookie rejected and cleared')
  else fail('L1', JSON.stringify({ status: r.status, sc: sc.slice(0, 80) }))
}
// L2: a malformed v2 cookie is cleared too
{
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize' + q, { headers: { cookie: 'broker_admin=v2.garbage' }, redirect: 'manual' })
  const sc = r.headers.get('set-cookie') || ''
  if (r.status === 302 && sc.includes('Max-Age=0')) pass('L2 malformed v2 cookie cleared')
  else fail('L2', JSON.stringify({ status: r.status, sc: sc.slice(0, 80) }))
}
// L3: no cookie -> redirect to login (no clear header needed)
{
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize' + q, { redirect: 'manual' })
  if (r.status === 302 && String(r.headers.get('location') || '').includes('/login')) pass('L3 no cookie redirects to login')
  else fail('L3', 'status=' + r.status)
}
// L4: a real session cookie is accepted and renders consent
{
  const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })).headers.get('set-cookie') || '').split(';')[0]
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize' + q, { headers: { cookie }, redirect: 'manual' })
  const html = await r.text()
  if (r.status === 200 && html.includes('decision')) pass('L4 valid session renders consent')
  else fail('L4', JSON.stringify({ status: r.status }))
}
// L5: login issues a SameSite=None cookie
{
  const r = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })
  const sc = r.headers.get('set-cookie') || ''
  if (sc.includes('SameSite=None')) pass('L5 login cookie is SameSite=None')
  else fail('L5', sc.slice(0, 90))
}
// L6: after clearing, a fresh login works end to end (approve yields a code)
{
  const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })).headers.get('set-cookie') || '').split(';')[0]
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: q.slice(1) + '&decision=allow' })
  const loc = r.headers.get('location') || ''
  if (r.status === 302 && loc.startsWith(RED) && loc.includes('code=')) pass('L6 approve issues a code to the client callback')
  else fail('L6', JSON.stringify({ status: r.status, loc: loc.slice(0, 70) }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== stale cookie clearing ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
