// OIDC/Vault binding: a password unlock stores only a wrapped copy of the
// session keys for already-bound providers; unbinding and locking revoke it.
import { Miniflare } from 'miniflare'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 7).toString('base64')
const E = Buffer.alloc(32, 1)
const M = Buffer.alloc(32, 2)
const E_B64 = E.toString('base64')
const ADMIN = 'oidc-vault-admin'
const ACCT = 'oidc-vault@example.invalid'
const KEY = 'default\u0000sub-1'
const BASE = 'https://oidc-vault.test'

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: ADMIN },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const putState = (state) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })

const empty = {
  agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  settings: { notifications: {}, vaultEmail: ACCT }, capabilities: {}, actionGrants: {}, usePolicies: {},
  profile: { oidcBindings: {
    default: { providerId: 'default', issuer: 'https://idp.example', sub: 'sub-1', account: ACCT },
    other: { providerId: 'other', issuer: 'https://idp.example', sub: 'sub-2', account: 'other@example.invalid' },
  } },
}
await putState(empty)

let cookie = ''
const call = async (path, options = {}) => {
  const response = await mf.dispatchFetch(BASE + path, {
    method: options.method || 'GET',
    headers: { cookie, origin: BASE, 'content-type': 'application/json' },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

const login = await mf.dispatchFetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: ADMIN }) })
cookie = String(login.headers.get('set-cookie') || '').split(';')[0]
if (!cookie) { console.log('FAIL  could not log in as admin'); process.exit(1) }

const unlock = await call('/api/unlock', { method: 'POST', body: { symEncKey: E_B64, symMacKey: M.toString('base64'), ttl: 'permanent' } })
const afterUnlock = await getState()
const stored = afterUnlock.oidcVault?.[KEY]
if (unlock.status === 200 && stored?.wrapped && !JSON.stringify(stored).includes(E_B64)) {
  pass('OV1 password unlock stores a wrapped OIDC Vault copy, never the plaintext key')
} else {
  fail('OV1', JSON.stringify({ unlock, stored }).slice(0, 300))
}

if (!afterUnlock.oidcVault?.['other\u0000sub-2']) pass('OV2 only the binding for the unlocked account gets keys')
else fail('OV2', JSON.stringify(Object.keys(afterUnlock.oidcVault ?? {})))

const unbind = await call('/api/profile/oidc/bindings', { method: 'DELETE', body: { id: 'default' } })
const afterUnbind = await getState()
if (unbind.status === 200 && !afterUnbind.oidcVault?.[KEY]) pass('OV3 unbinding a provider drops its wrapped Vault keys')
else fail('OV2', JSON.stringify({ unbind, vault: afterUnbind.oidcVault }).slice(0, 300))

// Keep the live admin cookie: replacing the whole state drops adminSessions.
const rebound = await getState()
rebound.profile.oidcBindings = { default: { providerId: 'default', issuer: 'https://idp.example', sub: 'sub-1', account: ACCT } }
await putState(rebound)
await call('/api/unlock', { method: 'POST', body: { symEncKey: E_B64, symMacKey: M.toString('base64'), ttl: 'permanent' } })
const beforeLock = await getState()
const lock = await call('/api/lock', { method: 'POST', body: { password: ADMIN } })
const afterLock = await getState()
if (beforeLock.oidcVault?.[KEY] && lock.status === 200 && Object.keys(afterLock.oidcVault ?? {}).length === 0) {
  pass('OV4 an explicit lock revokes OIDC auto-unlock')
} else {
  fail('OV4', JSON.stringify({ before: Boolean(beforeLock.oidcVault?.[KEY]), lock, after: afterLock.oidcVault }).slice(0, 300))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== oidc-vault ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
