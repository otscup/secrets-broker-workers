// Regression guards for the round of UX corrections.
import { Miniflare } from 'miniflare'
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 151).toString('base64')
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'u@e.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
const html = await mf.dispatchFetch('https://broker.test/', { headers: { cookie } }).then((r) => r.text())
const ui = fs.readFileSync('src/ui.js', 'utf8')

// X1: dragging the globe must not open the detail view
{
  const guarded = ui.includes("addEventListener('pointerdown'") && ui.includes('Math.abs(e.clientX - downX) > 4')
  const noRawClick = !/boxEl\.onclick =/.test(ui)
  if (guarded && noRawClick) pass('X1 drag does not open the dialog')
  else fail('X1', JSON.stringify({ guarded, noRawClick }))
}
// X2: enlarge shows a bigger globe, feed sits beside it
{
  const big = ui.includes('globe-big-box') && ui.includes('mountBigGlobe')
  const side = ui.includes('globe-big-side') && ui.includes("id=\"globe-danmu\"")
  if (big && side) pass('X2 enlarge mounts a bigger globe with feed beside it')
  else fail('X2', JSON.stringify({ big, side }))
}
// X3: dark mode control still exists
{
  const btn = html.includes('id="theme-cycle"')
  const logic = ui.includes('function applyTheme') && ui.includes("dataset.theme")
  const darkCss = /data-theme="dark"/.test(ui)
  if (btn && logic && darkCss) pass('X3 light/dark/system switch intact')
  else fail('X3', JSON.stringify({ btn, logic, darkCss }))
}
// X4: the trend spans the row, ranking and share sit side by side
{
  const widgets = /\.kpis\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/.test(ui)
  const dash = /\.dash\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(ui)
  // The trend card now carries two faces (chart + heat map, swapped by the
  // chevrons), so the heading lives in a card-head rather than directly in
  // the card.
  const wide = /<div class="card span2"><div class="card-head"><h2 id="trend-title">读取趋势<\/h2>[\s\S]{0,400}?id="chart-box"[\s\S]{0,200}?id="heat-box"/.test(html)
  const inline = /id="chart-box"[\s\S]{0,400}?id="top-box"[\s\S]{0,400}?id="donut-box"/.test(html)
  if (widgets && dash && wide && inline) pass('X4 dense dashboard: widgets, wide trend, ranking and share on the first screen')
  else fail('X4', JSON.stringify({ widgets, dash, wide, inline }))
}
// X5: agent stat cards stay horizontal and match the overview KPI look
{
  const cols = /\.agent-stats\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(ui)
  const uniform = /\.agent-stat\{[^}]*min-height/.test(ui)
  const kpiLook = /\.agent-stat\{[^}]*border-radius:var\(--ios-radius\)/.test(ui)
  const notOneCol = !/@media\(max-width:720px\)\{\.agent-stats\{grid-template-columns:1fr/.test(ui)
  if (cols && uniform && kpiLook && notOneCol) pass('X5 agent stats are three uniform horizontal cards')
  else fail('X5', JSON.stringify({ cols, uniform, kpiLook, notOneCol }))
}
// X6: trend chart keeps its spacious height
{
  const h = /\.grid3>\.card\{[^}]*height:(\d+)px/.exec(ui)
  const px = h ? Number(h[1]) : 0
  if (px >= 200) pass('X6 panels keep a fixed height (' + px + 'px)')
  else fail('X6', 'min-height=' + px)
}
// X7: enlarge is a near-fullscreen overlay, not a small modal
{
  const fixed = /\.globe-big\{position:fixed;inset:6%/.test(ui)
  const stage = /\.globe-box-big\{[^}]*height:100%/.test(ui)
  const close = ui.includes('function closeBigGlobe') && ui.includes('globe-big-close')
  if (fixed && stage && close) pass('X7 enlarge is a card with a close button')
  else fail('X7', JSON.stringify({ fixed, stage, close }))
}
// X8: theme switch is visible and sits before the nav
{
  const before = html.indexOf('id="theme-cycle"') < html.indexOf('<nav id="nav"')
  const styled = /\.theme-cycle\{border:0/.test(html)
  if (before && styled) pass('X8 theme switch is visible in the header')
  else fail('X8', JSON.stringify({ before, styled }))
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== ui polish ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
