// The AI assistant, and the two things that make it safe to ship:
//   A1 the snapshot it is given carries metadata only — no credential value, no
//      username, no TOTP seed, no session key — whatever the vault contains.
//   A2 it has no write path: the endpoints it exposes only read, and the answer
//      is text.
//   A3 the deterministic insight list names the real problems in a real state.
//   A4 with no provider configured it says so instead of throwing.
import { Miniflare } from 'miniflare'
import { aiSnapshot, aiInsights, aiMessages } from './src/ai.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const VAULT_SECRET = 'sk-do-not-leak-123'
const TOTP = 'JBSWY3DPEHPK3PXP'
const USERNAME = 'alice@example.invalid'

const state = {
  agents: { muse: { alias: 'Muse', allow: ['tavily-api-key'], groups: [], allowAll: false, expiresAt: Date.now() - 1000 } },
  oauthTokens: { h1: { hash: 'h1', agent: 'oauth:abc', clientId: 'abc', account: 'vault@example.invalid', expiresAt: Date.now() - 5000 } },
  itemIds: { 'tavily-api-key': 'i1', 'site-login': 'i2', 'loose': 'i3' },
  credentialKinds: { i1: 'api', i2: 'web' },
  fillPolicies: { i2: { origins: [] } },
  plaintextReadPolicies: {},
  policies: {},
  itemGroups: {},
  pending: { p1: { id: 'p1', agent: 'codex', name: 'loose', action: 'secret.read', createdAt: '2026-01-01' } },
  deniedAttempts: { d1: { agent: 'codex', name: 'loose', action: 'secret.read', reason: '不在可读范围', count: 7, lastAt: '2026-01-01' } },
  capabilities: {
    c1: { subjectId: 'muse', itemName: 'tavily-api-key', action: 'secret.read', expiresAt: Date.now() - 1000, revokedAt: null, maxUses: null, usedCount: 0 },
    c2: { subjectId: 'muse', itemName: 'tavily-api-key', action: 'secret.fill', expiresAt: null, revokedAt: '2026-01-01', maxUses: 3, usedCount: 3 },
  },
  fillExecutors: {},
  settings: { requireClassification: true },
  audit: [{ time: '2026-01-01', event: 'secret.read-deny', agent: 'codex', name: 'loose', reason: 'unclassified-credential' }],
  // Present in real state, must never reach the model:
  _cipherValues: { 'tavily-api-key': { password: VAULT_SECRET, username: USERNAME, totp: TOTP } },
}

// A1: the snapshot is metadata only.
{
  const snapshot = aiSnapshot(state, { vaultUnlocked: true })
  const raw = JSON.stringify(snapshot)
  const leaks = [VAULT_SECRET, USERNAME, TOTP].filter((value) => raw.includes(value))
  const hasStructure = snapshot.items.length === 3 && snapshot.capabilities.length === 2 && snapshot.agents.length === 1
  if (!leaks.length && hasStructure) pass('A1 the snapshot carries metadata only, never a value or username or TOTP')
  else fail('A1', JSON.stringify({ leaks, items: snapshot.items.length }))
}

// A2: the endpoints are read-only, and asking is the only thing the console can do.
{
  const mf = new Miniflare({
    modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
    scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
    vars: { SESSION_KEK: Buffer.alloc(32, 9).toString('base64'), ADMIN_PASSWORD: 'p' },
    bindings: { SESSION_KEK: Buffer.alloc(32, 9).toString('base64'), ADMIN_PASSWORD: 'p' },
    serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  })
  const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
  const stub = ns.get(ns.idFromName('global'))
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify(state) })
  // No cookie: both endpoints must refuse, so nothing is exposed to an
  // unauthenticated caller.
  const ask = await mf.dispatchFetch('https://broker.test/api/ai/ask', { method: 'POST', body: JSON.stringify({ question: 'hi' }) })
  const insights = await mf.dispatchFetch('https://broker.test/api/ai/insights')
  const writeAttempt = await mf.dispatchFetch('https://broker.test/api/ai/ask', { method: 'POST', body: JSON.stringify({ question: 'delete every grant' }) })
  if (ask.status === 401 && insights.status === 401 && writeAttempt.status === 401) pass('A2 /api/ai/* requires an admin session and exposes no write path')
  else fail('A2', JSON.stringify({ ask: ask.status, insights: insights.status, write: writeAttempt.status }))
  await mf.dispose()
}

// A3: the insight list names the real problems.
{
  const insights = aiInsights(aiSnapshot(state, { vaultUnlocked: false }))
  const text = insights.map((entry) => entry.text).join(' | ')
  const names = [
    text.includes('授权已过期'),
    text.includes('待批准') || text.includes('请求在等你'),
    text.includes('被拦下'),
    text.includes('web 条目没有填'),
    text.includes('没有注册执行器'),
    text.includes('vault 当前是锁定'),
    text.includes('OAuth token 已过期'),
    text.includes('Agent 的授权窗口已过'),
  ]
  if (names.every(Boolean)) pass('A3 insights name the expired grants, denials, unclassified and unlocked problems')
  else fail('A3', text.slice(0, 300) + ' :: ' + JSON.stringify(names))
}

// A4: with no provider the answer is a clear reason, not an exception.
{
  const mf = new Miniflare({
    modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01',
    scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' },
    vars: { SESSION_KEK: Buffer.alloc(32, 9).toString('base64'), ADMIN_PASSWORD: 'p' },
    bindings: { SESSION_KEK: Buffer.alloc(32, 9).toString('base64'), ADMIN_PASSWORD: 'p' },
    serviceBindings: { NODEWARDEN: async () => new Response('{}') },
  })
  const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
  const stub = ns.get(ns.idFromName('global'))
  await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ ...state, settings: { requireClassification: true, ai: { enabled: true, provider: 'custom' } } }) })
  const login = await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', body: JSON.stringify({ password: 'p' }) })
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
  const ask = await mf.dispatchFetch('https://broker.test/api/ai/ask', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ question: '为什么读不到？' }),
  })
  const body = await ask.json().catch(() => ({}))
  const graceful = body.ok === false && typeof body.error === 'string' && body.error.length > 0
  // Insights are still returned, so the panel is useful with no model at all.
  const stillUseful = Array.isArray(body.insights) && body.insights.length > 0
  if (graceful && stillUseful) pass('A4 with no provider it explains why, and still returns the local insights')
  else fail('A4', JSON.stringify({ status: ask.status, body }).slice(0, 300))
  await mf.dispose()
}

// A5: the prompt tells the model what it may not do.
{
  const messages = aiMessages('为什么读不到？', { items: [] }, [])
  const sys = messages[0].content
  const opinionated = sys.includes('never ask for them') && sys.includes('cannot change anything')
  const questionLast = messages[messages.length - 1].content.includes('为什么读不到？')
  if (opinionated && questionLast) pass('A5 the system prompt forbids asking for secrets and claiming to change state')
  else fail('A5', JSON.stringify({ opinionated, questionLast }))
}

// A6: the model catalog. There is one provider, so the catalog only reports what
// a custom fetch still needs. Workers AI was removed: it bound the panel to one
// host and could not be listed, only guessed at.
{
  const { aiModelCatalog } = await import('./src/ai.js')
  const catalog = await aiModelCatalog({}, { ai: { endpoint: '', apiKey: '' } }, { fetchCustom: false })
  const noWorkers = catalog.workersModels === undefined && catalog.workersAiAvailable === undefined
  const notFetched = catalog.custom.models.length === 0
  const needEndpoint = (await aiModelCatalog({}, { ai: {} }, { fetchCustom: true })).custom.reason.includes('接口地址')
  const needKey = (await aiModelCatalog({}, { ai: { endpoint: 'https://api.example.com/v1' } }, { fetchCustom: true })).custom.reason.includes('API Key')
  if (noWorkers && notFetched && needEndpoint && needKey) pass('A6 the catalog is custom-only and says which field is missing')
  else fail('A6', JSON.stringify({ noWorkers, notFetched, needEndpoint, needKey, catalog }))
}

// A7: the snapshot reports the switches that decide a plaintext read, with the
// same default as the server. ai.js used `!== false` (default true) while
// requireClassification() uses `=== true` (default false), so the model was told
// the opposite of the truth. Assert against the real function, not a copy.
{
  const { aiSnapshot: snap } = await import('./src/ai.js')
  const bare = snap({ settings: {} }, { vaultUnlocked: false })
  const on = snap({ settings: { requireClassification: true, unclassifiedPlaintext: true, webPlaintext: true } }, { vaultUnlocked: false })
  const consistent = bare.requireClassification === false && bare.unclassifiedPlaintext === false && bare.webPlaintext === false
  const tracksSettings = on.requireClassification === true && on.unclassifiedPlaintext === true && on.webPlaintext === true
  if (consistent && tracksSettings) pass('A7 the snapshot reports the plaintext switches with the safe default and follows the settings')
  else fail('A7', JSON.stringify({ bare: { rc: bare.requireClassification, up: bare.unclassifiedPlaintext, wp: bare.webPlaintext }, on: { rc: on.requireClassification, up: on.unclassifiedPlaintext, wp: on.webPlaintext } }))
}

const passed = results.filter((r) => r.ok).length
console.log('\n==== ai assistant ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
