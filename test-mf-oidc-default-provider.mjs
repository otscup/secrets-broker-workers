// The legacy single OIDC configuration is exposed as the provider with id
// 'default'. Saving it used to write into settings.oidcProviders, which
// oidcProviders() then hid behind the legacy entry, so its name and label could
// never be changed. It must write the legacy slot instead.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 197).toString('base64')
const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const base = () => ({
  agents: {}, policies: {}, grants: {}, pending: {}, audit: [], itemIds: {}, legacyItemBindings: {},
  settings: { notifications: {}, oidc: { id: 'default', issuer: 'https://old.example', clientId: 'old-client', label: '默认' } },
  profile: {},
  security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' },
})
await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(base()) })
const login = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })
const cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
const getProviders = async () => (await (await mf.dispatchFetch('https://broker.test/api/oidc/providers', { headers: { cookie } })).json()).providers || []
const save = (body) => mf.dispatchFetch('https://broker.test/api/oidc/providers', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
}).then((r) => r.json())
const stateNow = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)

// D1: rename the default provider and see the new label come back.
{
  const saved = await save({ id: 'default', label: 'Clerk 主账号', issuer: 'https://old.example', clientId: 'old-client' })
  const providers = await getProviders()
  const entry = providers.find((p) => p.id === 'default')
  if (saved.ok && entry && entry.label === 'Clerk 主账号') pass('D1 the default provider can be renamed')
  else fail('D1', JSON.stringify({ saved, entry }))
}

// D2: the rename lands in the legacy slot, not in a shadow provider.
{
  const st = await stateNow()
  const shadow = st.settings?.oidcProviders?.default
  const legacyLabel = st.settings?.oidc?.label
  if (!shadow && legacyLabel === 'Clerk 主账号') pass('D2 the rename is stored in the legacy slot, no shadow entry')
  else fail('D2', JSON.stringify({ shadow: Boolean(shadow), legacyLabel }))
}

// D3: only one provider with id 'default' is ever listed.
{
  const providers = await getProviders()
  const defaults = providers.filter((p) => p.id === 'default')
  if (defaults.length === 1) pass('D3 exactly one default provider is listed')
  else fail('D3', JSON.stringify(providers.map((p) => p.id)))
}

// D4: the issuer and client id can be changed too.
{
  await save({ id: 'default', label: 'Clerk 主账号', issuer: 'https://new.example', clientId: 'new-client' })
  const entry = (await getProviders()).find((p) => p.id === 'default')
  if (entry && entry.issuer === 'https://new.example' && entry.clientId === 'new-client') pass('D4 the default issuer and client id are editable')
  else fail('D4', JSON.stringify(entry))
}

// D5: a client secret can be stored and is never returned.
{
  await save({ id: 'default', label: 'Clerk 主账号', issuer: 'https://new.example', clientId: 'new-client', clientSecret: 'top-secret-value' })
  const providers = await getProviders()
  const entry = providers.find((p) => p.id === 'default')
  const raw = JSON.stringify(providers)
  if (entry && entry.secretConfigured === true && !raw.includes('top-secret-value')) pass('D5 a secret is stored on the default provider and never returned')
  else fail('D5', raw.slice(0, 200))
}

// D6: an empty secret keeps the stored one.
{
  await save({ id: 'default', label: 'Clerk 主账号', issuer: 'https://new.example', clientId: 'new-client' })
  const entry = (await getProviders()).find((p) => p.id === 'default')
  if (entry && entry.secretConfigured === true) pass('D6 saving with an empty secret keeps the stored one')
  else fail('D6', JSON.stringify(entry))
}

// D7: an additional provider is still saved separately and stays separate.
{
  await save({ id: 'corp', label: '公司', issuer: 'https://corp.example', clientId: 'corp-client' })
  const providers = await getProviders()
  const def = providers.find((p) => p.id === 'default')
  const corp = providers.find((p) => p.id === 'corp')
  if (def && corp && def.issuer === 'https://new.example' && corp.issuer === 'https://corp.example') pass('D7 a second provider does not disturb the default one')
  else fail('D7', JSON.stringify({ def: def?.issuer, corp: corp?.issuer }))
}

// D8: disabling the default provider is honoured.
{
  await save({ id: 'default', label: 'Clerk 主账号', issuer: 'https://new.example', clientId: 'new-client', enabled: false })
  const entry = (await getProviders()).find((p) => p.id === 'default')
  if (entry && entry.enabled === false) pass('D8 the default provider can be disabled')
  else fail('D8', JSON.stringify(entry))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== default provider editable ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
