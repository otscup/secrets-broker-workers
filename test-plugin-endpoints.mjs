// The plugin's operator-side endpoints: saving a key the operator typed,
// listing what they can pick from, and recent activity. All metadata only.
import { Miniflare } from 'miniflare'
// Run from the secrets-broker-workers checkout: npm run test:plugin-endpoints
// copies this file there. workerd will not load a scriptPath that walks out of
// its starting directory.
import { wrapWithKek, encryptStr } from './src/crypto.js'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const PLUGIN = 'plugin-token'
const KEK = Buffer.alloc(32, 137).toString('base64')
const ACCT = 'plugin@example.invalid'
const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2026-08-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', DSH_PLUGIN_TOKEN: PLUGIN },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', DSH_PLUGIN_TOKEN: PLUGIN },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'plugin-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
await db.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)')
await db.exec('CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)')
await db.exec('CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at TEXT, updated_at TEXT)')
await db.prepare('INSERT OR REPLACE INTO users (id,email,key,kdf_type,kdf_iterations,created_at) VALUES (?,?,?,?,?,?)').bind('u1', ACCT, 'k', 0, 600000, new Date().toISOString()).run()
const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
const seeded = { login: { username: await encryptStr('u', E, M), password: await encryptStr('seeded-value', E, M), totp: '', uris: [] }, fields: [] }
await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind('c1', 'u1', 1, null, await encryptStr('existing-key', E, M), '', JSON.stringify(seeded), null, 0, 0, new Date().toISOString(), new Date().toISOString(), null, null).run()

const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', {
  method: 'PUT', body: JSON.stringify({
    agents: {}, policies: {}, grants: {}, pending: {}, itemIds: {}, legacyItemBindings: {}, capabilities: {},
    audit: [
      { time: new Date().toISOString(), event: 'secret.read', agent: 'muse', name: 'existing-key' },
      { time: new Date().toISOString(), event: 'secret.read-deny', agent: 'codex', name: 'existing-key' },
      { time: new Date().toISOString(), event: 'admin.login', ip: '1.2.3.4' },
    ],
    settings: { vaultEmail: ACCT, notifications: {} }, profile: {},
    credentialRequests: { 'req-1': { id: 'req-1', agent: 'muse', name: 'cloudflare-token', description: 'needs a Cloudflare token', createdAt: new Date().toISOString() } },
    security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' },
  }),
})
const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.from(E).toString('base64'), symMacKey: Buffer.from(M).toString('base64'), expiresAt: 0 })
await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })

const call = (path, options = {}) => mf.dispatchFetch('https://broker.test' + path, {
  ...options, headers: { 'x-broker-plugin-token': PLUGIN, 'content-type': 'application/json', ...(options.headers || {}) },
})

// P1: the plugin token is required on every new endpoint.
{
  const paths = ['/api/plugin/items', '/api/plugin/activity']
  const open = []
  for (const path of paths) {
    const res = await mf.dispatchFetch('https://broker.test' + path)
    if (res.status !== 401) open.push(path + ':' + res.status)
  }
  const post = await mf.dispatchFetch('https://broker.test/api/plugin/items/save', { method: 'POST', body: '{}' })
  if (!open.length && post.status === 401) pass('P1 the new endpoints require the plugin token')
  else fail('P1', JSON.stringify({ open, post: post.status }))
}

// P2: the operator can store a key the plugin typed, and it decrypts.
{
  const res = await call('/api/plugin/items/save', { method: 'POST', body: JSON.stringify({ name: 'typed-in-plugin', value: 'typed-value-123', username: 'me', url: 'https://example.com' }) })
  const body = await res.json()
  const items = await (await call('/api/plugin/items')).json()
  const listed = (items.items || []).some((item) => item.name === 'typed-in-plugin')
  if (res.ok && body.created === true && listed) pass('P2 a key typed in the plugin is stored and listed')
  else fail('P2', JSON.stringify({ status: res.status, body, listed }))
}

// P3: saving an existing name updates it instead of failing.
{
  const res = await call('/api/plugin/items/save', { method: 'POST', body: JSON.stringify({ name: 'typed-in-plugin', value: 'replaced-value' }) })
  const body = await res.json()
  if (res.ok && body.updated === true) pass('P3 saving an existing name updates it')
  else fail('P3', JSON.stringify({ status: res.status, body }))
}

// P4: the item list never carries a value.
{
  const raw = await (await call('/api/plugin/items')).text()
  if (!raw.includes('typed-value-123') && !raw.includes('seeded-value')) pass('P4 the plugin item list carries no credential value')
  else fail('P4', 'a value leaked')
}

// P5: an empty value is refused, so a misclick cannot blank a credential.
{
  const res = await call('/api/plugin/items/save', { method: 'POST', body: JSON.stringify({ name: 'no-value' }) })
  if (res.status === 400) pass('P5 saving without a value is refused')
  else fail('P5', String(res.status))
}

// P6: activity reports reads, denials and writes, and hides login noise.
{
  const body = await (await call('/api/plugin/activity?limit=20')).json()
  const events = (body.activity || []).map((entry) => entry.event)
  const hasRead = events.includes('secret.read')
  const hasDeny = events.includes('secret.read-deny')
  const noLogin = !events.includes('admin.login')
  const ordered = events.length > 1
  if (hasRead && hasDeny && noLogin && ordered) pass('P6 activity shows reads and denials, without login noise')
  else fail('P6', JSON.stringify(events))
}

// P7: activity marks a denial as not ok, so the UI can colour it.
{
  const body = await (await call('/api/plugin/activity?limit=20')).json()
  const deny = (body.activity || []).find((entry) => entry.event === 'secret.read-deny')
  const ok = deny && deny.ok === false
  if (ok) pass('P7 a denied event is marked as not ok')
  else fail('P7', JSON.stringify(deny))
}

// P8: a locked vault refuses to save rather than writing half an item.
{
  await stub.fetch('https://do/session', { method: 'DELETE' })
  const res = await call('/api/plugin/items/save', { method: 'POST', body: JSON.stringify({ name: 'while-locked', value: 'x' }) })
  if (res.status === 423) pass('P8 a locked vault refuses a plugin save')
  else fail('P8', String(res.status))
}

// P9: a key stored by mistake can be deleted from the plugin.
{
  // Unlock again: P8 deleted the session.
  const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.from(E).toString('base64'), symMacKey: Buffer.from(M).toString('base64'), expiresAt: 0 })
  await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })
  const res = await call('/api/plugin/items/delete', { method: 'POST', body: JSON.stringify({ name: 'typed-in-plugin' }) })
  const body = await res.json().catch(() => ({}))
  const items = await (await call('/api/plugin/items')).json()
  const still = (items.items || []).some((item) => item.name === 'typed-in-plugin')
  if (res.ok && body.ok === true && !still) pass('P9 a key stored by mistake can be deleted')
  else fail('P9', JSON.stringify({ status: res.status, body, still }))
}

// P10: deleting something that is not there is a clear 404.
{
  const res = await call('/api/plugin/items/delete', { method: 'POST', body: JSON.stringify({ name: 'never-existed' }) })
  if (res.status === 404) pass('P10 deleting a missing item reports not-found')
  else fail('P10', String(res.status))
}

// P11: the operator can decline a key request from the plugin, so a prompt for
// a key they will never enter stops appearing. There is no other way out of it.
{
  const listBefore = await (await call('/api/plugin/credential-requests')).json()
  const had = (listBefore.requests || []).some((entry) => entry.id === 'req-1')
  const res = await call('/api/plugin/credential-requests/cancel', { method: 'POST', body: JSON.stringify({ id: 'req-1' }) })
  const body = await res.json().catch(() => ({}))
  const listAfter = await (await call('/api/plugin/credential-requests')).json()
  const gone = !(listAfter.requests || []).some((entry) => entry.id === 'req-1')
  if (had && res.ok && body.ok === true && gone) pass('P11 a key request can be cancelled from the plugin')
  else fail('P11', JSON.stringify({ had, status: res.status, body, gone }))
}

// P12: cancelling needs an id, and needs the plugin token.
{
  const noId = await call('/api/plugin/credential-requests/cancel', { method: 'POST', body: '{}' })
  const noToken = await mf.dispatchFetch('https://broker.test/api/plugin/credential-requests/cancel', { method: 'POST', body: JSON.stringify({ id: 'req-1' }) })
  if (noId.status === 400 && noToken.status === 401) pass('P12 cancel requires an id and the plugin token')
  else fail('P12', JSON.stringify({ noId: noId.status, noToken: noToken.status }))
}

// P13: a cancelled request leaves an audit entry, so the activity tab shows it.
{
  const body = await (await call('/api/plugin/activity?limit=20')).json()
  const cancelled = (body.activity || []).find((entry) => entry.event === 'credential.cancel')
  if (cancelled) pass('P13 cancelling is recorded in the activity feed')
  else fail('P13', JSON.stringify((body.activity || []).map((e) => e.event)))
}

// P14: a key typed in the plugin arrives already classified, so it does not
// show as 未分类 the moment it is saved. Without this the plugin's category
// picker is decorative: the route accepted `kind` and dropped it.
{
  const res = await call('/api/plugin/items/save', { method: 'POST', body: JSON.stringify({ name: 'typed-web-key', value: 'web-value', kind: 'web', origins: ['https://example.com'] }) })
  const body = await res.json().catch(() => ({}))
  const state = await (await stub.fetch('https://do/state')).json()
  const kinds = state.state.credentialKinds || {}
  const policies = state.state.fillPolicies || {}
  const applied = Object.values(kinds).includes('web')
  const withOrigin = Object.values(policies).some((p) => (p.origins || []).includes('https://example.com'))
  if (res.ok && body.kindApplied === true && applied && withOrigin) pass('P14 a key saved from the plugin is classified immediately')
  else fail('P14', JSON.stringify({ status: res.status, body, applied, withOrigin }))
}

// P15: a web credential without an origin is refused, not saved unclassified.
{
  const res = await call('/api/plugin/items/save', { method: 'POST', body: JSON.stringify({ name: 'typed-web-bad', value: 'v', kind: 'web' }) })
  if (res.status === 400) pass('P15 a website login saved without an origin is refused')
  else fail('P15', String(res.status))
}

// P16: an invented kind is refused, so a typo cannot silently unclassify.
{
  const res = await call('/api/plugin/items/save', { method: 'POST', body: JSON.stringify({ name: 'typed-bad-kind', value: 'v', kind: 'banana' }) })
  if (res.status === 400) pass('P16 an unknown category is refused')
  else fail('P16', String(res.status))
}

// P17: saving without a category still works, and reports that none was applied.
{
  const res = await call('/api/plugin/items/save', { method: 'POST', body: JSON.stringify({ name: 'typed-no-kind', value: 'v' }) })
  const body = await res.json().catch(() => ({}))
  if (res.ok && body.kindApplied === false) pass('P17 a key can still be saved without a category')
  else fail('P17', JSON.stringify({ status: res.status, body }))
}

// P18: the classification made from the plugin shows up in the policy list
// under the credential's own name, which is what the console reads.
{
  const state = await (await stub.fetch('https://do/state')).json()
  const ids = state.state.itemIds || {}
  const id = ids['typed-web-key']
  const kinds = state.state.credentialKinds || {}
  if (id && kinds[id] === 'web') pass('P18 the plugin-saved credential is addressable by name')
  else fail('P18', JSON.stringify({ id, kinds }))
}

// P19: deleting a credential clears its classification too, so a name reused
// later does not inherit the old kind and the console shows no ghost row.
{
  const stateBefore = await (await stub.fetch('https://do/state')).json()
  const id = (stateBefore.state.itemIds || {})['typed-web-key']
  const had = Boolean((stateBefore.state.credentialKinds || {})[id])
  const res = await call('/api/plugin/items/delete', { method: 'POST', body: JSON.stringify({ name: 'typed-web-key' }) })
  const stateAfter = await (await stub.fetch('https://do/state')).json()
  const kindGone = !(stateAfter.state.credentialKinds || {})[id]
  const policyGone = !(stateAfter.state.fillPolicies || {})[id]
  const mappingGone = !(stateAfter.state.itemIds || {})['typed-web-key']
  if (had && res.ok && kindGone && policyGone && mappingGone) pass('P19 deleting a credential clears its classification')
  else fail('P19', JSON.stringify({ had, status: res.status, kindGone, policyGone, mappingGone }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== plugin operator endpoints ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
