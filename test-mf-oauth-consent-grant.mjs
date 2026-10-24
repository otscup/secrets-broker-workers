// The operator-facing flows this round fixed:
//   O1 an OAuth Agent connected through the consent page can read what was
//      ticked there, instead of being told "not allowed to read this item" and
//      being sent back to the console for a second round of clicking.
//   O2 the consent page offers real item and group names as checkboxes.
//   O3 a web credential still cannot gain a plaintext read policy, even when it
//      is ticked on the consent page — the fill-only rule must not weaken.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 93).toString('base64')
const ACCT = 'vault@example.invalid'
const API_ID = 'item-api'
const WEB_ID = 'item-web'
const API = 'my-api-key'
const WEB = 'my-site-login'
const SECRET_VALUE = 'sk-live-abc123'

const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p', MCP_ALLOW_READ: '1' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'oauth-grant-db' },
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
  await mk(API_ID, API, SECRET_VALUE)
  await mk(WEB_ID, WEB, 'site-password')
}
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({
  agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  settings: { notifications: {}, vaultEmail: ACCT, requireClassification: true },
  capabilities: {}, actionGrants: {}, usePolicies: {},
  itemIds: { [API]: API_ID, [WEB]: WEB_ID },
  credentialKinds: { [API_ID]: 'api', [WEB_ID]: 'web' }, fillPolicies: {}, plaintextReadPolicies: {},
}) })
const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })

const login = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', body: JSON.stringify({ password: 'p' }) })
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
if (!cookie) { console.log('FAIL no admin cookie'); process.exit(1) }

// The consent form redirects to the client's own callback, which does not exist
// here. A redirect-following fetch would chase it and fail, so read Location.
const noRedirectFetch = (url, init = {}) => mf.dispatchFetch(url, { ...init, redirect: 'manual' })

// Register an OAuth client the way an MCP client would.
const reg = await (await mf.dispatchFetch('https://broker.test/oauth/register', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_name: 'test-mcp', redirect_uris: ['http://127.0.0.1:9999/cb'] }),
})).json()
const clientId = reg.client_id
const verifier = 'v'.repeat(64)
const challenge = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))).toString('base64url')

const authorizeGet = () => mf.dispatchFetch('https://broker.test/oauth/authorize?' + new URLSearchParams({
  client_id: clientId, redirect_uri: 'http://127.0.0.1:9999/cb', response_type: 'code',
  code_challenge: challenge, code_challenge_method: 'S256', scope: 'secrets.read', state: 'xyz',
}).toString(), { headers: { cookie } })

// O2: the consent page lists real names as checkboxes.
{
  const res = await authorizeGet()
  const html = await res.text()
  const hasApi = html.includes('value="' + API + '"')
  const hasWeb = html.includes('value="' + WEB + '"')
  const isCheckbox = html.includes('type="checkbox" name="grant_items"')
  const noValues = !html.includes(SECRET_VALUE)
  if (hasApi && hasWeb && isCheckbox && noValues) pass('O2 the consent page offers item names as checkboxes and leaks no value')
  else fail('O2', JSON.stringify({ hasApi, hasWeb, isCheckbox, noValues }))
}

// Drive the consent form: tick only the api credential. redirect:'manual' stops
// undici chasing the client's callback, which does not exist here.
const allowWith = (extra) => mf.dispatchFetch('https://broker.test/oauth/authorize', {
  method: 'POST', redirect: 'manual',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId, redirect_uri: 'http://127.0.0.1:9999/cb', state: 'xyz',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'secrets.read',
    decision: 'allow', ...extra,
  }).toString(),
})
const exchange = async (location) => {
  const code = new URL(location).searchParams.get('code') || ''
  return (await mf.dispatchFetch('https://broker.test/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: 'http://127.0.0.1:9999/cb', code_verifier: verifier }).toString(),
  })).json().catch(() => ({}))
}

// O1: after allowing on the consent page, get_secret works immediately when the
// plaintext opt-in was ticked. Plaintext is deliberately NOT granted by scope
// alone, so this asks for it explicitly.
{
  const res = await allowWith({ grant_items: API, grant_plaintext: '1', grant_hours: '24' })
  const location = res.headers.get('location') || ''
  const tokenBody = await exchange(location)
  const token = tokenBody.access_token
  const mcp = async (name, args) => {
    const r = await mf.dispatchFetch('https://broker.test/mcp', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })
    return JSON.stringify(await r.json().catch(() => ({})))
  }
  const text = token ? await mcp('get_secret', { name: API }) : ''
  const readable = text.includes(SECRET_VALUE)
  if (token && readable) pass('O1 an OAuth Agent can read the item ticked on the consent page, first try')
  else fail('O1', JSON.stringify({ hasToken: Boolean(token), text: text.slice(0, 240) }))
}

// O1b: ticking scope WITHOUT the plaintext opt-in grants the ability to ask but
// not to read, which is the safer default the operator asked for. The state is
// reset first: O1 already wrote a policy for this agent and item.
{
  const reset = (await (await stub.fetch('https://do/state')).json()).state
  reset.oauthCodes = {}; reset.oauthTokens = {}; reset.oauthAgentProfiles = {}
  reset.plaintextReadPolicies = {}; reset.capabilities = {}
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(reset) })
  const res = await allowWith({ grant_items: API })
  const tokenBody = await exchange(res.headers.get('location') || '')
  const token = tokenBody.access_token
  const r = await mf.dispatchFetch('https://broker.test/mcp', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_secret', arguments: { name: API } } }),
  })
  const text = JSON.stringify(await r.json().catch(() => ({})))
  const state = (await (await stub.fetch('https://do/state')).json()).state
  const policy = (state.plaintextReadPolicies || {})[API_ID]
  if (text.includes(SECRET_VALUE) && !policy) pass('O1b a consent grant reads without writing a plaintext policy')
  else fail('O1b', JSON.stringify({ leaked: text.includes(SECRET_VALUE), policy }))
}

// O3: ticking a web credential grants no plaintext read policy for it.
{
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({
    ...(await (await stub.fetch('https://do/state')).json()).state,
    oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
    credentialKinds: { [API_ID]: 'api', [WEB_ID]: 'web' }, plaintextReadPolicies: {},
  }) })
  const res = await allowWith({ grant_items: WEB })
  await exchange(res.headers.get('location') || '')
  const state = (await (await stub.fetch('https://do/state')).json()).state
  const policy = (state.plaintextReadPolicies || {})[WEB_ID]
  if (!policy) pass('O3 ticking a web credential grants no plaintext read policy')
  else fail('O3', JSON.stringify(policy))
}

// ── O4-O7 the consent POST refuses a cross-site submission ───────────────
// The admin cookie is SameSite=None so the consent form works from a
// third-party page, which means any site the operator visits can POST this
// endpoint with their cookie attached. The property that matters is not the
// status code: it is that no authorization code is minted, because that code is
// the only thing that becomes a token.
const codesBefore = async () => Object.keys(((await (await stub.fetch('https://do/state')).json()).state || {}).oauthCodes || {}).length
const consentPost = (headers) => mf.dispatchFetch('https://broker.test/oauth/authorize', {
  method: 'POST', redirect: 'manual',
  headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams({
    client_id: clientId, redirect_uri: 'http://127.0.0.1:9999/cb', state: 'xyz',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'secrets.read',
    decision: 'allow', grant_items: API,
  }).toString(),
})
const mintedACode = (res) => Boolean(new URL(res.headers.get('location') || 'http://x/').searchParams.get('code'))

// O4: an origin from another site is refused and mints nothing.
{
  const before = await codesBefore()
  const res = await consentPost({ origin: 'https://evil.example' })
  const after = await codesBefore()
  if (res.status === 403 && !mintedACode(res) && after === before) pass('O4 a foreign Origin is refused and mints no code')
  else fail('O4', JSON.stringify({ status: res.status, minted: mintedACode(res), before, after }))
}

// O5: the browser's own cross-site verdict is enough on its own, with no Origin.
{
  const before = await codesBefore()
  const res = await consentPost({ 'sec-fetch-site': 'cross-site' })
  const after = await codesBefore()
  if (res.status === 403 && !mintedACode(res) && after === before) pass('O5 Sec-Fetch-Site: cross-site is refused with no Origin header')
  else fail('O5', JSON.stringify({ status: res.status, minted: mintedACode(res), before, after }))
}

// O6: a null Origin is only trusted together with the browser's same-origin
// verdict. With no verdict at all the request is refused. This is the case that
// discriminates the fallback: trusting a bare "Origin: null" would approve here,
// and a bare null origin is what an attacker-supplied request looks like.
{
  const before = await codesBefore()
  const res = await consentPost({ origin: 'null' })
  const after = await codesBefore()
  if (res.status === 403 && !mintedACode(res) && after === before) pass('O6 a null Origin with no Sec-Fetch-Site verdict is refused')
  else fail('O6', JSON.stringify({ status: res.status, minted: mintedACode(res), before, after }))
}

// O7: the legitimate path still works — the consent page opens in a sandboxed
// frame or an automated browser, sends "Origin: null" with a same-origin
// verdict, and must be able to approve.
{
  const res = await consentPost({ origin: 'null', 'sec-fetch-site': 'same-origin' })
  if (mintedACode(res)) pass('O7 Origin: null with a same-origin verdict still approves')
  else fail('O7', JSON.stringify({ status: res.status, location: res.headers.get('location') || '' }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== oauth consent grants ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
