// OAuth consent must not dead-end at 401: unauthenticated GET /oauth/authorize
// should bounce through /login with a next= return target, and /login must
// honour next when already signed in.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 121).toString('base64')
const PASS = 'p'
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const raw = (s) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(s) })
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)

const CLIENT = 'probe-client'
const REDIRECT = 'https://client.example/cb'
const AUTHZ = '/oauth/authorize?client_id=' + CLIENT + '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&response_type=code&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&state=xyz'

async function seed() {
  await raw({
    agents: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'probe@example.invalid' }, itemGroups: {},
    security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' },
    oauthClients: { [CLIENT]: { clientId: CLIENT, clientName: 'probe', redirectUris: [REDIRECT], createdAt: '2024-01-01' } },
    oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  })
}
async function loginCookie() {
  const r = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })
  if (r.status !== 200) throw new Error('login ' + r.status)
  return String(r.headers.get('set-cookie') || '').split(';')[0]
}
const follow = async (url, headers = {}) => {
  const r = await mf.dispatchFetch('https://broker.test' + url, { headers, redirect: 'manual' })
  return { status: r.status, location: r.headers.get('location') || '' }
}

// O1: unauthenticated GET authorize -> 302 to /login with next=
{
  await seed()
  const r = await follow(AUTHZ)
  const loc = r.location || ''
  const ok = r.status === 302 && loc.includes('/login') && loc.includes('next=')
  if (ok) pass('O1 unauthenticated authorize redirects to /login with next')
  else fail('O1', JSON.stringify(r))
}
// O2: the next target round-trips the original authorize URL
{
  await seed()
  const r = await follow(AUTHZ)
  const next = new URL(r.location, 'https://broker.test').searchParams.get('next') || ''
  const ok = next.includes('/oauth/authorize') && next.includes('client_id=' + CLIENT)
  if (ok) pass('O2 next carries the full authorize URL')
  else fail('O2', JSON.stringify({ next: next.slice(0, 80) }))
}
// O3: authenticated authorize renders the consent page (200, not 401)
{
  await seed()
  const cookie = await loginCookie()
  const r = await mf.dispatchFetch('https://broker.test' + AUTHZ, { headers: { cookie }, redirect: 'manual' })
  const body = await r.text()
  if (r.status === 200 && body.includes('allow') && body.includes('code_challenge')) pass('O3 authenticated authorize shows consent page')
  else fail('O3', JSON.stringify({ status: r.status, snippet: body.slice(0, 80) }))
}
// O4: /login with next and an existing cookie redirects straight to next
{
  await seed()
  const cookie = await loginCookie()
  const r = await follow('/login?next=' + encodeURIComponent(AUTHZ), { cookie })
  if (r.status === 302 && r.location.includes('/oauth/authorize')) pass('O4 /login honours next when already signed in')
  else fail('O4', JSON.stringify(r))
}
// O5: /login without cookie renders the login form carrying next
{
  await seed()
  const r = await mf.dispatchFetch('https://broker.test/login?next=' + encodeURIComponent(AUTHZ))
  const body = await r.text()
  const ok = r.status === 200 && body.includes('oauth/authorize')
  if (ok) pass('O5 login form embeds the next target')
  else fail('O5', JSON.stringify({ status: r.status }))
}
// O6: POST allow without cookie still refuses but explains (no silent 401 page)
{
  await seed()
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'client_id=' + CLIENT + '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&decision=allow',
  })
  const body = await r.text()
  if (r.status === 401 && body.includes('/login')) pass('O6 POST without cookie explains re-login')
  else fail('O6', JSON.stringify({ status: r.status }))
}
// O7: after login the approve POST succeeds and returns a code
{
  await seed()
  const cookie = await loginCookie()
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: 'client_id=' + CLIENT + '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&decision=allow&state=xyz',
  })
  const loc = r.headers.get('location') || ''
  const st = await getState()
  if (r.status === 302 && loc.includes('code=') && Object.keys(st.oauthCodes || {}).length === 1) pass('O7 approve issues a code')
  else fail('O7', JSON.stringify({ status: r.status, loc: loc.slice(0, 60) }))
}

// O8: a client nobody has seen before is called out on the consent page, with a
// checkbox that stops the question coming back.
{
  await seed()
  const cookie = await loginCookie()
  const r = await mf.dispatchFetch('https://broker.test' + AUTHZ, { headers: { cookie }, redirect: 'manual' })
  const body = await r.text()
  const noticed = body.includes('第一次请求访问') && body.includes('name="remember_app"')
  if (noticed) pass('O8 first-time client is flagged with a remember checkbox')
  else fail('O8', JSON.stringify({ status: r.status, snippet: body.slice(0, 120) }))
}
// O9: ticking 记住 marks the client, so the next consent page says it is known.
{
  await seed()
  const cookie = await loginCookie()
  await mf.dispatchFetch('https://broker.test/oauth/authorize', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: 'client_id=' + CLIENT + '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&decision=allow&grant_all=1&remember_app=1',
  })
  const st = await getState()
  const trusted = Boolean(st.oauthClients?.[CLIENT]?.trustedAt)
  const again = await (await mf.dispatchFetch('https://broker.test' + AUTHZ, { headers: { cookie }, redirect: 'manual' })).text()
  const quiet = again.includes('已经在本站确认过') && !again.includes('name="remember_app"')
  if (trusted && quiet) pass('O9 记住 marks the client and the next visit is quiet')
  else fail('O9', JSON.stringify({ trusted, quiet }))
}

await mf.dispose()

// O10: a deployment can close dynamic registration entirely.
{
  const closed = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS, OAUTH_ALLOW_REGISTER: '0' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS, OAUTH_ALLOW_REGISTER: '0' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
  const r = await closed.dispatchFetch('https://broker.test/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'x', redirect_uris: ['https://x.example/cb'] }) })
  const body = await r.text()
  if (r.status === 403 && body.includes('registration_disabled')) pass('O10 OAUTH_ALLOW_REGISTER=0 refuses registration')
  else fail('O10', JSON.stringify({ status: r.status, body: body.slice(0, 90) }))
  await closed.dispose()
}
const passed = results.filter((r) => r.ok).length
console.log('\n==== oauth consent login flow ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
