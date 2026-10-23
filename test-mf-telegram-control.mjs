// Telegram control: the commands, and the two rules that keep it safe.
//   T1 a command mutates; free text does not (it goes to the read-only assistant).
//   T2 there is no command, and no fallback, that returns a credential value.
//   T3 only the configured chat may command the bot.
//   T4 the auto-approval rule is time-boxed, agent-scoped, and audited as its own
//      source so its grants are distinguishable from the operator's.
import { Miniflare } from 'miniflare'
import { wrapWithKek, encryptStr } from './src/crypto.js'
import { parseCommand, resolvePending, autoRuleActive, formatPendingList, describeAutoRule, TELEGRAM_HELP } from './src/telegram.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

// T1: parsing separates commands from prose.
{
  const approve = parseCommand('/approve #1 24h')
  const prose = parseCommand('为什么 Muse 读不到？')
  const handle = resolvePending({ pending: { a: { id: 'a' }, b: { id: 'b' } } }, '#2')
  const ok = approve.verb === 'approve' && approve.args[0] === '#1' && approve.args[1] === '24h'
    && prose.verb !== 'approve' && prose.verb !== 'deny' && handle?.id === 'b'
  if (ok) pass('T1 commands parse and are distinguishable from free text')
  else fail('T1', JSON.stringify({ approve, prose: prose.verb, handle: handle?.id }))
}

// T2: no command mentions a value, and the list formatter shows names only.
{
  const text = String(TELEGRAM_HELP).toLowerCase()
  const forbidden = ['/get', '/secret', '/value', '/copy', '/share', '/password', '/show']
  const offers = forbidden.filter((word) => text.includes(word))
  const states = { pending: { p1: { id: 'p1', agent: 'muse', name: 'tavily', action: 'secret.read' } }, secrets: { tavily: 'sk-live-xyz' } }
  const list = formatPendingList(states)
  const leaks = ['sk-live-xyz'].filter((value) => list.includes(value))
  if (!offers.length && !leaks.length && text.includes('不能读取')) pass('T2 no command returns a value, and the help says so')
  else fail('T2', JSON.stringify({ offers, leaks }))
}

// T4: the auto rule is scoped and expires.
{
  const now = Date.now()
  const live = { settings: { telegramAuto: { agent: 'muse', until: now + 60000 } } }
  const expired = { settings: { telegramAuto: { agent: 'muse', until: now - 1 } } }
  const everyone = { settings: { telegramAuto: { agent: '*', until: now + 60000 } } }
  const ok = Boolean(autoRuleActive(live, 'muse')) && !autoRuleActive(live, 'codex')
    && !autoRuleActive(expired, 'muse') && Boolean(autoRuleActive(everyone, 'codex'))
  if (ok) pass('T4 the auto rule is agent-scoped and stops when it expires')
  else fail('T4', JSON.stringify({ live: autoRuleActive(live, 'muse'), other: autoRuleActive(live, 'codex'), expired: autoRuleActive(expired, 'muse') }))
}

// T3 + the real path: a message from another chat is ignored, the configured one
// can approve, and the grant is attributed to the telegram source.
const KEK = Buffer.alloc(32, 44).toString('base64')
const ACCT = 'vault@example.invalid'
const ITEM = 'tg-item'
const ITEM_ID = 'tg-item-id'
const SECRET = 'tg-secret-value'
const BOT = 'bot-token'
const CHAT = '424242'

const mf = new Miniflare({
  modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
  vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  d1Databases: { NODEWARDEN_DB: 'tg-db' },
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
  const data = { login: { username: await encryptStr('alice', E, M), password: await encryptStr(SECRET, E, M), totp: '', uris: [] }, fields: [] }
  await db.prepare('INSERT OR REPLACE INTO ciphers (id,user_id,type,folder_id,name,notes,data,key,favorite,reprompt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(ITEM_ID, 'u1', 1, null, await encryptStr(ITEM, E, M), '', JSON.stringify(data), null, 0, 0, '2024-01-01', '2024-01-01', null).run()
}
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
const baseState = () => ({
  agents: { muse: { hash: 'x', allow: [ITEM], groups: [], allowAll: false, legacy: false, account: ACCT } },
  oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {},
  policies: {}, grants: {}, pending: { req1: { id: 'req1', agent: 'muse', name: ITEM, account: ACCT, action: 'secret.read', itemId: ITEM_ID, createdAt: '2026-01-01' } },
  audit: [], itemGroups: {}, security: {}, capabilities: {}, actionGrants: {}, usePolicies: {}, deniedAttempts: {},
  itemIds: { [ITEM]: ITEM_ID }, credentialKinds: { [ITEM_ID]: 'api' }, fillPolicies: {}, plaintextReadPolicies: {},
  settings: { notifications: { telegram: { botToken: BOT, chatId: CHAT, webhookSecret: 'whsec' } }, vaultEmail: ACCT },
})
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(baseState()) })
const plain = JSON.stringify({ email: ACCT, symEncKey: Buffer.alloc(32, 1).toString('base64'), symMacKey: Buffer.alloc(32, 2).toString('base64'), expiresAt: 0 })
await stub.fetch('https://do/session', { method: 'PUT', body: JSON.stringify({ wrapped: await wrapWithKek(new TextEncoder().encode(plain), Buffer.from(KEK, 'base64')), expiresAt: 0 }) })

const send = (chatId, text) => mf.dispatchFetch('https://broker.test/telegram/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'whsec' },
  body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: chatId }, text } }),
})

// T3: a message from a different chat changes nothing.
{
  const before = (await (await stub.fetch('https://do/state')).json()).state
  await send('999999', '/approve #1 always')
  const after = (await (await stub.fetch('https://do/state')).json()).state
  const untouched = Boolean(after.pending.req1) && Object.keys(after.capabilities || {}).length === Object.keys(before.capabilities || {}).length
  if (untouched) pass('T3 a message from another chat is ignored')
  else fail('T3', JSON.stringify({ pending: Object.keys(after.pending || {}), caps: Object.keys(after.capabilities || {}) }))
}

// The configured chat can approve, and the audit attributes it to telegram.
{
  await send(Number(CHAT), '/approve #1 24h')
  const state = (await (await stub.fetch('https://do/state')).json()).state
  const approved = !state.pending?.req1
  const cap = Object.values(state.capabilities || {}).find((entry) => entry.itemName === ITEM && entry.action === 'secret.read')
  const audit = (state.audit || []).find((entry) => entry.event === 'request.approve')
  if (approved && cap && audit?.source === 'telegram') pass('the configured chat can approve, and the audit names telegram as the source')
  else fail('approve', JSON.stringify({ approved, cap: Boolean(cap), source: audit?.source }))
}

// T2 for real: no reply ever contains the value, even when asked directly.
// The bot's outbound call leaves the worker sandbox, so the reply text is not
// observable from here — instead assert the property that makes the leak
// impossible: the handler has no read path at all, and a request for the value
// is answered by the assistant (whose snapshot cannot contain it, proven in
// test-mf-ai-assistant A1). The negative is checked structurally.
{
  const source = await (await import('node:fs/promises')).readFile(new URL('./src/telegram.js', import.meta.url), 'utf8')
  const main = await (await import('node:fs/promises')).readFile(new URL('./src/index.js', import.meta.url), 'utf8')
  // The handler may call decidePending and read state, never the vault reader.
  const handlerStart = main.indexOf('async function handleTelegramMessage')
  const handlerEnd = main.indexOf('async function notifyDenied')
  const handler = handlerStart >= 0 && handlerEnd > handlerStart ? main.slice(handlerStart, handlerEnd) : ''
  const touchesVault = /readSecretFromRows|getCredential|decryptCipherRow|extractSecret/.test(handler)
  const mentionsValue = /sendSecret|secret\.value|\.password/.test(handler)
  const helpSaysNo = String(TELEGRAM_HELP).includes('不能读取')
  if (handler && !touchesVault && !mentionsValue && helpSaysNo) pass('T2 the Telegram handler has no vault read path, and says so in /help')
  else fail('T2', JSON.stringify({ hasHandler: Boolean(handler), touchesVault, mentionsValue, helpSaysNo }))
}

// An active auto rule is reported with its remaining time.
{
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ ...baseState(), settings: { ...baseState().settings, telegramAuto: { agent: 'muse', until: Date.now() + 60000 } } }) })
  const before = (await (await stub.fetch('https://do/state')).json()).state
  const rule = before.settings?.telegramAuto
  const remaining = Math.round((rule.until - Date.now()) / 60000)
  const reported = describeAutoRule(before)
  if (rule && rule.agent === 'muse' && remaining > 0 && reported.includes('还剩') && reported.includes('分钟')) pass('an active auto rule is reported with its remaining time')
  else fail('auto-report', JSON.stringify({ rule, remaining, reported }))
}

await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== telegram control ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
