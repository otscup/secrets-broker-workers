// A first connection is an approval, so it has to reach the operator even with
// the console closed. This pins two things: the Worker now fans the request out
// to the configured channels (agent + time only, never an item name), and the
// service worker prefers the connection queue and falls back to item requests.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import worker from './src/index.js'
import { HARNESS, makeEnv, seedState, putSession, tokenHash, makeReporter, login, call } from './test-support/broker-harness.mjs'

const { pass, fail, finish } = makeReporter()

// ============ 1. A pending connection notifies the operator ============
{
  const env = makeEnv()
  await seedState(env, {
    // Created after CONNECTION_ADMISSION_EPOCH, so the agent is not
    // grandfathered and the first call really does create a pending row.
    connectionPolicy: { required: true },
    agents: {
      [HARNESS.AGENT]: {
        hash: await tokenHash(), allow: [HARNESS.ITEM], groups: [], allowAll: false, write: true,
        legacy: true, account: HARNESS.ACCT, createdAt: '2027-01-01T00:00:00.000Z',
      },
    },
    settings: {
      notifications: { telegram: { botToken: 'TEST-BOT', chatId: 'TEST-CHAT' } },
      vaultEmail: HARNESS.ACCT,
    },
  })
  await putSession(env)
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return new Response('{}', { status: 200 })
  }
  const waits = []
  try {
    const response = await worker.fetch(new Request('https://broker.test/secret?name=' + HARNESS.ITEM, {
      headers: { authorization: 'Bearer ' + HARNESS.AUTH, 'cf-connecting-ip': '203.0.113.9' },
    }), env, { waitUntil: (promise) => { waits.push(promise) } })
    const body = await response.json().catch(() => ({}))
    if (response.status === 202 && body.reasonCode === 'connection-pending') {
      pass('1a the agent gets the pending answer before any notification work')
    } else {
      fail('1a pending answer', JSON.stringify({ status: response.status, body }).slice(0, 200))
    }
    await Promise.all(waits)
  } finally {
    globalThis.fetch = realFetch
  }
  const telegram = calls.filter((entry) => entry.url.includes('api.telegram.org'))
  if (telegram.length === 1) {
    pass('1b the connection request fans out to the configured Telegram channel')
  } else {
    fail('1b telegram calls', JSON.stringify(calls.map((entry) => entry.url)).slice(0, 220))
  }
  const sent = telegram[0] ? JSON.parse(telegram[0].init.body) : {}
  // The agent and the request time are allowed; an item name or a secret would
  // turn a notification channel into a data leak.
  if (sent.text && sent.text.includes(HARNESS.AGENT) && sent.text.includes('申请首次连接')) {
    pass('1c the notification names the agent and the request')
  } else {
    fail('1c notification text', String(sent.text ?? '').slice(0, 200))
  }
  if (sent.text && !sent.text.includes(HARNESS.ITEM) && !sent.text.includes(HARNESS.PASSWORD)) {
    pass('1d the notification carries no item name and no plaintext')
  } else {
    fail('1d notification leaked an item', String(sent.text ?? '').slice(0, 200))
  }
  if (sent.text && sent.text.includes('https://broker.test/#pending')) {
    pass('1e the notification points at the pending panel')
  } else {
    fail('1e notification link', String(sent.text ?? '').slice(0, 200))
  }
  if (calls.every((entry) => !entry.url.includes('/push'))) {
    pass('1f no VAPID keys are minted for a deployment with no push subscriber')
  } else {
    fail('1f unexpected push work', JSON.stringify(calls.map((entry) => entry.url)).slice(0, 220))
  }
}

// ============ 2. The service worker prefers the connection queue ============
const SW = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8')
async function pushOnce({ ok = true, state = {} } = {}) {
  const listeners = {}
  const shown = []
  const posted = []
  const self = {
    location: { origin: 'https://broker.test' },
    addEventListener: (type, handler) => { listeners[type] = handler },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }) } },
    clients: { matchAll: async () => [{ postMessage: (message) => posted.push(message) }] },
  }
  const fetch = async () => ({ ok, json: async () => state })
  vm.runInNewContext(SW, { self, fetch, URL })
  let pending = Promise.resolve()
  listeners.push({ waitUntil: (promise) => { pending = promise } })
  await pending
  return { notice: shown[0], posted }
}
{
  const { notice, posted } = await pushOnce({
    state: {
      connections: { pending: [{ id: 'c1', agent: 'connecting-agent' }] },
      pending: [{ id: 'p1', agent: 'item-agent', name: 'secret-item' }],
    },
  })
  if (notice && notice.title === 'Secrets Broker 连接请求' && notice.options.body.includes('connecting-agent')) {
    pass('2a a waiting connection outranks a waiting item request')
  } else {
    fail('2a connection notice', JSON.stringify(notice).slice(0, 200))
  }
  if (notice && !notice.options.body.includes('secret-item')) {
    pass('2b the connection notice does not mention the item queue')
  } else {
    fail('2b connection notice leaked item', JSON.stringify(notice).slice(0, 200))
  }
  if (notice && notice.options.data?.url === '/#pending') {
    pass('2c clicking the notice opens the pending panel')
  } else {
    fail('2c click target', JSON.stringify(notice?.options?.data).slice(0, 160))
  }
  if (posted.length === 1 && posted[0].type === 'secrets-broker:pending') {
    pass('2f an open console is told to refresh immediately instead of waiting for a poll')
  } else {
    fail('2f tab refresh message', JSON.stringify(posted).slice(0, 160))
  }
}
{
  const { notice } = await pushOnce({ state: { connections: { pending: [] }, pending: [{ id: 'p1', agent: 'item-agent', name: 'secret-item' }] } })
  if (notice && notice.title === 'Secrets Broker 授权请求' && notice.options.body.includes('secret-item')) {
    pass('2d with no waiting connection the item request still produces its notice')
  } else {
    fail('2d item notice', JSON.stringify(notice).slice(0, 200))
  }
}
{
  // A logged-out browser gets 401: the worker keeps the generic copy instead of
  // rendering the agent or item that the session could not be checked against.
  const { notice } = await pushOnce({ ok: false, state: { connections: { pending: [{ agent: 'should-not-show' }] } } })
  if (notice && notice.options.body === '有新的授权请求，点击查看') {
    pass('2e a 401 keeps the generic copy and leaks no agent name')
  } else {
    fail('2e 401 copy', JSON.stringify(notice).slice(0, 200))
  }
}
{
  // The console side of the same fix: the poll must rebuild the bar and the
  // push listener must run the poll, otherwise the banner only appears after a
  // manual refresh.
  const UI = readFileSync(new URL('./src/ui.js', import.meta.url), 'utf8')
  if (UI.includes("secrets-broker:pending") && UI.includes('wireServiceWorkerMessages()') && UI.includes('if (pendingMoved) renderNoticeBar()')) {
    pass('2g the console refreshes the notice bar from a push message and from the poll')
  } else {
    fail('2g console refresh wiring', 'missing listener or renderNoticeBar call')
  }
}

// ============ 3. The plugin relay sees and can decide a connection ============
{
  const env = makeEnv({ extra: { DSH_PLUGIN_TOKEN: 'plugin-token' } })
  await putSession(env)
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 2 * 3600e3).toISOString()
  await seedState(env, {
    connectionPolicy: { required: true },
    connections: {
      c1: {
        id: 'c1', agent: 'connecting-agent', account: HARNESS.ACCT, oauth: false,
        state: 'pending', createdAt, expiresAt, origin: 'https://broker.test',
        requestedScope: { all: true, itemIds: [] }, requestedPlaintext: false,
      },
    },
    settings: { vaultEmail: HARNESS.ACCT },
  })
  const pluginHeaders = { 'x-broker-plugin-token': 'plugin-token' }
  const pending = await worker.fetch(new Request('https://broker.test/api/plugin/pending', { headers: pluginHeaders }), env, { waitUntil: () => {} })
  const pendingBody = await pending.json()
  const card = (pendingBody.pending || []).find((entry) => entry.id === 'c1')
  if (pendingBody.count === 1 && card?.kind === 'connection' && card?.action === 'connection' && card?.agent === 'connecting-agent' && card?.name === '') {
    pass('3a the plugin badge and queue include the waiting connection')
  } else {
    fail('3a plugin pending', JSON.stringify(pendingBody).slice(0, 260))
  }
  const waiting = await worker.fetch(new Request('https://broker.test/api/plugin/wait?timeout=0', { headers: pluginHeaders }), env, { waitUntil: () => {} })
  const waitingBody = await waiting.json()
  if (waitingBody.count === 1 && waitingBody.pending?.some((entry) => entry.id === 'c1' && entry.kind === 'connection')) {
    pass('3b the plugin long poll wakes on a connection, not only on item requests')
  } else {
    fail('3b plugin wait', JSON.stringify(waitingBody).slice(0, 260))
  }
  const decided = await worker.fetch(new Request('https://broker.test/api/plugin/decide', {
    method: 'POST',
    headers: { ...pluginHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'c1', decision: '24h' }),
  }), env, { waitUntil: () => {} })
  const decidedBody = await decided.json()
  const snapshot = await (await env.BROKER_STATE.get().fetch('https://state/state')).json()
  const record = snapshot.state?.connections?.c1
  const audit = (env._vault.auditRows || []).filter((entry) => entry.event === 'connection.approve')
  if (decided.status === 200 && record?.state === 'approved' && record.scope?.all === true && record.ttlMs === 86400e3 && record.plaintextAllowed === false) {
    pass('3c the plugin approval applies the console admission rules and defaults to the requested scope')
  } else {
    fail('3c plugin approve', JSON.stringify({ status: decided.status, body: decidedBody, record }).slice(0, 320))
  }
  if (audit.length === 1 && audit[0].via === 'dsh-plugin') {
    pass('3d a plugin approval leaves a connection.approve audit line')
  } else {
    fail('3d plugin audit', JSON.stringify(audit).slice(0, 200))
  }
}

// ============ 4. A queue that predates the page is news, not baseline ============
{
  const UI = readFileSync(new URL('./src/ui.js', import.meta.url), 'utf8')
  const seed = /function seedPendingFromState\(\)[\s\S]{0,900}notifyPendingBatch\(fresh\)[\s\S]{0,120}return true/.test(UI)
  const bars = /function seedPendingFromState\(\)[\s\S]{0,900}syncPendingTitle\(\)[\s\S]{0,200}renderNoticeBar\(\)/.test(UI)
  if (seed && bars) {
    pass('4a the first state read shows the bar and raises one batch notification')
  } else {
    fail('4a seed notification', JSON.stringify({ seed, bars }))
  }
  if (UI.includes(': pending.concat(connections)') && /if \(!wasInitialized && fresh.length\) notifyPendingBatch\(fresh\)/.test(UI)) {
    pass('4b a first poll that beats loadAll treats the queue as new and notifies once')
  } else {
    fail('4b initial poll', 'missing batch branch')
  }
  if (/notification.onclick[\s\S]{0,220}location.hash = '#pending'[\s\S]{0,80}openPendingSheet\(\)/.test(UI)) {
    pass('4c clicking a local notification opens the pending panel, not the grants page')
  } else {
    fail('4c notification click', 'does not open the pending sheet')
  }
  if (/const n = \(\(app.data && app.data.pending\) \|\| \[\]\)\.length \+ pendingConnections\(\)\.length/.test(UI)) {
    pass('4d the title count and plugin card share the connection queue')
  } else {
    fail('4d queue count', 'title or plugin card misses connections')
  }
}

// ============ 5. The push service's answer is recorded, not swallowed ============
// The console could only say "sent 0" while a 401 (VAPID mismatch) and a 410
// (dead subscription) looked identical. /api/push/test now returns per-endpoint
// statuses, and the state keeps the last attempt for the settings page.
{
  const env = makeEnv()
  await seedState(env, {
    settings: {
      notifications: {
        webpush: {
          subscriptions: [{ endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint', keys: { p256dh: 'p', auth: 'a' }, addedAt: '2026-01-01T00:00:00.000Z' }],
        },
      },
      vaultEmail: HARNESS.ACCT,
    },
  })
  const cookie = await login(env)
  const realFetch = globalThis.fetch
  let status = 201
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith('https://fcm.googleapis.com/')) return realFetch(url, init)
    calls.push({ url: String(url), headers: init.headers || {}, body: init.body ?? null })
    return new Response('{}', { status })
  }
  try {
    const accepted = await (await call(env, '/api/push/test', { method: 'POST', headers: { cookie } })).json()
    const auth = String(calls[0]?.headers?.authorization || '')
    if (accepted.sent === 1 && accepted.results?.[0]?.status === 201 && auth.startsWith('vapid t=')) {
      pass('5a a 201 is reported as sent and the VAPID header is signed')
    } else {
      fail('5a accepted push', JSON.stringify({ accepted, auth: auth.slice(0, 30) }).slice(0, 260))
    }
    const stored = env._store.state.settings.notifications.webpush.lastAttempt
    if (stored?.sent === 1 && stored.results?.[0]?.status === 201 && stored.results?.[0]?.host === 'fcm.googleapis.com') {
      pass('5b the last attempt keeps host + status, never the full endpoint')
    } else {
      fail('5b last attempt', JSON.stringify(stored).slice(0, 260))
    }

    status = 401
    const rejected = await (await call(env, '/api/push/test', { method: 'POST', headers: { cookie } })).json()
    const kept = env._store.state.settings.notifications.webpush.subscriptions?.length
    if (rejected.sent === 0 && rejected.failed === 1 && rejected.results?.[0]?.status === 401 && kept === 1) {
      pass('5c a 401 is named and the subscription is kept for a key re-subscribe')
    } else {
      fail('5c 401', JSON.stringify({ rejected, kept }).slice(0, 260))
    }

    status = 410
    const dead = await (await call(env, '/api/push/test', { method: 'POST', headers: { cookie } })).json()
    const after = env._store.state.settings.notifications.webpush.subscriptions?.length
    if (dead.sent === 0 && dead.results?.[0]?.status === 410 && dead.stale?.includes('fcm.googleapis.com') && after === 0) {
      pass('5d a 410 is recorded and the dead subscription is removed')
    } else {
      fail('5d 410', JSON.stringify({ dead, after }).slice(0, 260))
    }
  } finally {
    globalThis.fetch = realFetch
  }
}

finish()
