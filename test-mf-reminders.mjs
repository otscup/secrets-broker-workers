// Authorization reminders: expiry thresholds (5/3/1 days), idle agents, pending
// priority, and outgoing notification de-duplication.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 255).toString('base64')
const PASS = 'p'
const ACCT = 'rem@example.invalid'

const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: PASS }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const DAY = 86400e3
const now = Date.now()
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: ACCT }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASS }) })).headers.get('set-cookie') || '').split(';')[0]

const agents = {}
for (const [name, days] of [['d5', 5], ['d3', 3], ['d1', 1], ['d0', 0], ['far', 40], ['perm', null]]) {
  agents[name] = { hash: '', allow: [], groups: [], allowAll: true, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' }
  if (days !== null) agents[name].expiresAt = now + days * DAY
}
const audit = [{ time: new Date(now - 10 * DAY).toISOString(), event: 'secret.read', agent: 'idle-one' }, { time: new Date(now - 60000).toISOString(), event: 'secret.read', agent: 'd1' }]
// Preserve the admin session created by /api/login, else every probe is 401.
const seeded = (await stub.fetch('https://do/state').then((r) => r.json())).state
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ ...seeded, agents: { ...agents, 'idle-one': { hash: '', allow: [], groups: [], allowAll: true, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } }, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit, settings: { notifications: {}, vaultEmail: ACCT }, itemGroups: {}, security: seeded.security || { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })

const state = async () => mf.dispatchFetch('https://broker.test/api/state', { headers: { cookie } }).then((r) => r.json())

// R1: 5/3/1-day windows all produce reminders with the right severity
{
  const data = await state()
  const byAgent = {}
  for (const r of data.reminders || []) (byAgent[r.agent] ??= []).push(r)
  const d5 = (byAgent.d5 || []).find((r) => r.kind === 'expiring')
  const d3 = (byAgent.d3 || []).find((r) => r.kind === 'expiring')
  const d1 = (byAgent.d1 || []).find((r) => r.kind === 'expiring')
  // Operator rule: below 3 days is red, up to 5 days is orange.
  const ok = d5?.severity === 'warning' && d3?.severity === 'warning' && d1?.severity === 'critical'
  if (ok) pass('R1 5/3/1-day reminders use warning/warning/critical')
  else fail('R1', JSON.stringify({ d5, d3, d1 }))
}
// R2: already-expired agent flagged critical
{
  const data = await state()
  const expired = (data.reminders || []).find((r) => r.agent === 'd0' && r.kind === 'expired')
  if (expired && expired.severity === 'critical') pass('R2 expired agent flagged critical')
  else fail('R2', JSON.stringify(expired))
}
// R3: far-future and permanent agents get no EXPIRY reminder (they may still be
// flagged idle, which is a different signal and is correct when never used).
{
  const data = await state()
  const expiry = (data.reminders || []).filter((r) => (r.kind === 'expiring' || r.kind === 'expired') && (r.agent === 'far' || r.agent === 'perm'))
  if (expiry.length === 0) pass('R3 far-future and permanent agents get no expiry reminder')
  else fail('R3', JSON.stringify(expiry))
}
// R4: idle agent (10 days quiet) is reported
{
  const data = await state()
  const idle = (data.reminders || []).find((r) => r.agent === 'idle-one' && r.kind === 'idle')
  if (idle && idle.severity === 'notice' && idle.daysIdle >= 10) pass('R4 idle agent reported with day count')
  else fail('R4', JSON.stringify(idle))
}
// R5: recently active agent is not idle-flagged
{
  const data = await state()
  const flagged = (data.reminders || []).some((r) => r.agent === 'd1' && r.kind === 'idle')
  if (!flagged) pass('R5 recently active agent not idle-flagged')
  else fail('R5', 'd1 flagged idle')
}
// R6: pending count surfaced separately so the UI can prioritise it
{
  const data = await state()
  if (typeof data.pendingCount === 'number') pass('R6 pendingCount exposed')
  else fail('R6', JSON.stringify(data.pendingCount))
}
// R7: reminders carry no secret material or tokens
{
  const data = await state()
  const text = JSON.stringify(data.reminders || [])
  const leaky = /eyJ|password|token|secret_value|value"/i.test(text)
  if (!leaky) pass('R7 reminders carry no secret material')
  else fail('R7', text.slice(0, 120))
}
// R8: notification de-dup — repeated /api/state does not duplicate sends
{
  const before = (await stub.fetch('https://do/state').then((r) => r.json())).state.reminderSent || {}
  await state()
  await state()
  const after = (await stub.fetch('https://do/state').then((r) => r.json())).state.reminderSent || {}
  // With no notification channels configured nothing is "sent", but the keys
  // must not grow unboundedly on repeated polling.
  if (Object.keys(after).length === Object.keys(before).length) pass('R8 repeated polling does not grow the sent registry')
  else fail('R8', JSON.stringify({ before: Object.keys(before).length, after: Object.keys(after).length }))
}

// R9: a key that is about to expire is recorded under the same threshold it is
// looked up with. The two expressions drifted once and every poll re-sent the
// reminder, so this pins the written key shape.
{
  const live = (await stub.fetch('https://do/state').then((r) => r.json())).state
  await stub.fetch('https://do/state', {
    method: 'PUT',
    body: JSON.stringify({ ...live, secretExpiry: { 'kid-key': { expiresAt: Date.now() + 3 * DAY } } }),
  })
  await state()
  await state()
  const sent = (await stub.fetch('https://do/state').then((r) => r.json())).state.reminderSent || {}
  const keys = Object.keys(sent).filter((key) => key.indexOf('secret-expiring') !== -1)
  const correct = keys.filter((key) => key.endsWith('\u00003'))
  if (keys.length && correct.length === keys.length) pass('R9 key-expiry reminders are recorded under their day threshold')
  else fail('R9', JSON.stringify({ keys }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== reminders ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
