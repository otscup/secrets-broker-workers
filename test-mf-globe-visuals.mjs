// Globe rendering features: theme-aware palette, land/borders, drag rotation,
// zoom, and fullscreen expansion.
import { Miniflare } from 'miniflare'
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 181).toString('base64')
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'g5@e.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
const html = await mf.dispatchFetch('https://broker.test/', { headers: { cookie } }).then((r) => r.text())
const bundle = fs.readFileSync('public/globe.js', 'utf8')
const src = fs.readFileSync('src/globe/index.js', 'utf8')

// T1: earth surface comes from the bundled photographic texture and is tinted
// through three-globe's own material (a single sphere, so no z-fighting).
{
  const textured = src.includes("globeImageUrl('/earth.jpg')")
  const paints = src.includes('globeMaterial')
  if (textured && paints) pass('T1 photographic earth with material tint')
  else fail('T1', JSON.stringify({ textured, paints }))
}
// T1b: no second sphere — coincident spheres cause the z-fighting flicker
{
  const own = /new THREE\.SphereGeometry/.test(src)
  const loops = (src.match(/requestAnimationFrame\(tick\)/g) || []).length
  if (!own && loops === 1) pass('T1b single sphere and single render loop (no flicker)')
  else fail('T1b', JSON.stringify({ own, loops }))
}
// T1c: with a photographed earth, polygons draw borders only so the imagery
// stays visible instead of being covered by flat fills.
{
  const bordersOnly = src.includes("polygonCapColor(() => 'rgba(0,0,0,0)')") && src.includes('polygonStrokeColor')
  if (bordersOnly) pass('T1c borders only, texture stays visible')
  else fail('T1c', 'polygon styling wrong')
}
// T2: country polygons and border strokes are applied
{
  const ok = src.includes('polygonsData') && src.includes('polygonStrokeColor') && src.includes('countries.features')
  if (ok) pass('T2 country polygons with borders applied')
  else fail('T2', 'missing polygon wiring')
}
// T3: bundled GeoJSON actually contains features
{
  const geo = JSON.parse(fs.readFileSync('src/globe/countries.json', 'utf8'))
  const n = geo.features ? geo.features.length : 0
  if (n > 100) pass('T3 bundled country GeoJSON has ' + n + ' features')
  else fail('T3', 'features=' + n)
}
// T4: drag to rotate and wheel zoom via OrbitControls
{
  const ok = /OrbitControls/.test(src) && src.includes('controls.update()') && src.includes('minDistance') && src.includes('maxDistance')
  if (ok) pass('T4 drag-rotate and zoom implemented')
  else fail('T4', 'orbit wiring missing')
}
// T5: manual interaction stops the idle auto-rotation
{
  const ok = src.includes("controls.addEventListener('start'") && src.includes('autoRotate = false')
  if (ok) pass('T5 interaction stops auto-rotation')
  else fail('T5', 'no interaction handling')
}
// T6: theme switchable at runtime
{
  const ok = src.includes('setTheme') && html.includes("attributeFilter: ['data-theme']")
  if (ok) pass('T6 theme changes propagate to the globe')
  else fail('T6', 'no theme observer')
}
// T7: container background follows the theme
{
  const ok = html.includes('html[data-theme="dark"] .globe-box') && html.includes('.globe-box{position:relative')
  if (ok) pass('T7 globe container background follows theme')
  else fail('T7', 'background not themed')
}
// T8: click-to-enlarge toggles a fullscreen overlay and relabels the button
{
  const hasBtn = html.includes('id="globe-full"')
  const hasToggle = html.includes('function toggleGlobeFullscreen') && html.includes("classList.toggle('globe-full'")
  const hasCss = html.includes('.globe-box.globe-full')
  if (hasBtn && hasToggle && hasCss) pass('T8 click-to-enlarge implemented')
  else fail('T8', JSON.stringify({ hasBtn, hasToggle, hasCss }))
}
// T9: bundle keeps drag usable on touch (touch-action none)
{
  const ok = html.includes('touch-action:none')
  if (ok) pass('T8 touch dragging enabled')
  else fail('T8', 'touch-action missing')
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== globe visuals ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
