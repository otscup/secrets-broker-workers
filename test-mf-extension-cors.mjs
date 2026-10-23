// The browser extension is an executor that runs in the operator's own browser,
// so it calls the executor endpoints cross-origin. Two things must hold:
//   E1 a preflight on an executor path is answered with the headers a browser
//      needs, and one on an admin path is not (an admin cookie never crosses).
//   E2 the real executor reply carries access-control-allow-origin too — the
//      preflight alone is not enough for fetch to hand the body to the script.
import { Miniflare } from 'miniflare'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 61).toString('base64')
const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({
  agents: {}, policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  settings: { notifications: {} }, capabilities: {}, actionGrants: {}, usePolicies: {},
  itemIds: {}, credentialKinds: {}, fillPolicies: {}, plaintextReadPolicies: {},
  fillExecutors: {}, deniedAttempts: {},
}) })

// E1: preflight on an executor path is answered; on an admin path it is not.
{
  const exec = await mf.dispatchFetch('https://broker.test/api/fill/tasks/claim', {
    method: 'OPTIONS',
    headers: { origin: 'chrome-extension://abc', 'access-control-request-method': 'POST' },
  })
  const allow = exec.headers.get('access-control-allow-origin')
  const methods = exec.headers.get('access-control-allow-methods') || ''
  const headers = exec.headers.get('access-control-allow-headers') || ''
  const execOk = exec.status === 204 && allow === '*' && methods.includes('POST')
    && headers.includes('x-fill-executor-id') && headers.includes('x-fill-executor-secret')
  const adminPreflight = await mf.dispatchFetch('https://broker.test/api/state', {
    method: 'OPTIONS', headers: { origin: 'chrome-extension://abc', 'access-control-request-method': 'GET' },
  })
  const adminNoCors = !adminPreflight.headers.get('access-control-allow-origin')
  if (execOk && adminNoCors) pass('E1 the executor paths answer a preflight, the admin paths do not')
  else fail('E1', JSON.stringify({ status: exec.status, allow, methods, headers, admin: adminPreflight.status }))
}

// E2: a real executor reply carries the header, so fetch can read the body.
{
  const res = await mf.dispatchFetch('https://broker.test/api/fill/tasks/claim', {
    method: 'POST',
    headers: { origin: 'chrome-extension://abc', 'content-type': 'application/json', 'x-fill-executor-id': 'nobody', 'x-fill-executor-secret': 'wrong' },
    body: '{}',
  })
  const allow = res.headers.get('access-control-allow-origin')
  if (res.status === 401 && allow === '*') pass('E2 an unauthorised executor reply still carries the CORS header')
  else fail('E2', JSON.stringify({ status: res.status, allow }))
}

// E3: the header does not leak onto a normal page response.
{
  const res = await mf.dispatchFetch('https://broker.test/health')
  const allow = res.headers.get('access-control-allow-origin')
  if (!allow) pass('E3 other responses carry no CORS header')
  else fail('E3', String(allow))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== extension cors ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
