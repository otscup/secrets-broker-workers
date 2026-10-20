// Miniflare-backed maxReads concurrency test.
//
// Runs the REAL BrokerState Durable Object inside workerd with real SQLite
// storage. Seeds the DO state with a grant that has maxReads=1, then fires N
// concurrent /grant/consume calls with no coordination. Exactly one must win;
// the rest must be rejected as "exhausted" and the grant must be gone.
//
// This is the semantic the previous serialized harness could not prove: a
// Worker-level read-check-write would let several callers observe reads=0.
import { Miniflare } from 'miniflare'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  durableObjects: { BROKER_STATE: 'BrokerState' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})

const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('maxreads'))
const putState = (state) => stub.fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
const getState = () => stub.fetch('https://state/state').then((r) => r.json()).then((p) => p.state)
const consume = (agent, name) => stub.fetch('https://state/grant/consume', { method: 'POST', body: JSON.stringify({ agent, name }) }).then((r) => r.json())

const KEY = (agent, name) => `${agent}\u0000${name}`
function seed({ agent, name, maxReads, reads = 0, expiresAt = 0, revokedAt = null }) {
  return {
    agents: {}, policies: {}, pending: {}, audit: [], settings: { notifications: {} },
    grants: { [KEY(agent, name)]: { agent, name, mode: 'share', createdAt: new Date().toISOString(), expiresAt, reads, maxReads, revokedAt } },
  }
}

// MR-T1: maxReads=1, 20 concurrent calls -> exactly 1 ok, the rest refused,
// and the grant is gone. Remaining calls may see "no-grant" (the winning
// consume already deleted it) or "exhausted" - both are refusals.
{
  await putState(seed({ agent: 'A', name: 'item-1', maxReads: 1 }))
  const out = await Promise.all(Array.from({ length: 20 }, () => consume('A', 'item-1')))
  const ok = out.filter((r) => r.ok).length
  const refused = out.filter((r) => !r.ok).length
  const reasons = [...new Set(out.filter((r) => !r.ok).map((r) => r.reason))].sort()
  const allowedReasons = reasons.every((reason) => reason === 'exhausted' || reason === 'no-grant')
  const final = await getState()
  const gone = !final.grants[KEY('A', 'item-1')]
  if (ok === 1 && refused === 19 && allowedReasons && gone) pass('MR-T1 20-way concurrent maxReads=1: 1 ok, 19 refused, grant removed')
  else fail('MR-T1', `ok=${ok} refused=${refused} reasons=${reasons.join(',')} gone=${gone}`)
}

// MR-T2: maxReads=3, 20 concurrent -> exactly 3 ok, 17 exhausted, reads never > 3.
{
  await putState(seed({ agent: 'B', name: 'item-2', maxReads: 3 }))
  const out = await Promise.all(Array.from({ length: 20 }, () => consume('B', 'item-2')))
  const ok = out.filter((r) => r.ok).length
  const oks = out.filter((r) => r.ok).map((r) => r.reads).sort((a, b) => a - b)
  const final = await getState()
  const grant = final.grants[KEY('B', 'item-2')]
  if (ok === 3 && oks.join() === '1,2,3' && !grant) pass('MR-T2 20-way concurrent maxReads=3: exactly 3 ok, reads 1,2,3, grant removed')
  else fail('MR-T2', `ok=${ok} reads=${oks.join(',')} grant=${JSON.stringify(grant)}`)
}

// MR-T3: unlimited reads -> all 20 ok, counter is exactly 20 (no lost updates).
{
  await putState(seed({ agent: 'C', name: 'item-3', maxReads: null }))
  const out = await Promise.all(Array.from({ length: 20 }, () => consume('C', 'item-3')))
  const ok = out.filter((r) => r.ok).length
  const final = await getState()
  const reads = final.grants[KEY('C', 'item-3')]?.reads
  if (ok === 20 && reads === 20) pass('MR-T3 20 concurrent unlimited reads: 20 ok, reads=20 (no lost updates)')
  else fail('MR-T3', `ok=${ok} reads=${reads}`)
}

// MR-T4: revoked / expired grants are refused even inside the atomic endpoint.
{
  await putState(seed({ agent: 'D', name: 'revoked', maxReads: null, revokedAt: new Date().toISOString() }))
  const r1 = await consume('D', 'revoked')
  await putState(seed({ agent: 'D', name: 'expired', maxReads: null, expiresAt: Date.now() - 1000 }))
  const r2 = await consume('D', 'expired')
  if (!r1.ok && r1.reason === 'no-grant' && !r2.ok && r2.reason === 'expired') pass('MR-T4 revoked/expired refused atomically')
  else fail('MR-T4', JSON.stringify([r1, r2]))
}

// MR-T5: agent/item key separation - a grant for A/item cannot be consumed by B/item.
{
  await putState(seed({ agent: 'A', name: 'shared-name', maxReads: null }))
  const r = await consume('B', 'shared-name')
  const final = await getState()
  const aReads = final.grants[KEY('A', 'shared-name')]?.reads
  if (!r.ok && r.reason === 'no-grant' && aReads === 0) pass('MR-T5 grant key is agent+item scoped; B cannot consume A grant')
  else fail('MR-T5', JSON.stringify({ r, aReads }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== maxReads ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
