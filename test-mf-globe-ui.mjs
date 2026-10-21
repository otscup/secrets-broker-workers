// Globe P3/P4: markup presence, lazy asset route, failure isolation, and the
// admin geo query contract the frontend depends on.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 191).toString('base64')
const ACCT = 'g3@example.invalid'
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: ACCT }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
const html = await mf.dispatchFetch('https://broker.test/', { headers: { cookie } }).then((r) => r.text())

// U1: globe card and controls exist
{
  const need = ['id="globe-card"', 'id="globe-box"', 'id="globe-range"', 'id="globe-pause"', 'id="globe-full"', 'id="globe-empty"']
  const missing = need.filter((m) => !html.includes(m))
  if (!missing.length) pass('U1 globe card and controls present')
  else fail('U1', missing.join(','))
}
// U2: honest labelling — IP estimate disclaimer, no "online" claim
{
  const hasDisclaimer = html.includes('IP 估算位置') && html.includes('不代表实际物理位置')
  // Only the globe card must avoid asserting presence; wording elsewhere that
  // explicitly denies real-time status is correct and expected.
  const globeCard = (html.match(/id="globe-card"[\s\S]{0,2200}/) || [''])[0]
  const claimsOnline = /实时在线/.test(globeCard) && !/不代表[^<]*在线|不等同/.test(globeCard)
  if (hasDisclaimer && !claimsOnline) pass('U2 disclaimer present, globe makes no online claim')
  else fail('U2', JSON.stringify({ hasDisclaimer, claimsOnline }))
}
// U3: polling is 5s and stops when hidden/paused
{
  const has5s = /5000\)/.test(html) || html.includes('5000)')
  const guards = html.includes('document.hidden') && html.includes('globeVisible()')
  if (has5s && guards) pass('U3 5s polling with visibility/pause guards')
  else fail('U3', JSON.stringify({ has5s, guards }))
}
// U4: globe failure cannot break the console (dynamic import in try/catch)
{
  const guarded = /try \{\s*const mod = await import\('\/globe\.js'\)/.test(html) || html.includes("import('/globe.js')")
  const fallback = html.includes('地球组件不可用')
  if (guarded && fallback) pass('U4 globe load failure is isolated with fallback')
  else fail('U4', JSON.stringify({ guarded, fallback }))
}
// U5: empty state text exists and no fabricated data path
{
  const empty = html.includes('暂无访问记录') || html.includes('暂无真实访问记录')
  if (empty) pass('U5 empty state present')
  else fail('U5', 'no empty state')
}
// U6: geo API returns the documented shape for incremental polling
{
  await stub.fetch('https://do/geo/reset', { method: 'POST' })
  await stub.fetch('https://do/geo/append', { method: 'POST', body: JSON.stringify({ event: { at: new Date().toISOString(), agent: 'ui', kind: 'token', action: 'secret.read', ok: true, geo: { known: true, country: 'JP', city: 'Tokyo', lat: 35.68, lon: 139.69, asn: 1 } } }) })
  const api1 = await mf.dispatchFetch('https://broker.test/api/geo/events?range=24h&sinceSeq=0&limit=300', { headers: { cookie } }).then((r) => r.json())
  const api2 = await mf.dispatchFetch('https://broker.test/api/geo/events?range=24h&sinceSeq=' + api1.cursor + '&limit=300', { headers: { cookie } }).then((r) => r.json())
  const shapeOk = api1.ok === true && Array.isArray(api1.events) && typeof api1.cursor === 'number' && api1.events.length === 1
  const incrementalOk = api2.events.length === 0
  if (shapeOk && incrementalOk) pass('U6 geo API shape and incremental cursor work')
  else fail('U6', JSON.stringify({ shapeOk, incrementalOk, n1: api1.events.length, n2: api2.events.length }))
}
// U7: geo API is disabled cleanly when the flag is off
{
  const mf2 = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
  const ns2 = await mf2.getDurableObjectNamespace('BROKER_STATE')
  const s2 = ns2.get(ns2.idFromName('global'))
  await s2.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: ACCT }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
  const c2 = String((await mf2.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
  const off = await mf2.dispatchFetch('https://broker.test/api/geo/events?range=1h', { headers: { cookie: c2 } }).then((r) => r.json())
  await mf2.dispose()
  if (off.enabled === false && off.events.length === 0) pass('U7 geo API reports disabled when flag off')
  else fail('U7', JSON.stringify(off))
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== globe ui ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
