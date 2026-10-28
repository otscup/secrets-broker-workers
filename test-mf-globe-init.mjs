// The globe must initialise even with zero events, and failures must be
// reported precisely instead of as a generic message.
import { Miniflare } from 'miniflare'
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 167).toString('base64')
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, assets: { directory: './public', binding: 'ASSETS' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'g7@e.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
const html = await mf.dispatchFetch('https://broker.test/', { headers: { cookie } }).then((r) => r.text())
const ui = fs.readFileSync('src/ui.js', 'utf8')

// G1: globe initialises even when there are no events
{
  const guarded = /const instance = await ensureGlobe\(\)\s*\n\s*if \(!instance\) return\s*\n\s*instance\.setPoints\(events/.test(ui)
  const noEarlyReturn = !/if \(!events\.length\) return\s*\n\s*const instance = await ensureGlobe/.test(ui)
  if (guarded && noEarlyReturn) pass('G1 globe mounts with zero events')
  else fail('G1', JSON.stringify({ guarded, noEarlyReturn }))
}
// G2: failures carry a specific reason
{
  const hasSize = ui.includes('globe container has no size')
  const hasWebgl = ui.includes('WebGL is unavailable')
  const hasExport = ui.includes('did not export mountGlobe')
  if (hasSize && hasWebgl && hasExport) pass('G2 failure reasons are specific')
  else fail('G2', JSON.stringify({ hasSize, hasWebgl, hasExport }))
}
// G3: the error text is rendered so it can be read without devtools
{
  const rendered = ui.includes('地球加载失败')
  if (rendered) pass('G3 failure reason surfaced in the UI')
  else fail('G3', 'reason not surfaced')
}
// G4: the served island parses as a module and exports mountGlobe
{
  const asset = await mf.dispatchFetch('https://broker.test/globe.js')
  const body = await asset.text()
  const exportsMount = /export\s*\{[^}]*as mountGlobe\}/.test(body)
  const ct = asset.headers.get('content-type') || ''
  if (asset.status === 200 && exportsMount && /javascript/.test(ct)) pass('G4 island serves as JS module with mountGlobe export')
  else fail('G4', JSON.stringify({ status: asset.status, exportsMount, ct }))
}
// G5: the map is opt-in, never started by loadState
{
  const optIn = ui.includes('id="globe-open"')
  const hiddenByDefault = /globeCard\.classList\.toggle\('hidden', !geoOn\)/.test(ui)
  const noAutoStart = !/if \(!globeBooted\) \{ globeBooted = true; try \{ initGlobe\(\) \}/.test(ui)
  if (optIn && hiddenByDefault && noAutoStart) pass('G5 globe is closed until the operator opens it')
  else fail('G5', JSON.stringify({ optIn, hiddenByDefault, noAutoStart }))
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== globe init ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
