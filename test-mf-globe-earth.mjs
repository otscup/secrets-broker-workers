// Globe: photographic earth, arc country labels, live danmaku feed.
import { Miniflare } from 'miniflare'
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 179).toString('base64')
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, assets: { directory: './public', binding: 'ASSETS' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'g6@e.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
const html = await mf.dispatchFetch('https://broker.test/', { headers: { cookie } }).then((r) => r.text())
const src = fs.readFileSync('src/globe/index.js', 'utf8')
const uiSrc = fs.readFileSync('src/ui.js', 'utf8')

// E1: photographic earth texture wired and served
{
  const wired = src.includes("globeImageUrl('/earth.jpg')")
  const exists = fs.existsSync('public/earth.jpg')
  const served = (await mf.dispatchFetch('https://broker.test/earth.jpg')).status
  if (wired && exists && served === 200) pass('E1 earth texture wired and served')
  else fail('E1', JSON.stringify({ wired, exists, served }))
}
// E2: arc labels carry country code
{
  const ok = src.includes('arcLabel') && src.includes('label(g.country, g.city)')
  if (ok) pass('E2 arcs carry country-code labels')
  else fail('E2', 'no arc labels')
}
// E3: label format includes the 2-letter code
{
  const fn = /const label = \(code, city\) => \{([\s\S]{0,320}?)\}/.exec(src)
  const body = fn ? fn[1] : ''
  const ok = body.includes('toUpperCase()') && body.includes("' · '")
  if (ok) pass('E3 label renders city · CC')
  else fail('E3', body.slice(0, 120))
}
// E4: danmaku panel is created when the modal opens, and shows an empty state
{
  const hasFeed = uiSrc.includes('id="globe-danmu"') && uiSrc.includes('danmu-feed')
  const emptyState = uiSrc.includes('暂无连接')
  // Must not render rows when there is nothing to show.
  const guarded = uiSrc.includes('if (!events.length)') && uiSrc.includes('stopDanmu()')
  if (hasFeed && emptyState && guarded) pass('E4 danmaku feed with empty state')
  else fail('E4', JSON.stringify({ hasFeed, emptyState, guarded }))
}
// E5: danmaku styles + reduced-motion respected
{
  const ok = uiSrc.includes('.danmu-row') && uiSrc.includes('prefers-reduced-motion')
  if (ok) pass('E5 danmaku styles with reduced-motion support')
  else fail('E5', 'danmaku styles missing')
}
// E6: still a single sphere and single RAF loop (no flicker regression)
{
  const own = /new THREE\.SphereGeometry/.test(src)
  const loops = (src.match(/requestAnimationFrame\(tick\)/g) || []).length
  if (!own && loops === 1) pass('E6 no z-fighting regression')
  else fail('E6', JSON.stringify({ own, loops }))
}
// E7: borders drawn without hiding the photographic land
{
  const ok = src.includes("polygonCapColor(() => 'rgba(0,0,0,0)')") && src.includes('polygonStrokeColor')
  if (ok) pass('E7 borders only, texture shows through')
  else fail('E7', 'polygon styling wrong')
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== globe earth ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
