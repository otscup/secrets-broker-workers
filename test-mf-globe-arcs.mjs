// Globe arcs + operator location + detail modal.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const fs = await import('node:fs')

const KEK = Buffer.alloc(32, 187).toString('base64')
const ACCT = 'g4@example.invalid'
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: ACCT }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
const html = await mf.dispatchFetch('https://broker.test/', { headers: { cookie } }).then((r) => r.text())

// A1: operator location is recorded from an authenticated admin request
{
  const op = await stub.fetch('https://do/geo/operator').then((r) => r.json())
  const known = op.operator && op.operator.known === true && typeof op.operator.lat === 'number'
  if (known) pass('A1 operator location captured on admin auth')
  else fail('A1', JSON.stringify(op))
}
// A2: geo API returns operator alongside events
{
  await stub.fetch('https://do/geo/reset', { method: 'POST' })
  await stub.fetch('https://do/geo/append', { method: 'POST', body: JSON.stringify({ event: { at: new Date().toISOString(), agent: 'x', kind: 'token', action: 'secret.read', ok: true, geo: { known: true, country: 'JP', city: 'Tokyo', lat: 35.68, lon: 139.69, asn: 1 } } }) })
  const api = await mf.dispatchFetch('https://broker.test/api/geo/events?range=24h&sinceSeq=0', { headers: { cookie } }).then((r) => r.json())
  const ok = api.ok && api.operator && typeof api.operator.lat === 'number' && api.events.length === 1
  if (ok) pass('A2 geo API exposes operator for arc origin')
  else fail('A2', JSON.stringify({ op: api.operator, n: api.events.length }))
}
// A3: operator location is NOT part of the event log (kept separate)
{
  const raw = JSON.stringify(await stub.fetch('https://do/geo/query', { method: 'POST', body: JSON.stringify({ windowMs: 3600e3, limit: 10 }) }).then((r) => r.json()).then((p) => p.events))
  const leaky = /operator|"我"/.test(raw)
  if (!leaky) pass('A3 operator location excluded from the event log')
  else fail('A3', raw.slice(0, 120))
}
// A4: bundle contains arc routing incl. fixed China node and toggles
{
  const bundle = fs.readFileSync('public/globe.js', 'utf8')
  const ok = bundle.includes('showOperator') && bundle.includes('showArcs') && /31\.23|121\.47/.test(bundle)
  if (ok) pass('A4 globe bundle has arc routing and toggles')
  else fail('A4', JSON.stringify({ op: bundle.includes('showOperator'), arcs: bundle.includes('showArcs') }))
}
// A5: detail modal exists with both switches and honest wording
{
  const hasModal = html.includes('gl-arcs') && html.includes('gl-operator')
  const honest = html.includes('IP 估算')
  if (hasModal && honest) pass('A5 detail modal exposes both switches')
  else fail('A5', JSON.stringify({ hasModal, honest }))
}
// A6: no fabricated location when operator geo is unknown
{
  await stub.fetch('https://do/geo/operator', { method: 'POST', body: JSON.stringify({ geo: { known: false, country: '', city: '', lat: null, lon: null, asn: null } }) })
  const op = await stub.fetch('https://do/geo/operator').then((r) => r.json())
  const unknown = op.operator && op.operator.known === false && op.operator.lat === null
  if (unknown) pass('A6 unknown operator location stored without fake coords')
  else fail('A6', JSON.stringify(op))
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== globe arcs ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
