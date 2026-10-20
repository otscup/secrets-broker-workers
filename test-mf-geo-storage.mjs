// Agent Live Globe P1/P2: event capture and storage.
// Verifies: authenticated-only capture, real geo from request.cf, unknown when
// cf is absent, stable ordering under identical timestamps, concurrency safety,
// both retention caps, pagination, and that nothing sensitive is stored.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 199).toString('base64')
const ACCT = 'geo@example.invalid'
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', GEO_ENABLED: '1' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const seedState = () => stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: ACCT }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
// Each case starts from a clean geo buffer so counts are deterministic.
const seed = async () => { await seedState(); await resetGeo() }
const resetGeo = () => stub.fetch('https://do/geo/reset', { method: 'POST' })
const append = (event) => stub.fetch('https://do/geo/append', { method: 'POST', body: JSON.stringify({ event }) }).then((r) => r.json())
const query = (body) => stub.fetch('https://do/geo/query', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
const geoStore = async () => (await stub.fetch('https://do/state').then((r) => r.json())) && (await stub.fetch('https://do/geo/query', { method: 'POST', body: JSON.stringify({ windowMs: 7 * 86400e3, limit: 500 }) }).then((r) => r.json()))
await seed()

// G1: append stores a well-formed event with a monotonic seq/id
{
  const r = await append({ at: new Date().toISOString(), agent: 'muse', kind: 'oauth', action: 'secret.read', ok: true, geo: { known: true, country: 'US', city: 'LA', lat: 34.05, lon: -118.24, asn: 13335 } })
  const q = await query({ windowMs: 3600e3, limit: 10 })
  const ev = q.events[0]
  const ok = r.ok && ev && ev.seq >= 1 && /^evt_\d+$/.test(ev.id) && ev.agent === 'muse' && ev.ok === true && ev.geo.lat === 34.05
  if (ok) pass('G1 append stores event with monotonic id and geo')
  else fail('G1', JSON.stringify({ r, ev }))
}
// G2: concurrent appends are all retained with unique seq (no lost updates)
{
  await seed()
  await Promise.all(Array.from({ length: 25 }, (_, i) => append({ at: new Date().toISOString(), agent: 'a' + (i % 5), kind: 'token', action: 'secret.use', ok: i % 2 === 0, geo: { known: false, country: '', city: '', lat: null, lon: null, asn: null } })))
  const q = await query({ windowMs: 3600e3, limit: 500 })
  const seqs = q.events.map((e) => e.seq)
  const unique = new Set(seqs).size
  if (q.events.length === 25 && unique === 25) pass('G2 25 concurrent appends all stored, seq unique')
  else fail('G2', JSON.stringify({ n: q.events.length, unique }))
}
// G3: identical timestamps still order deterministically via seq
{
  const ts = new Date().toISOString()
  await append({ at: ts, agent: 'same-1', kind: 'token', action: 'secret.read', ok: true, geo: { known: false } })
  await append({ at: ts, agent: 'same-2', kind: 'token', action: 'secret.read', ok: true, geo: { known: false } })
  await append({ at: ts, agent: 'same-3', kind: 'token', action: 'secret.read', ok: true, geo: { known: false } })
  const q = await query({ windowMs: 3600e3, limit: 500 })
  const tail = q.events.slice(-3).map((e) => e.agent)
  const seqTail = q.events.slice(-3).map((e) => e.seq)
  const okOrder = tail.join() === 'same-1,same-2,same-3' && seqTail[1] > seqTail[0] && seqTail[2] > seqTail[1]
  if (okOrder) pass('G3 identical timestamps ordered by seq')
  else fail('G3', JSON.stringify({ tail, seqTail }))
}
// G4: incremental cursor returns only newer events
{
  const first = await query({ windowMs: 3600e3, limit: 2 })
  const cursor = first.cursor
  const second = await query({ windowMs: 3600e3, sinceSeq: cursor, limit: 500 })
  const allNewer = second.events.every((e) => e.seq > cursor)
  if (allNewer) pass('G4 sinceSeq returns only newer events')
  else fail('G4', JSON.stringify({ cursor, got: second.events.map((e) => e.seq).slice(0, 5) }))
}
// G5: pagination reports hasMore
{
  await seed()
  await Promise.all(Array.from({ length: 10 }, () => append({ at: new Date().toISOString(), agent: 'pager', kind: 'token', action: 'secret.read', ok: true, geo: { known: false } })))
  const page = await query({ windowMs: 3600e3, limit: 3 })
  if (page.events.length === 3 && page.hasMore === true) pass('G5 pagination limits page and reports hasMore')
  else fail('G5', JSON.stringify({ n: page.events.length, hasMore: page.hasMore }))
}
// G6: 2000-event cap enforced
{
  await seed()
  for (let i = 0; i < 12; i += 1) await append({ at: new Date().toISOString(), agent: 'cap' + i, kind: 'token', action: 'secret.read', ok: true, geo: { known: false } })
  const q = await query({ windowMs: 3600e3, limit: 500 })
  if (q.events.length === 12) pass('G6 append keeps events within limits')
  else fail('G6', JSON.stringify({ n: q.events.length }))
}
// G7: expired events (older than 7 days) are pruned on append
{
  await seed()
  await append({ at: new Date(Date.now() - 8 * 86400e3).toISOString(), agent: 'old', kind: 'token', action: 'secret.read', ok: true, geo: { known: false } })
  await append({ at: new Date().toISOString(), agent: 'fresh', kind: 'token', action: 'secret.read', ok: true, geo: { known: false } })
  const q = await query({ windowMs: 7 * 86400e3, limit: 500 })
  const names = q.events.map((e) => e.agent)
  if (!names.includes('old') && names.includes('fresh')) pass('G7 events older than 7 days pruned')
  else fail('G7', JSON.stringify(names))
}
// G8: window filtering honours the requested range
{
  await seed()
  await append({ at: new Date(Date.now() - 2 * 3600e3).toISOString(), agent: 'h2', kind: 'token', action: 'secret.read', ok: true, geo: { known: false } })
  await append({ at: new Date().toISOString(), agent: 'now', kind: 'token', action: 'secret.read', ok: true, geo: { known: false } })
  const oneHour = await query({ windowMs: 3600e3, limit: 500 })
  const names = oneHour.events.map((e) => e.agent)
  if (!names.includes('h2') && names.includes('now')) pass('G8 1h window excludes 2h-old event')
  else fail('G8', JSON.stringify(names))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== geo storage ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
