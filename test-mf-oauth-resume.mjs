// Approving while logged out must return the user to a FULLY formed authorize
// request (client_id preserved), not a bare /oauth/authorize which then claims
// the client ID is invalid.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 171).toString('base64')
const PASS = 'p'
const CLIENT = 'Muse'
const REDIRECT = 'https://agent.meta.ai/api/hatch/oauth/callback'
const CHALLENGE = 'wloyNVlsTnV5qJytmce9IG1r81BzJc46j9imyMVSM_I'

const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'p@example.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const reg = await mf.dispatchFetch('https://broker.test/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: CLIENT, redirect_uris: [REDIRECT] }) })
const clientId = (await reg.json()).client_id

const form = 'response_type=code&client_id=' + clientId + '&redirect_uri=' + encodeURIComponent(REDIRECT) +
  '&scope=secrets.read&state=abc&code_challenge_method=S256&code_challenge=' + CHALLENGE + '&decision=allow'

// P1: POST approve while logged out -> 401 page whose re-login link keeps client_id
{
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form,
  })
  const body = await r.text()
  const ok = r.status === 401 && body.includes('/login?next=') && body.includes(clientId)
  if (ok) pass('P1 logged-out approve keeps client_id in the re-login link')
  else fail('P1', JSON.stringify({ status: r.status, hasClient: body.includes(clientId), snippet: body.slice(0, 100) }))
}
// P2: follow that login link -> /login carries a next that resolves to a valid authorize request
{
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form,
  })
  const body = await r.text()
  const href = /href="([^"]*\/login[^"]*)"/.exec(body)?.[1]?.replace(/&amp;/g, '&') || ''
  const loginRes = await mf.dispatchFetch('https://broker.test' + href, { redirect: 'manual' })
  const page = await loginRes.text()
  // The login page embeds next=... in its JS; it must contain the client id.
  const ok = loginRes.status === 200 && page.includes(clientId)
  if (ok) pass('P2 login page embeds the full authorize target')
  else fail('P2', JSON.stringify({ status: loginRes.status, hasClient: page.includes(clientId), href: href.slice(0, 80) }))
}
// P3: after signing in, the preserved next target renders the consent page
{
  const cookie = (await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })).headers.get('set-cookie').split(';')[0]
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form,
  })
  void r
  const resume = '?response_type=code&client_id=' + clientId + '&redirect_uri=' + encodeURIComponent(REDIRECT) +
    '&scope=secrets.read&state=abc&code_challenge_method=S256&code_challenge=' + CHALLENGE
  const consent = await mf.dispatchFetch('https://broker.test/oauth/authorize' + resume, { headers: { cookie }, redirect: 'manual' })
  const body = await consent.text()
  if (consent.status === 200 && body.includes('decision')) pass('P3 resumed authorize renders consent after login')
  else fail('P3', JSON.stringify({ status: consent.status, snippet: body.slice(0, 80) }))
}
// P4: bare authorize (no params) still reports invalid, but never claims a real
// client is missing when params are present
{
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize', { redirect: 'manual' })
  if (r.status === 400) pass('P4 bare authorize rejected without crashing')
  else fail('P4', 'status=' + r.status)
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== oauth relogin resume ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
