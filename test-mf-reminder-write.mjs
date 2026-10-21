// The reminder batch must not clobber unrelated state. It used to persist a
// whole-state snapshot, which could drop an OAuth client registered while the
// batch was in flight. The sent markers are now written atomically.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 147).toString('base64')
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const base = { agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'a@b.invalid' }, itemGroups: {}, security: {} }
const getState = () => stub.fetch('https://do/state').then((r) => r.json()).then((p) => p.state)
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
const register = () => mf.dispatchFetch('https://broker.test/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'race', redirect_uris: ['http://127.0.0.1:9999/cb'] }) }).then((r) => r.json())

// X1: an agent that is about to expire so the reminder batch has real work
{
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(base) })
  await stub.fetch('https://do/state/mutate', { method: 'POST', body: JSON.stringify({ ops: [{ op: 'set', path: ['agents', 'expiring'], value: { hash: 'h', allow: [], groups: [], allowAll: true, write: false, legacy: false, account: 'a@b.invalid', createdAt: '2024-01-01', expiresAt: Date.now() + 2 * 86400e3 } }] }) })
  const st = await getState()
  if (st.agents.expiring) pass('X1 expiring agent seeded')
  else fail('X1', 'seed failed')
}
// X2: 30 concurrent registration + /api/state rounds lose nothing
{
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(base) })
  await stub.fetch('https://do/state/mutate', { method: 'POST', body: JSON.stringify({ ops: [{ op: 'set', path: ['agents', 'expiring'], value: { hash: 'h', allow: [], groups: [], allowAll: true, write: false, legacy: false, account: 'a@b.invalid', createdAt: '2024-01-01', expiresAt: Date.now() + 2 * 86400e3 } }] }) })
  let lost = 0
  for (let i = 0; i < 30; i += 1) {
    const reg = register()
    const churn = Array.from({ length: 6 }, () => mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie } }))
    const body = await reg
    await Promise.all(churn)
    const st = await getState()
    if (!Object.keys(st.oauthClients || {}).includes(body.client_id)) lost += 1
  }
  if (lost === 0) pass('X2 30 concurrent rounds lost no registration')
  else fail('X2', 'lost=' + lost)
}
// X3: the reminder marker write is atomic, not a whole-state overwrite
{
  const src = (await import('node:fs')).readFileSync('src/index.js', 'utf8')
  const atomic = src.includes("path: ['reminderSent',") && src.includes('if (ops.length) await mutateState(env, ops)')
  const noWhole = !/await updateState\(env, \(next\) => \{\s*next\.reminderSent/.test(src)
  if (atomic && noWhole) pass('X3 reminder markers are written atomically')
  else fail('X3', JSON.stringify({ atomic, noWhole }))
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== reminder write safety ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)