// Three bugs from one report:
//   L1 switching accounts used to pin the login page to that account, locking the
//      operator out of their own broker. Every account must be offered.
//   L2 a model provider was chosen for the operator. There is one provider now — an
//      OpenAI-compatible endpoint — so the assistant must name the field it is
//      missing instead of silently falling back to a binding.
//   L3 Telegram text messages were dropped because the webhook subscribed to
//      callback_query only.
import { Miniflare } from 'miniflare'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 12).toString('base64')
const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'login-db' },
})
const db = await mf.getD1Database('NODEWARDEN_DB')
for (const sql of [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT)`,
  `INSERT OR REPLACE INTO users (id,email,key,kdf_type,kdf_iterations,created_at) VALUES ('u1','first@example.invalid','k',0,600000,'2024-01-01')`,
  `INSERT OR REPLACE INTO users (id,email,key,kdf_type,kdf_iterations,created_at) VALUES ('u2','second@example.invalid','k',0,600000,'2024-02-01')`,
]) await db.exec(sql)
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
// The state a stuck operator is in: settings say the second account.
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({
  agents: {}, policies: {}, grants: {}, pending: {}, audit: [], itemGroups: {}, security: {},
  oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  capabilities: {}, actionGrants: {}, usePolicies: {}, deniedAttempts: {},
  itemIds: {}, credentialKinds: {}, fillPolicies: {}, plaintextReadPolicies: {},
  settings: { notifications: {}, vaultEmail: 'second@example.invalid' },
}) })

// L1a: the login page must NOT reveal which accounts exist. It is the only
// unauthenticated page, so a picker here would publish the operator's vault
// addresses to anyone who can reach the URL. (An earlier fix did add one; this
// asserts it is gone.)
{
  const res = await mf.dispatchFetch('https://broker.test/login')
  const html = await res.text()
  const leaksFirst = html.includes('first@example.invalid')
  const leaksSecond = html.includes('second@example.invalid')
  const hasSelect = html.includes('id="account"')
  const hasPassword = html.includes('id="password"')
  if (res.status === 200 && !leaksFirst && !leaksSecond && !hasSelect && hasPassword) pass('L1 the login page reveals no account addresses and keeps the password form')
  else fail('L1', JSON.stringify({ status: res.status, leaksFirst, leaksSecond, hasSelect, hasPassword }))
}

// L1b: logging in as the other account moves the preference, and is accepted.
{
  const res = await mf.dispatchFetch('https://broker.test/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'p', account: 'first@example.invalid' }),
  })
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0]
  const state = (await (await stub.fetch('https://do/state')).json()).state
  if (res.status === 200 && cookie && state.settings.vaultEmail === 'first@example.invalid') pass('L1b logging in as another account accepts it and updates the preference')
  else fail('L1b', JSON.stringify({ status: res.status, email: state.settings.vaultEmail }))
}

// L1c: an unknown account is refused rather than silently kept.
{
  const res = await mf.dispatchFetch('https://broker.test/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'p', account: 'nobody@example.invalid' }),
  })
  const state = (await (await stub.fetch('https://do/state')).json()).state
  if (res.status === 400 && state.settings.vaultEmail === 'first@example.invalid') pass('L1c an unknown account is refused, and the stored one is unchanged')
  else fail('L1c', JSON.stringify({ status: res.status, email: state.settings.vaultEmail }))
}

await mf.dispose()

// L2: there is no built-in provider to fall back to, so a half-filled form names
// the missing field instead of failing a call to a binding that is not there.
{
  const { askAi } = await import('./src/ai.js')
  const none = await askAi({}, { ai: {} }, { question: 'hi', snapshot: {} })
  const noKey = await askAi({}, { ai: { endpoint: 'https://x.invalid/v1', model: 'm' } }, { question: 'hi', snapshot: {} })
  const noModel = await askAi({}, { ai: { endpoint: 'https://x.invalid/v1', apiKey: 'k' } }, { question: 'hi', snapshot: {} })
  const namesField = (out) => out.ok === false && /endpoint|key|model/.test(out.reason)
  if (namesField(none) && namesField(noKey) && namesField(noModel)) pass('L2 the assistant names the missing provider field')
  else fail('L2', JSON.stringify({ none, noKey, noModel }).slice(0, 300))
}

// L2b: a provider refusal is explained, and an empty reply names what arrived,
// instead of surfacing a bare status or a shrug.
{
  const { askAi } = await import('./src/ai.js')
  const realFetch = globalThis.fetch
  const stub = (body, ok = true) => { globalThis.fetch = async () => ({ ok, json: async () => body }) }
  try {
    stub({ error: { message: 'model not available on your plan' } }, false)
    const refused = await askAi({}, { ai: { endpoint: 'https://x.invalid/v1', apiKey: 'k', model: 'm' } }, { question: 'hi', snapshot: {} })
    stub({ choices: [{ message: { content: '' }, finish_reason: 'length' }] })
    const empty = await askAi({}, { ai: { endpoint: 'https://x.invalid/v1', apiKey: 'k', model: 'm' } }, { question: 'hi', snapshot: {} })
    const explained = refused.ok === false && refused.reason.includes('model not available on your plan')
    const namesShape = empty.ok === false && empty.reason.includes('finish_reason=length')
    if (explained && namesShape) pass('L2b a provider refusal is explained, and an empty reply names what arrived')
    else fail('L2b', JSON.stringify({ refused, empty }).slice(0, 300))
  } finally { globalThis.fetch = realFetch }
}

// L3: the webhook subscribes to message as well as callback_query.
{
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('./src/index.js', import.meta.url), 'utf8')
  const sub = /allowed_updates:\s*\[([^\]]+)\]/.exec(src)
  const covers = Boolean(sub) && sub[1].includes("'message'") && sub[1].includes("'callback_query'")
  const menu = src.includes('setMyCommands')
  if (covers && menu) pass('L3 the webhook subscribes to message and callback_query, and registers the command menu')
  else fail('L3', JSON.stringify({ covers, menu, sub: sub?.[1] }))
}

const passed = results.filter((r) => r.ok).length
console.log('\n==== login, model and telegram fixes ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
