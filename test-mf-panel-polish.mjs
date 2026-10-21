import { Miniflare } from 'miniflare'
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const KEK = Buffer.alloc(32, 141).toString('base64')
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const seed = { agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'y@e.invalid' }, itemGroups: {}, security: {} }
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(seed) })
const lr = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })
const cookie = String(lr.headers.get('set-cookie') || '').split(';')[0]
const page = await mf.dispatchFetch('https://broker.test/', { headers: { cookie } })
const html = await page.text()
const ui = fs.readFileSync('src/ui.js', 'utf8')
// Z1: ranking scrolls without a visible scrollbar
{
  const hidden = ui.includes('.grid3 .rank-box{height:210px;min-height:210px;overflow-y:auto;scrollbar-width:none')
  const webkit = ui.includes('.grid3 .rank-box::-webkit-scrollbar{width:0;height:0;display:none}')
  if (hidden && webkit) pass('Z1 ranking scrolls with no visible scrollbar')
  else fail('Z1', JSON.stringify({ hidden, webkit }))
}
// Z2: the pause control is an icon inside the range group
{
  const seg = html.indexOf('id="globe-range"')
  const pause = html.indexOf('id="globe-pause"')
  const icon = html.includes('>⏸</button>')
  if (pause > seg && pause < seg + 400 && icon) pass('Z2 pause icon lives in the range group')
  else fail('Z2', JSON.stringify({ seg, pause, icon }))
}
// Z3: the globe panel is shorter, the donut gets more room
{
  const g = ui.indexOf('.grid3 .globe-box{height:180px')
  const d = ui.indexOf('.grid3 .donut-wrap{height:240px')
  if (g > 0 && d > 0) pass('Z3 globe shortened, donut enlarged')
  else fail('Z3', JSON.stringify({ g, d }))
}
// Z4: legend is two columns with paging and a fixed ring
{
  const twoCol = ui.includes('grid-template-columns:repeat(2,minmax(0,1fr))')
  const pager = ui.includes('legend-pager') && ui.includes('legend-prev') && ui.includes('legend-next')
  const fixed = ui.includes('const pageAgents = agents.slice(legendPage * LEGEND_PER_PAGE')
  if (twoCol && pager && fixed) pass('Z4 legend is two columns with paging, ring fixed')
  else fail('Z4', JSON.stringify({ twoCol, pager, fixed }))
}
// Z5: agent stat cards are one row, with no duplicate rules overriding them
{
  const cols = ui.includes('grid-template-columns:repeat(3,minmax(0,1fr))!important')
  const dupes = (ui.match(/\.agent-stat b\{[^}]*font-size:22px/g) || []).length
  const noCollapse = !ui.includes('@media(max-width:420px){.agent-stats{grid-template-columns:1fr}')
  if (cols && dupes === 0 && noCollapse) pass('Z5 agent stat cards are one row with clean styles')
  else fail('Z5', JSON.stringify({ cols, dupes, noCollapse }))
}
// Z6: the feed explains what a failure means
{
  const explained = html.includes('失败=权限不足或条目不存在')
  if (explained) pass('Z6 feed explains the failure meaning')
  else fail('Z6', 'no explanation')
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== panel polish ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)