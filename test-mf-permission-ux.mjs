// The permission behaviours the operator asked for:
//   N1 a no-approval item is a real bypass: an Agent in scope reads it even
//      with no capability, no classification and no plaintext policy.
//   N2 that read is logged at warn level, so the console can show it red.
//   N3 an out-of-scope request is recorded as a denied attempt with a reason,
//      instead of vanishing — and it still refuses.
//   N4 the consent page does not open a plaintext policy unless asked, and the
//      requested window is honoured when it is.
//   N5 secret.use is a separate action: a read grant does not imply it, and its
//      target policy is what makes http_request possible.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 55).toString('base64')
const ACCT = 'vault@example.invalid'
const OPEN_ID = 'item-open'
const OPEN = 'open-key'
const SHUT_ID = 'item-shut'
const SHUT = 'shut-key'
const SECRET = 'sk-live-open-1'

const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'perm-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at TEXT, updated_at TEXT)`,
  `INSERT OR REPLACE INTO users (id,email,key,kdf_type,kdf_iterations,created_at) VALUES ('u1','vault@example.invalid','k',0,600000,'2024-01-01')`,
]) await db.exec(sql)
{
  const E = Buffer.alloc(32, 1), M = Buffer.alloc(32, 2)
  const mk = async (id, name, pw) => {
    const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr(pw, E, M), totp: '', uris: [] }, fields: [] }
    await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, 'u1', 1, null, await encryptStr(name, E, M), '', JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null).run()
  }
  await mk(OPEN_ID, OPEN, SECRET)
  await mk(SHUT_ID, SHUT, 'shut-value')
}
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const getState = async () => (await (await stub.fetch('https://do/state')).json()).state
const putState = (s) => stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(s) })

const hash = async (v) => Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))).toString('base64')
const TOKEN = 'perm-agent-token'
await putState({
  agents: { 'in-scope': { hash: await hash(TOKEN), allow: [OPEN], groups: [], allowAll: false, write: false, legacy: false, account: ACCT, createdAt: '2024-01-01' } },
  oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  policies: { [OPEN]: { noApproval: true } }, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  settings: { notifications: {}, vaultEmail: ACCT, requireClassification: true },
  capabilities: {}, actionGrants: {}, usePolicies: {}, deniedAttempts: {},
  itemIds: { [OPEN]: OPEN_ID, [SHUT]: SHUT_ID },
  // Deliberately NOT classified: no approval must still let it through.
  credentialKinds: {}, fillPolicies: {}, plaintextReadPolicies: {},
})
const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })
const mcp = async (name, args) => {
  const r = await mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  return JSON.stringify(await r.json().catch(() => ({})))
}

// N1: no-approval really bypasses: unclassified, no policy, no capability.
{
  const text = await mcp('get_secret', { name: OPEN })
  if (text.includes(SECRET)) pass('N1 a no-approval item is read even though it is unclassified with no policy')
  else fail('N1', text.slice(0, 240))
}

// N2: that read is logged at warn level so the console paints it red.
{
  const state = await getState()
  // The event name is now uniform ('secret.read') and the risk lives in fields,
  // so statistics cannot skip exactly the reads that skipped the checks.
  const entry = (state.audit || []).find((e) => e.event === 'secret.read' && e.noApproval === true)
  if (entry && entry.severity === 'warn' && entry.mode === 'no-approval') pass('N2 a no-approval read is logged as secret.read with warn severity')
  else fail('N2', JSON.stringify(entry))
}

// N3: an out-of-scope request is remembered with a reason, and still refused.
{
  const text = await mcp('get_secret', { name: SHUT })
  const state = await getState()
  const denied = Object.values(state.deniedAttempts || {}).find((d) => d.name === SHUT)
  const refused = !text.includes('shut-value')
  if (refused && denied && denied.reason && denied.action === 'secret.read') pass('N3 an out-of-scope read is recorded with a reason and still refused')
  else fail('N3', JSON.stringify({ refused, denied, text: text.slice(0, 160) }))
}

// N5: a read grant does not imply secret.use; without a use policy http_request
// is a hard deny, and the reason says so.
{
  const text = await mcp('http_request', { name: OPEN, url: 'https://httpbin.org/status/200' })
  const state = await getState()
  const denied = Object.values(state.deniedAttempts || {}).find((d) => d.action === 'secret.use')
  if (!text.includes('ok') && denied) pass('N5 http_request without a use policy is refused and recorded')
  else fail('N5', JSON.stringify({ text: text.slice(0, 200), denied }))
}

// N6-N9: an out-of-scope item can be requested, the list says so, repeats reuse
// the same request, and a muted agent gets no new request.
const toolPayload = (raw) => JSON.parse(JSON.parse(raw).result.content[0].text)
{
  const list = toolPayload(await mcp('list_secrets', {}))
  const item = list.find((entry) => entry.name === SHUT)
  if (item && item.requestable === true && item.grant_status === 'none') pass('N6a an out-of-scope item starts requestable')
  else fail('N6a', JSON.stringify(item))
}
{
  const first = toolPayload(await mcp('request_access', { name: SHUT }))
  const state = await getState()
  const entry = Object.values(state.pending || {}).find((e) => e.agent === 'in-scope' && e.name === SHUT)
  if (first.status === 'pending' && first.request_id && first.approval_url && entry) pass('N6 an item outside the allowlist can still be requested')
  else fail('N6', JSON.stringify({ first, entry }))
}
{
  const list = toolPayload(await mcp('list_secrets', {}))
  const item = list.find((entry) => entry.name === SHUT)
  if (item && item.requestable === false && item.grant_status === 'pending') pass('N7 the list marks an out-of-scope item already pending')
  else fail('N7', JSON.stringify(item))
}
{
  const first = toolPayload(await mcp('request_access', { name: SHUT }))
  const second = toolPayload(await mcp('request_access', { name: SHUT }))
  if (first.request_id && first.request_id === second.request_id) pass('N8 a repeated request is idempotent')
  else fail('N8', JSON.stringify({ first, second }))
}
{
  const state = await getState()
  state.agents['in-scope'].muted = true
  await putState(state)
  const request = toolPayload(await mcp('request_access', { name: SHUT }))
  const list = toolPayload(await mcp('list_secrets', {}))
  const item = list.find((entry) => entry.name === SHUT)
  if (request.status === 'muted' && item && item.grant_status === 'muted' && item.requestable === false) pass('N9 a muted agent gets no request and the list says muted')
  else fail('N9', JSON.stringify({ request, item }))
}

// N4: the consent page offers the plaintext opt-in unchecked, with a 24h default.
{
  const reg = await (await mf.dispatchFetch('https://broker.test/oauth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'probe', redirect_uris: ['http://127.0.0.1:9999/cb'] }),
  })).json()
  const login = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', body: JSON.stringify({ password: 'p' }) })
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
  const verifier = 'v'.repeat(64)
  const challenge = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))).toString('base64url')
  const res = await mf.dispatchFetch('https://broker.test/oauth/authorize?' + new URLSearchParams({
    client_id: reg.client_id, redirect_uri: 'http://127.0.0.1:9999/cb', response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'secrets.read',
  }).toString(), { headers: { cookie } })
  const html = await res.text()
  const unchecked = /name="grant_plaintext" value="1">/.test(html) || !/<input[^>]*name="grant_plaintext"[^>]*checked/.test(html)
  const hasHours = html.includes('name="grant_hours"') && html.includes('value="24" selected')
  if (res.status === 200 && unchecked && hasHours) pass('N4 plaintext is opt-in and defaults to 24 hours')
  else fail('N4', JSON.stringify({ status: res.status, unchecked, hasHours }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== permission behaviour ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
