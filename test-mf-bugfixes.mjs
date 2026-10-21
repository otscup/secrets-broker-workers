// Regression guards for the reported UI/UX bugs.
import { Miniflare } from 'miniflare'
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 157).toString('base64')
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'f@e.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
const html = await mf.dispatchFetch('https://broker.test/', { headers: { cookie } }).then((r) => r.text())
const gsrc = fs.readFileSync('src/globe/index.js', 'utf8')
const ui = fs.readFileSync('src/ui.js', 'utf8')
const isrc = fs.readFileSync('src/index.js', 'utf8')

// F1: no empty bumpImageUrl (it threw and killed the whole chain)
{
  const bad = gsrc.includes("bumpImageUrl('')")
  if (!bad) pass('F1 no empty bumpImageUrl')
  else fail('F1', 'bumpImageUrl empty string present')
}
// F2: agent stat cards are three columns; they must not collapse at phone width
{
  const cols = /\.agent-stats\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(ui)
  const earlyCollapse = /@media\(max-width:720px\)\{\.agent-stats\{grid-template-columns:1fr/.test(ui)
  if (cols && !earlyCollapse) pass('F2 agent stats stay in 3 columns')
  else fail('F2', JSON.stringify({ cols, earlyCollapse }))
}
// F3: globe sits in the shared overview grid with the other cards
{
  const inGrid = /<div class="grid3">[\s\S]{0,1200}?id="globe-card"/.test(html)
  if (inGrid) pass('F3 globe card lives in the overview grid')
  else fail('F3', 'globe not in grid3')
}
// F4: globe canvas is compact, matching the donut card
{
  const h = /\.globe-box\{[^}]*height:(\d+)px/.exec(ui)
  const px = h ? Number(h[1]) : 0
  if (px > 0 && px <= 280) pass('F4 globe box is compact (' + px + 'px)')
  else fail('F4', 'height=' + px)
}
// F5: corner icon opens the enlarged view
{
  const btn = html.includes('id="globe-full"')
  const opensModal = ui.includes("if (fullBtn) fullBtn.onclick = () => openGlobeModal()")
  if (btn && opensModal) pass('F5 corner icon opens the detail view')
  else fail('F5', JSON.stringify({ btn, opensModal }))
}
// F6: failed token exchanges are audited with a reason
{
  const audited = isrc.includes("event: 'oauth.token-deny'") && isrc.includes('PKCE verification failed')
  if (audited) pass('F6 token failures audited with reason')
  else fail('F6', 'no deny audit')
}
// F7: token rejection still returns a proper OAuth error
{
  const r = await mf.dispatchFetch('https://broker.test/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=authorization_code&code=bogus&client_id=x&redirect_uri=y' })
  const body = await r.json()
  if (r.status === 400 && body.error === 'invalid_grant' && body.error_description) pass('F7 rejects with a descriptive invalid_grant')
  else fail('F7', JSON.stringify(body))
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== reported bug fixes ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
