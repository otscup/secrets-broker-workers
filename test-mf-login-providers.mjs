// The standalone /login page used to hardcode ONE provider-less OIDC link, so a
// newly added provider never appeared there. Adding a provider must be enough.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 219).toString('base64')
const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const put = (state) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
const loginPage = async () => {
  const res = await mf.dispatchFetch('https://broker.test/login?next=%2F%3Fview%3Dprofile')
  return { status: res.status, html: await res.text() }
}

const base = () => ({
  agents: {}, policies: {}, grants: {}, pending: {}, audit: [], itemIds: {}, legacyItemBindings: {},
  settings: { notifications: {} }, profile: {},
  security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' },
})

// L1: no provider configured — no OIDC block at all.
{
  await put(base())
  const { html } = await loginPage()
  if (!html.includes('/oidc/login')) pass('L1 no provider means no OIDC button')
  else fail('L1', 'an OIDC link appears with no provider configured')
}

// L2: one provider — exactly one button, carrying its id.
{
  const state = base()
  state.settings.oidcProviders = { corp: { id: 'corp', label: '公司账号', issuer: 'https://corp.example', clientId: 'cid', enabled: true } }
  await put(state)
  const { html } = await loginPage()
  const hits = html.split('/oidc/login').length - 1
  const carriesId = html.includes('/oidc/login?provider=corp')
  const label = html.includes('使用 公司账号 登录')
  if (hits === 1 && carriesId && label) pass('L2 one provider renders one labelled button with its id')
  else fail('L2', JSON.stringify({ hits, carriesId, label }))
}

// L3: two providers — both appear, each with its own id. This is the reported
// bug: the second provider existed but never showed up on the login page.
{
  const state = base()
  state.settings.oidc = { id: 'default', issuer: 'https://legacy.example', clientId: 'c1' }
  state.settings.oidcProviders = { corp: { id: 'corp', label: '公司账号', issuer: 'https://corp.example', clientId: 'c2', enabled: true } }
  await put(state)
  const { html } = await loginPage()
  const hasDefault = html.includes('/oidc/login?provider=default')
  const hasCorp = html.includes('/oidc/login?provider=corp')
  if (hasDefault && hasCorp) pass('L3 both providers appear on the login page')
  else fail('L3', JSON.stringify({ hasDefault, hasCorp }))
}

// L4: a provider added later appears with no code change.
{
  const state = base()
  state.settings.oidcProviders = { alpha: { id: 'alpha', label: 'Alpha', issuer: 'https://a.example', clientId: 'x', enabled: true } }
  await put(state)
  const first = (await loginPage()).html
  state.settings.oidcProviders.beta = { id: 'beta', label: 'Beta', issuer: 'https://b.example', clientId: 'y', enabled: true }
  await put(state)
  const second = (await loginPage()).html
  if (first.includes('provider=alpha') && !first.includes('provider=beta') && second.includes('provider=alpha') && second.includes('provider=beta')) {
    pass('L4 a newly added provider appears automatically')
  } else fail('L4', JSON.stringify({ first: first.includes('provider=beta'), second: second.includes('provider=beta') }))
}

// L5: a disabled provider is not offered.
{
  const state = base()
  state.settings.oidcProviders = { live: { id: 'live', label: 'Live', issuer: 'https://l.example', clientId: 'a', enabled: true }, off: { id: 'off', label: 'Off', issuer: 'https://o.example', clientId: 'b', enabled: false } }
  await put(state)
  const { html } = await loginPage()
  if (html.includes('provider=live') && !html.includes('provider=off')) pass('L5 a disabled provider is not offered')
  else fail('L5', JSON.stringify({ live: html.includes('provider=live'), off: html.includes('provider=off') }))
}

// L6: a provider label cannot inject markup into the page.
{
  const state = base()
  state.settings.oidcProviders = { evil: { id: 'evil', label: '<img src=x onerror=alert(1)>', issuer: 'https://e.example', clientId: 'z', enabled: true } }
  await put(state)
  const { html } = await loginPage()
  if (!html.includes('<img src=x onerror')) pass('L6 a provider label is escaped')
  else fail('L6', 'provider label injected raw markup')
}

// L7: the next target survives into each link, so a sign-in returns where it
// started instead of always to /.
{
  const state = base()
  state.settings.oidcProviders = { corp: { id: 'corp', label: 'Corp', issuer: 'https://c.example', clientId: 'c', enabled: true } }
  await put(state)
  const { html } = await loginPage()
  if (html.includes(encodeURIComponent('/?view=profile'))) pass('L7 the return target is carried into the OIDC link')
  else fail('L7', 'next target missing from the OIDC link')
}

// L8: a multi-line page is still valid, parseable HTML with the form intact.
{
  const state = base()
  state.settings.oidcProviders = { corp: { id: 'corp', label: 'Corp', issuer: 'https://c.example', clientId: 'c', enabled: true } }
  await put(state)
  const { html } = await loginPage()
  const needed = ['id="password"', 'id="go"', 'id="code"', 'id="status"', 'id="totp"']
  const missing = needed.filter((id) => !html.includes(id))
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)
  let parses = false
  try { new Function(script[1]); parses = true } catch (e) { console.log('   ' + e.message) }
  if (missing.length === 0 && parses) pass('L8 the login form and its script are intact')
  else fail('L8', JSON.stringify({ missing, parses }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== login page providers ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
