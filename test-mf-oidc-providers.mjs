// The reported regressions: an OIDC callback must work for a provider other
// than the legacy 'default' one, an existing legacy identity must keep working
// without being re-bound, and a share must record the credential identity so it
// is not refused afterwards as 'unbound-legacy-identity'.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 233).toString('base64')
const ACCT = 'oidc@example.invalid'
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state ?? p)
const putState = (state) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
const adminGet = (p) => mf.dispatchFetch('https://broker.test' + p, { headers: { cookie } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
const adminPost = (p, body) => mf.dispatchFetch('https://broker.test' + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))

const base = () => ({
  agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthGrants: {},
  capabilities: {}, actionGrants: {}, usePolicies: {}, grants: {}, pending: {}, audit: [],
  itemIds: {}, legacyItemBindings: {}, policies: {}, itemGroups: {},
  settings: { vaultEmail: ACCT, notifications: {} },
  profile: {},
  security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' },
})
await putState(base())

// The login cookie is issued once against whatever state exists then; the
// suites below replace the state, so it is re-minted per case.
let cookie = ''
async function login() {
  const res = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })
  if (!res.ok) throw new Error('login failed: ' + res.status)
  cookie = String(res.headers.get('set-cookie') || '').split(';')[0]
}
await login()

// O1: with only a legacy identity configured, that identity is reported as
// bound to the 'default' provider. Asking the operator to bind again was the
// reported symptom.
{
  const state = base()
  state.settings.oidc = { id: 'default', issuer: 'https://legacy.example', clientId: 'cid' }
  state.profile = { oidcIssuer: 'https://legacy.example', oidcSub: 'sub-1', oidcEmail: 'me@example.invalid' }
  await putState(state)
  await login()
  const res = await adminGet('/api/profile')
  const bindings = res.body.oidcBindings ?? {}
  if (bindings.default && bindings.default.sub === 'sub-1') pass('O1 an existing legacy identity stays bound to the default provider')
  else fail('O1', JSON.stringify(bindings))
}

// O2: a second provider must NOT inherit that identity — it has to bind on its own.
{
  const state = base()
  state.settings.oidc = { id: 'default', issuer: 'https://legacy.example', clientId: 'cid' }
  state.settings.oidcProviders = { corp: { id: 'corp', label: 'Corp', issuer: 'https://corp.example', clientId: 'cid2', enabled: true } }
  state.profile = { oidcIssuer: 'https://legacy.example', oidcSub: 'sub-1' }
  await putState(state)
  await login()
  const res = await adminGet('/api/profile')
  const bindings = res.body.oidcBindings ?? {}
  if (bindings.default && !bindings.corp) pass('O2 a new provider does not inherit the legacy identity')
  else fail('O2', JSON.stringify(bindings))
}

// O3: a provider stored under the id 'default' does not duplicate the legacy one.
{
  const state = base()
  state.settings.oidc = { id: 'default', issuer: 'https://legacy.example', clientId: 'cid' }
  state.settings.oidcProviders = { default: { id: 'default', label: 'Dup', issuer: 'https://dup.example', clientId: 'x', enabled: true } }
  await putState(state)
  await login()
  const res = await adminGet('/api/oidc/providers')
  const providers = res.body.providers ?? []
  const defaults = providers.filter((p) => p.id === 'default')
  if (defaults.length === 1) pass('O3 a stored provider cannot duplicate the legacy default id')
  else fail('O3', JSON.stringify(providers.map((p) => p.id)))
}

// O4: the callback resolves its provider from the state cookie instead of an
// undefined variable. A direct hit without a state cookie must be a clean 400,
// not a 500 from a ReferenceError.
{
  const res = await mf.dispatchFetch('https://broker.test/oidc/callback?code=x&state=y', { headers: { cookie } })
  const body = await res.text()
  if (res.status === 400 && !/cbState|ReferenceError/.test(body)) pass('O4 the OIDC callback handles a stateless hit without crashing')
  else fail('O4', res.status + ' ' + body.slice(0, 160))
}

// O5: unbinding the legacy provider really clears the single global identity,
// otherwise it keeps being reported as bound.
{
  const state = base()
  state.settings.oidc = { id: 'default', issuer: 'https://legacy.example', clientId: 'cid' }
  state.profile = { oidcIssuer: 'https://legacy.example', oidcSub: 'sub-1' }
  await putState(state)
  await login()
  await mf.dispatchFetch('https://broker.test/api/profile/oidc/bindings', { method: 'DELETE', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ id: 'default' }) })
  const res = await adminGet('/api/profile')
  const bindings = res.body.oidcBindings ?? {}
  if (!bindings.default) pass('O5 unbinding the legacy provider clears the global identity')
  else fail('O5', JSON.stringify(bindings))
}

// O6: the secret client credential never leaves the broker, only the fact that
// one is stored.
{
  const state = base()
  state.settings.oidcProviders = { corp: { id: 'corp', label: 'Corp', issuer: 'https://corp.example', clientId: 'cid2', clientSecret: 'super-secret', enabled: true } }
  await putState(state)
  await login()
  const res = await adminGet('/api/oidc/providers')
  const raw = JSON.stringify(res.body)
  const corp = (res.body.providers ?? []).find((p) => p.id === 'corp')
  if (corp && corp.secretConfigured === true && !raw.includes('super-secret')) pass('O6 a stored client secret is reported, never returned')
  else fail('O6', raw.slice(0, 200))
}

// O7: the plugin's provider list is not exposed without admin authorisation.
{
  const anon = await mf.dispatchFetch('https://broker.test/api/oidc/providers')
  if (anon.status === 401) pass('O7 the provider list requires admin authorisation')
  else fail('O7', String(anon.status))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== oidc providers + regrant ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
