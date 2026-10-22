// The plugin endpoints: usage is a read-only view of who is using which keys, and
// wait is a long poll so an approval can resume an agent without a timer.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const PLUGIN = 'plugin-token-value'
const KEK = Buffer.alloc(32, 151).toString('base64')
const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', DSH_PLUGIN_TOKEN: PLUGIN },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', DSH_PLUGIN_TOKEN: PLUGIN },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const now = new Date()
const audit = []
for (let i = 0; i < 5; i += 1) audit.push({ time: new Date(now - i * 60000).toISOString(), event: 'secret.read', agent: 'agent-a', name: 'key-a' })
for (let i = 0; i < 2; i += 1) audit.push({ time: new Date(now - i * 60000).toISOString(), event: 'secret.read', agent: 'agent-b', name: 'key-b' })
audit.push({ time: now.toISOString(), event: 'secret.read-deny', agent: 'agent-b', name: 'key-a', reason: 'unclassified-credential' })
// An old read that must fall outside a 1-hour window.
audit.push({ time: new Date(now - 5 * 3600e3).toISOString(), event: 'secret.read', agent: 'agent-c', name: 'key-a' })
await stub.fetch('https://do/state', {
  method: 'PUT', body: JSON.stringify({
    agents: {}, policies: {}, grants: {}, audit, itemIds: {}, legacyItemBindings: {}, pending: {},
    capabilities: {
      'agent-a\u0000item-a\u0000secret.read': { id: 'c1', subjectId: 'agent-a', accountId: 'x@example.invalid', itemId: 'item-a', itemName: 'key-a', action: 'secret.read', createdAt: now.toISOString(), expiresAt: null, maxUses: 10, usedCount: 3, revokedAt: null },
      'agent-b\u0000item-b\u0000secret.read': { id: 'c2', subjectId: 'agent-b', accountId: 'x@example.invalid', itemId: 'item-b', itemName: 'key-b', action: 'secret.read', createdAt: now.toISOString(), expiresAt: now.getTime() - 1000, maxUses: null, usedCount: 0, revokedAt: null },
    },
    settings: { notifications: {} }, profile: {},
    security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' },
  }),
})
const pluginGet = (path) => mf.dispatchFetch('https://broker.test' + path, { headers: { 'x-broker-plugin-token': PLUGIN } })

// U1: the plugin token is required.
{
  const anon = await mf.dispatchFetch('https://broker.test/api/plugin/usage')
  if (anon.status === 401) pass('U1 usage requires the plugin token')
  else fail('U1', String(anon.status))
}

// U2: usage reports reads per agent and per item in the window.
{
  const res = await pluginGet('/api/plugin/usage?hours=24')
  const body = await res.json()
  const a = (body.agents || []).find((x) => x.agent === 'agent-a')
  const b = (body.agents || []).find((x) => x.agent === 'agent-b')
  if (a?.reads === 5 && b?.reads === 2) pass('U2 usage counts reads per agent')
  else fail('U2', JSON.stringify(body.agents))
}

// U3: denials are reported separately, never counted as reads. The reads here
// are the 5 agent-a + 2 agent-b + 1 old agent-c entry, which is inside 24h.
{
  const body = await (await pluginGet('/api/plugin/usage?hours=24')).json()
  const b = (body.agents || []).find((x) => x.agent === 'agent-b')
  if (b?.denied === 1 && body.denied === 1 && body.reads === 8) pass('U3 denials are reported separately from reads')
  else fail('U3', JSON.stringify({ b, reads: body.reads, denied: body.denied }))
}

// U4: a read older than the window is excluded.
{
  const body = await (await pluginGet('/api/plugin/usage?hours=1')).json()
  const c = (body.agents || []).find((x) => x.agent === 'agent-c')
  if (!c) pass('U4 reads outside the window are excluded')
  else fail('U4', JSON.stringify(body.agents))
}

// U5: per-item totals are reported.
{
  const body = await (await pluginGet('/api/plugin/usage?hours=24')).json()
  const keyA = (body.items || []).find((x) => x.name === 'key-a')
  if (keyA && keyA.reads >= 5) pass('U5 usage counts reads per credential')
  else fail('U5', JSON.stringify(body.items))
}

// U6: only live capabilities are listed, with the uses left.
{
  const body = await (await pluginGet('/api/plugin/usage')).json()
  const live = (body.capabilities || []).find((c) => c.agent === 'agent-a')
  const expired = (body.capabilities || []).find((c) => c.agent === 'agent-b')
  if (live && live.usesLeft === 7 && !expired) pass('U6 only live capabilities are listed, with uses left')
  else fail('U6', JSON.stringify(body.capabilities))
}

// U7: usage never leaks a secret value, username or TOTP.
{
  const raw = JSON.stringify(await (await pluginGet('/api/plugin/usage')).json())
  const leaks = ['password', 'username', 'totp', 'value'].filter((k) => raw.includes('"' + k + '"'))
  if (leaks.length === 0) pass('U7 usage carries metadata only, no credential fields')
  else fail('U7', leaks.join(','))
}

// U8: wait returns immediately when the queue already differs from what the
// caller saw, instead of blocking for the full window.
{
  const st = await stub.fetch('https://do/state').then((r) => r.json()).then((p) => p.state)
  st.pending = { p1: { id: 'p1', agent: 'agent-a', name: 'key-a', action: 'secret.read', createdAt: now.toISOString() } }
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(st) })
  const started = Date.now()
  const body = await (await pluginGet('/api/plugin/wait?since=nothing&timeout=15000')).json()
  const elapsed = Date.now() - started
  if (body.count === 1 && body.changed === true && elapsed < 3000) pass('U8 wait returns at once when the queue already changed')
  else fail('U8', JSON.stringify({ count: body.count, changed: body.changed, elapsed }))
}

// U9: wait blocks while nothing changes, then returns when it does.
{
  const st = await stub.fetch('https://do/state').then((r) => r.json()).then((p) => p.state)
  st.pending = {}
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(st) })
  // The signature the caller last saw matches the current (empty) queue.
  const started = Date.now()
  const waiting = pluginGet('/api/plugin/wait?since=&timeout=8000').then(async (r) => ({ body: await r.json(), elapsed: Date.now() - started }))
  // Add a pending entry after ~2s; the poll should notice and return.
  await new Promise((r) => setTimeout(r, 2000))
  const st2 = await stub.fetch('https://do/state').then((r) => r.json()).then((p) => p.state)
  st2.pending = { p2: { id: 'p2', agent: 'agent-b', name: 'key-b', action: 'secret.read', createdAt: new Date().toISOString() } }
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(st2) })
  const { body, elapsed } = await waiting
  if (body.count === 1 && body.changed === true && elapsed < 8000) pass('U9 wait wakes when a request arrives')
  else fail('U9', JSON.stringify({ count: body.count, changed: body.changed, elapsed }))
}

// U10: wait requires the plugin token.
{
  const anon = await mf.dispatchFetch('https://broker.test/api/plugin/wait')
  if (anon.status === 401) pass('U10 wait requires the plugin token')
  else fail('U10', String(anon.status))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== plugin usage + wait ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
