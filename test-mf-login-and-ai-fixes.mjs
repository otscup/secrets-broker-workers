// Three bugs from one report:
//   L1 switching accounts used to pin the login page to that account, locking the
//      operator out of their own broker. Every account must be offered.
//   L2 the free Workers AI plan cannot run the DeepSeek models, and 5035 surfaced
//      as an opaque code. The default must be a free-plan model, and choosing a
//      paid one must say so.
//   L3 Telegram text messages were dropped because the webhook subscribed to
//      callback_query only.
import { Miniflare } from 'miniflare'
import { WORKERS_AI_MODELS, WORKERS_AI_DEFAULT } from './src/ai.js'

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

// L1a: the login page offers every account, not only the pinned one.
{
  const res = await mf.dispatchFetch('https://broker.test/login')
  const html = await res.text()
  const hasFirst = html.includes('first@example.invalid')
  const hasSecond = html.includes('second@example.invalid')
  const hasSelect = html.includes('id="account"') && html.includes('<select')
  const pinnedSelected = /<option value="second@example\.invalid" selected>/.test(html)
  if (res.status === 200 && hasFirst && hasSecond && hasSelect && pinnedSelected) pass('L1 the login page offers every vault account, with the current one preselected')
  else fail('L1', JSON.stringify({ status: res.status, hasFirst, hasSecond, hasSelect, pinnedSelected }))
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

// L2: the default model runs on the free plan, and paid ones are marked.
{
  const freeIds = WORKERS_AI_MODELS.filter((m) => !m.paid).map((m) => m.id)
  const defaultIsFree = freeIds.includes(WORKERS_AI_DEFAULT)
  const noDeepseekDefault = !WORKERS_AI_DEFAULT.includes('deepseek')
  const paidMarked = WORKERS_AI_MODELS.filter((m) => m.id.includes('deepseek')).every((m) => m.paid === true)
  const hasFreeOptions = freeIds.length >= 3
  if (defaultIsFree && noDeepseekDefault && paidMarked && hasFreeOptions) pass('L2 the default model is a free-plan one, paid models are marked', )
  else fail('L2', JSON.stringify({ defaultIsFree, noDeepseekDefault, paidMarked, free: freeIds.length }))
}

// L2b: a 5035 from the provider is translated, not passed through as a code.
{
  // Exercise the real error path with a fake binding that throws 5035.
  const { askAi } = await import('./src/ai.js')
  const env = { AI: { run: async () => { throw new Error('5035: Model @cf/deepseek-ai/x is not available on the Workers Free plan. Upgrade to access this model') } } }
  const out = await askAi(env, { ai: { provider: 'workers-ai', workersModel: '@cf/deepseek-ai/x' } }, { question: 'hi', snapshot: {} })
  const explained = out.ok === false && out.reason.includes('免费计划') && out.reason.includes('Llama')
  if (explained) pass('L2b a free-plan refusal explains which model and what to switch to')
  else fail('L2b', JSON.stringify(out))
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
