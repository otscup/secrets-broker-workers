// Re-login must not create an endless allow<->login ping-pong. Rebuilding the
// return target through URLSearchParams on a GET double-encodes every %XX
// (redirect_uri -> %253A), so each bounce mangles the URL further and the client
// never reaches the consent page. next must be byte-stable across bounces.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 201).toString('base64')
const PASS = 'p'
const RED = 'https://agent.meta.ai/api/hatch/oauth/callback'
const CH = 'WrFNfSwjyG-cECycNL-TXPwnsOxTmev7_8dB3ERKpUk'

const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'p@example.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const reg = await mf.dispatchFetch('https://broker.test/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Muse', redirect_uris: [RED] }) })
const id = (await reg.json()).client_id
const q = '?response_type=code&client_id=' + id + '&redirect_uri=' + encodeURIComponent(RED) + '&scope=secrets.read&state=st&code_challenge_method=S256&code_challenge=' + CH
const login = async () => (await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })).headers.get('set-cookie').split(';')[0]
const nextOf = (res) => { const l = res.headers.get('location') || ''; return l ? (new URL(l).searchParams.get('next') || '') : '' }

// R1: GET bounce keeps redirect_uri single-encoded
{
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize' + q, { redirect: 'manual' })
  const next = nextOf(r)
  if (r.status === 302 && !next.includes('%253A') && next.includes('redirect_uri=https%3A%2F%2F')) pass('R1 GET bounce keeps single encoding')
  else fail('R1', JSON.stringify({ status: r.status, next: next.slice(0, 90) }))
}
// R2: next is byte-identical on the second bounce (no cumulative encoding)
{
  const r1 = await mf.dispatchFetch('https://broker.test/oauth/authorize' + q, { redirect: 'manual' })
  const n1 = nextOf(r1)
  const r2 = await mf.dispatchFetch('https://broker.test' + n1, { redirect: 'manual' })
  const n2 = nextOf(r2)
  if (n1 === n2) pass('R2 next stable across bounces')
  else fail('R2', JSON.stringify({ n1: n1.slice(0, 80), n2: n2.slice(0, 80) }))
}
// R3: after login the preserve target renders consent (loop terminates)
{
  const cookie = await login()
  const r1 = await mf.dispatchFetch('https://broker.test/oauth/authorize' + q, { redirect: 'manual' })
  const n1 = nextOf(r1)
  const r2 = await mf.dispatchFetch('https://broker.test' + n1, { headers: { cookie }, redirect: 'manual' })
  const html = await r2.text()
  if (r2.status === 200 && html.includes('decision')) pass('R3 GET after login reaches consent')
  else fail('R3', JSON.stringify({ status: r2.status, snippet: html.slice(0, 70) }))
}
// R4: POST approve while logged out yields a resumable next
{
  const r = await mf.dispatchFetch('https://broker.test/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: q.slice(1) + '&decision=allow' })
  const html = await r.text()
  const href = /href="([^"]*\/login[^"]*)"/.exec(html)?.[1]?.replace(/&amp;/g, '&') || ''
  const next = href ? (new URL('https://broker.test' + href).searchParams.get('next') || '') : ''
  if (r.status === 401 && next.includes(id) && !next.includes('%253A')) pass('R4 POST bounce keeps client_id, single encoding')
  else fail('R4', JSON.stringify({ status: r.status, hasId: next.includes(id), bad: next.includes('%253A') }))
}
// R5: full POST -> login -> consent terminates
{
  const cookie = await login()
  const r1 = await mf.dispatchFetch('https://broker.test/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: q.slice(1) + '&decision=allow' })
  const html1 = await r1.text()
  const href = /href="([^"]*\/login[^"]*)"/.exec(html1)?.[1]?.replace(/&amp;/g, '&') || ''
  const next = new URL('https://broker.test' + href).searchParams.get('next') || ''
  const r2 = await mf.dispatchFetch('https://broker.test' + next, { headers: { cookie }, redirect: 'manual' })
  const html2 = await r2.text()
  if (r2.status === 200 && html2.includes('decision')) pass('R5 full POST->login->consent terminates')
  else fail('R5', JSON.stringify({ status: r2.status, snippet: html2.slice(0, 70) }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== oauth relogin no-loop ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
