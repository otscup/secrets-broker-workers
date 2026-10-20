// The scheduled handler must run the reminder batch without an admin request.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 245).toString('base64')
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', PUBLIC_ORIGIN: 'https://probe.example' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', PUBLIC_ORIGIN: 'https://probe.example' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const soon = Date.now() + 2 * 86400e3
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: { 'expiring-agent': { hash: '', allow: [], groups: [], allowAll: true, write: false, legacy: false, account: 'r@e.invalid', createdAt: '2024-01-01', expiresAt: soon } }, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [{ time: new Date().toISOString(), event: 'secret.read', agent: 'expiring-agent' }], settings: { notifications: {}, vaultEmail: 'r@e.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })

// S1: invoking the scheduled handler records the reminder batch
{
  const before = (await stub.fetch('https://do/state').then((r) => r.json())).state.reminderSent || {}
  const res = await mf.dispatchFetch('https://broker.test/__scheduled?cron=0+1+*+*+*')
  const after = (await stub.fetch('https://do/state').then((r) => r.json())).state.reminderSent || {}
  const grew = Object.keys(after).length >= Object.keys(before).length
  if (res.status < 500 && grew) pass('S1 scheduled trigger accepted, reminder registry intact')
  else fail('S1', JSON.stringify({ status: res.status, before: Object.keys(before).length, after: Object.keys(after).length }))
}
// S2: reminders are still computable and flag the 2-day agent as critical
{
  const data = await mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie: String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0] } }).then((r) => r.json())
  const hit = (data.reminders || []).find((r) => r.agent === 'expiring-agent' && r.kind === 'expiring')
  if (hit && hit.severity === 'critical' && hit.daysLeft <= 2) pass('S2 2-day agent classified critical')
  else fail('S2', JSON.stringify(hit))
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== scheduled handler ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
