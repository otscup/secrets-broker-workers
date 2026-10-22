// A legacy grant with no identity binding could not be deleted or restored from
// the UI because the only buttons on that card were re-grant actions. Delete and
// restore must work on it exactly like on any other grant.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 181).toString('base64')
const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const AGENT = 'legacy-agent'
const ITEM = 'legacy-item'
const ACCT = 'legacy@example.invalid'

const base = () => ({
  agents: {}, policies: {}, grants: {}, pending: {}, audit: [], itemIds: {}, legacyItemBindings: {},
  settings: { notifications: {}, vaultEmail: ACCT }, profile: {},
  security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' },
})
const login = async () => {
  const res = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })
  return String(res.headers.get('set-cookie') || '').split(';')[0]
}
const post = (path, body, cookie) => mf.dispatchFetch('https://broker.test' + path, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
const stateNow = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const seedUnbound = async () => {
  const st = base()
  st.grants[AGENT + '\u0000' + ITEM] = { agent: AGENT, name: ITEM, mode: 'share', createdAt: new Date().toISOString(), expiresAt: 0, reads: 0, maxReads: null, revokedAt: null, account: ACCT }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
}
const API = '/api/state'
const unboundNow = async (cookie) => {
  const res = await mf.dispatchFetch('https://broker.test' + API, { headers: { cookie } })
  const view = await res.json()
  return (view.legacyUnbound || []).find((e) => e.agent === AGENT && e.name === ITEM) || null
}

// X1: the unbound grant is reported, which is what makes it visible in the table.
{
  await seedUnbound()
  const cookie = await login()
  const entry = await unboundNow(cookie)
  if (entry) pass('X1 an unbound legacy grant is reported for the table')
  else fail('X1', 'not reported')
}

// X2: it can be deleted.
{
  await seedUnbound()
  const cookie = await login()
  const res = await post('/api/grants/delete', { agent: AGENT, name: ITEM }, cookie)
  const st = await stateNow()
  const gone = !st.grants?.[AGENT + '\u0000' + ITEM]
  if (res.status === 200 && gone) pass('X2 an unbound legacy grant can be deleted')
  else fail('X2', JSON.stringify({ status: res.status, gone }))
}

// X3: deleting a nonexistent grant is a clear 404, not a silent success.
{
  const cookie = await login()
  const res = await post('/api/grants/delete', { agent: 'nobody', name: 'nothing' }, cookie)
  if (res.status === 404) pass('X3 deleting a missing grant reports not-found')
  else fail('X3', String(res.status))
}

// X4: a revoked grant can be restored, which was the other broken action.
{
  const st = base()
  st.grants[AGENT + '\u0000' + ITEM] = { agent: AGENT, name: ITEM, mode: 'share', createdAt: new Date().toISOString(), expiresAt: 0, reads: 3, maxReads: 5, revokedAt: new Date().toISOString(), account: ACCT }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const cookie = await login()
  const res = await post('/api/grants/restore', { agent: AGENT, name: ITEM }, cookie)
  const after = await stateNow()
  const grant = after.grants?.[AGENT + '\u0000' + ITEM]
  if (res.status === 200 && grant && !grant.revokedAt && grant.reads === 0) pass('X4 a revoked grant can be restored and its read count resets')
  else fail('X4', JSON.stringify({ status: res.status, revokedAt: grant?.revokedAt, reads: grant?.reads }))
}

// X5: restore revives an expired grant instead of leaving it expired.
{
  const st = base()
  st.grants[AGENT + '\u0000' + ITEM] = { agent: AGENT, name: ITEM, mode: 'share', createdAt: new Date().toISOString(), expiresAt: Date.now() - 60000, reads: 0, maxReads: null, revokedAt: null, account: ACCT }
  await stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(st) })
  const cookie = await login()
  await post('/api/grants/restore', { agent: AGENT, name: ITEM }, cookie)
  const grant = (await stateNow()).grants?.[AGENT + '\u0000' + ITEM]
  if (grant && grant.expiresAt === 0) pass('X5 restoring an expired grant makes it permanent rather than leaving it expired')
  else fail('X5', JSON.stringify({ expiresAt: grant?.expiresAt }))
}

// X6: delete requires admin authorisation.
{
  await seedUnbound()
  const res = await mf.dispatchFetch('https://broker.test/api/grants/delete', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: AGENT, name: ITEM }),
  })
  const st = await stateNow()
  const still = Boolean(st.grants?.[AGENT + '\u0000' + ITEM])
  if (res.status === 401 && still) pass('X6 deleting a grant requires admin authorisation')
  else fail('X6', JSON.stringify({ status: res.status, still }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== legacy grant delete + restore ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
