/**
 * Connection admission: a new device asks the operator once, the operator picks
 * what that connection may read and for how long, and repeated probes from the
 * same source never add rows to the approval list.
 *
 * Run: node --import ./test-support/register.mjs test-connection-admission.mjs
 */
import {
  HARNESS, makeEnv, seedState, putSession, call, login, makeReporter,
  FakeD1, legacyCipherRow, tokenHash, mcpCall, mcpText,
} from './test-support/broker-harness.mjs'
import { createBridge } from './cli/bridge.mjs'
import { uiHtml } from './src/ui.js'

const ITEM2 = 'other-item'
const ITEM2_ID = 'item-other'
// After CONNECTION_ADMISSION_EPOCH, so this agent is NOT grandfathered.
const NEW_AGENT_AT = '2027-01-01T00:00:00.000Z'
const OLD_AGENT_AT = '2024-01-01T00:00:00.000Z'

const report = makeReporter()
function ok(name, condition, detail = '') {
  if (condition) report.pass(name)
  else report.fail(name, detail)
}

function iso(offsetMs = 0) { return new Date(Date.now() + offsetMs).toISOString() }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function statusCall(env, wait = '') {
  return call(env, '/api/connection/status' + (wait ? '?wait=' + wait : ''), {
    headers: { authorization: 'Bearer ' + HARNESS.AUTH },
  })
}

// Point the CLI bridge's fetch at the worker under test, so the real bridge
// code (parsing the 202, polling, replaying) is what the suite exercises.
function fetchTo(env) {
  return async (url, init = {}) => {
    const target = new URL(String(url))
    return call(env, target.pathname + target.search, init)
  }
}

// Wait until the first pending connection row exists, then return its id: the
// request id is inside the body the bridge consumes, so a test reads it from
// the state instead of racing the client.
async function pendingId(env) {
  for (let i = 0; i < 100; i++) {
    const state = await readState(env)
    const found = Object.values(state.connections ?? {}).find((entry) => entry.state === 'pending')
    if (found) return found.id
    await pause(25)
  }
  return ''
}

async function readState(env) {
  const response = await env.BROKER_STATE.get().fetch('https://state/state')
  return (await response.json()).state ?? {}
}

async function writeState(env, state) {
  await env.BROKER_STATE.get().fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
}

function getSecret(env, name = HARNESS.ITEM) {
  return call(env, '/secret?name=' + encodeURIComponent(name), { headers: { authorization: 'Bearer ' + HARNESS.AUTH } })
}

async function decide(env, cookie, body) {
  const response = await call(env, '/api/connections/decide', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

function agentRecord(createdAt) {
  return {
    hash: null, allow: [HARNESS.ITEM, ITEM2], groups: [], allowAll: false,
    write: true, legacy: true, account: HARNESS.ACCT, createdAt,
  }
}

async function freshEnv({ connections = {}, policy = { required: true }, createdAt = NEW_AGENT_AT, extra = {} } = {}) {
  const legacy = new FakeD1({ cipherRows: [
    await legacyCipherRow(),
    await legacyCipherRow({ id: ITEM2_ID, name: ITEM2 }),
  ] })
  const env = makeEnv({ legacy })
  const agent = agentRecord(createdAt)
  agent.hash = await tokenHash()
  await seedState(env, {
    connectionPolicy: policy,
    connections,
    agents: { [HARNESS.AGENT]: agent },
    policies: { [HARNESS.ITEM]: { noApproval: true }, [ITEM2]: { noApproval: true } },
    itemIds: { [HARNESS.ITEM]: HARNESS.ITEM_ID, [ITEM2]: ITEM2_ID },
    credentialKinds: { [HARNESS.ITEM_ID]: 'api', [ITEM2_ID]: 'api' },
    ...extra,
  })
  await putSession(env)
  return env
}

function record(overrides = {}) {
  return {
    id: 'conn-seeded', agent: HARNESS.AGENT, account: HARNESS.ACCT,
    source: { ipHash: 'ip:unknown' }, origin: 'https://broker.test',
    createdAt: iso(-11 * 60 * 1000), expiresAt: iso(-60 * 1000),
    state: 'pending', requestedScope: { all: true, itemIds: [] }, requestedPlaintext: false,
    scope: null, plaintextAllowed: null, ttlMs: null, decidedAt: null, decidedBy: null, reasonCode: null,
    ...overrides,
  }
}

async function main() {
  // 1 + 2: first contact is refused, and a repeat does not flood the list.
  {
    const env = await freshEnv()
    const first = await getSecret(env)
    const body = await first.json()
    ok('首次连接未批准时被拒，并返回 pending-connection',
      first.status === 202 && body.status === 'pending-connection' && body.reasonCode === 'connection-pending',
      JSON.stringify(body))
    ok('pending 响应带 requestId 与批准链接',
      Boolean(body.requestId) && String(body.approvalUrl).endsWith('/#connections'), JSON.stringify(body))
    ok('pending 响应告诉客户端该等多久、窗口何时结束',
      body.retryAfterMs === 2000 && body.waitUntil === body.expiresAt, JSON.stringify(body))

    const state = await readState(env)
    ok('只生成一条待批连接', Object.values(state.connections ?? {}).length === 1
      && Object.values(state.connections)[0].state === 'pending')
    ok('未批准时不写任何授权或能力',
      Object.keys(state.grants ?? {}).length === 0 && Object.keys(state.capabilities ?? {}).length === 0)

    const repeat = await getSecret(env)
    const repeatBody = await repeat.json()
    ok('同一来源重复请求复用同一个 requestId', repeatBody.requestId === body.requestId, JSON.stringify(repeatBody))
    const state2 = await readState(env)
    ok('重复请求没有新增待批项', Object.values(state2.connections ?? {}).length === 1)
    ok('重复请求只写一条 connection.request 审计',
      env._vault.auditRows.filter((entry) => entry.event === 'connection.request').length === 1)

    const cookie = await login(env)
    const approved = await decide(env, cookie, {
      id: body.requestId, decision: 'approve', itemIds: [HARNESS.ITEM_ID],
      plaintextAllowed: true, ttlMs: 3600e3,
    })
    ok('批准返回 200 与选定的条目范围',
      approved.status === 200 && approved.body.ok === true
      && approved.body.connection.scope.all === false
      && JSON.stringify(approved.body.connection.scope.itemIds) === JSON.stringify([HARNESS.ITEM_ID]),
      JSON.stringify(approved.body))

    const read = await getSecret(env)
    const readBody = await read.json()
    ok('批准后能读到选中的条目', read.status === 200 && readBody.value === HARNESS.PASSWORD, JSON.stringify(readBody))

    const other = await getSecret(env, ITEM2)
    const otherBody = await other.json()
    const absent = await getSecret(env, 'no-such-item-xyz')
    const absentBody = await absent.json()
    ok('未选中的条目读不到，且与不存在的名字答复完全同形',
      other.status === 403 && absent.status === 403
      && otherBody.reasonCode === 'item-not-found'
      && JSON.stringify(otherBody).split(ITEM2).join('<name>') === JSON.stringify(absentBody).split('no-such-item-xyz').join('<name>'),
      JSON.stringify(otherBody))
  }

  // 3: plaintextAllowed=false is enforced before the capability decision.
  {
    const env = await freshEnv()
    const first = await getSecret(env)
    const pending = await first.json()
    const cookie = await login(env)
    const approved = await decide(env, cookie, {
      id: pending.requestId, decision: 'approve', itemIds: [HARNESS.ITEM_ID],
      plaintextAllowed: false, duration: '1h',
    })
    ok('批准可以用 duration 代替 ttlMs', approved.status === 200 && approved.body.connection.ttlMs === 3600e3,
      JSON.stringify(approved.body))

    const read = await getSecret(env)
    const body = await read.json()
    ok('plaintextAllowed=false 时读明文被拒',
      read.status === 403 && body.reasonCode === 'connection-plaintext-denied', JSON.stringify(body))

    const listed = await mcpCall(env, 'list_secrets', {})
    const text = mcpText(listed)
    ok('不读明文时仍能看到许可范围内的名称', text.includes(HARNESS.ITEM) && !text.includes(ITEM2), text)
  }

  // 4: an approved admission that ran out of time stops working — but it is
  // history, not a lockout: the same source may ask again immediately.
  {
    const expired = record({
      id: 'conn-approved-expired', state: 'approved',
      scope: { all: false, itemIds: [HARNESS.ITEM_ID] },
      plaintextAllowed: true, decidedAt: iso(-2 * 60 * 1000), expiresAt: iso(-60 * 1000),
    })
    const env = await freshEnv({ connections: { [expired.id]: expired } })
    const read = await getSecret(env)
    const body = await read.json()
    ok('到期的连接许可不再放行，改为新的待批（不是 403）',
      read.status === 202 && body.status === 'pending-connection' && body.reasonCode === 'connection-pending'
      && Boolean(body.requestId) && body.requestId !== expired.id, JSON.stringify(body))
    const state = await readState(env)
    ok('到期记录被标记为 expired', state.connections[expired.id].state === 'expired')
    ok('到期写入 connection.expire 审计',
      env._vault.auditRows.some((entry) => entry.event === 'connection.expire' && entry.reasonCode === 'ttl-elapsed' && entry.requestId === expired.id))
    ok('到期后同一来源得到新的待批记录',
      Object.values(state.connections ?? {}).some((entry) => entry.id === body.requestId && entry.state === 'pending'))
  }

  // 5: 10 minutes without a decision -> expired, gone from the pending list.
  {
    const stale = record()
    const env = await freshEnv({ connections: { [stale.id]: stale } })
    const cookie = await login(env)
    const listed = await call(env, '/api/connections', { headers: { cookie } })
    const body = await listed.json()
    ok('超时未批的申请不再出现在待审批列表',
      listed.status === 200 && body.pending.length === 0 && body.count === 0, JSON.stringify(body))
    ok('超时记录以 expired 出现在历史里',
      body.recent.some((entry) => entry.id === stale.id && entry.state === 'expired'))
    const state = await readState(env)
    ok('超时记录状态变为 expired', state.connections[stale.id].state === 'expired')
    ok('超时写入带 reasonCode 的审计',
      env._vault.auditRows.some((entry) => entry.event === 'connection.expire'
        && entry.reasonCode === 'not-decided-in-10m'
        && entry.requestId === stale.id))
  }

  // 5b: a pending request that ran out of time is not a lockout either. The
  // same agent + account + IP may ask again at once, and the two attempts stay
  // distinguishable in the audit.
  {
    const env = await freshEnv()
    const first = await getSecret(env)
    const firstBody = await first.json()
    ok('首次申请产生待批', first.status === 202 && Boolean(firstBody.requestId), JSON.stringify(firstBody))
    // Move the pending window into the past — what ten minutes of waiting does.
    const snapshot = await readState(env)
    snapshot.connections[firstBody.requestId].expiresAt = iso(-60 * 1000)
    await writeState(env, snapshot)
    const second = await getSecret(env)
    const secondBody = await second.json()
    ok('超时后同一来源立即得到新的待批，而不是 403/锁死',
      second.status === 202 && secondBody.status === 'pending-connection'
      && secondBody.reasonCode === 'connection-pending'
      && Boolean(secondBody.requestId) && secondBody.requestId !== firstBody.requestId,
      JSON.stringify(secondBody))
    const requests = env._vault.auditRows.filter((entry) => entry.event === 'connection.request')
    ok('审计里两条 connection.request 可区分',
      requests.length === 2 && requests[0].requestId === firstBody.requestId
      && requests[1].requestId === secondBody.requestId,
      JSON.stringify(requests.map((entry) => entry.requestId)))
    const state = await readState(env)
    ok('旧申请保留为 expired，新申请是 pending',
      state.connections[firstBody.requestId].state === 'expired'
      && state.connections[secondBody.requestId].state === 'pending',
      JSON.stringify(Object.values(state.connections ?? {}).map((entry) => [entry.id, entry.state])))
  }

  // 6: an agent that predates the gate is already admitted.
  {
    const env = await freshEnv({ createdAt: OLD_AGENT_AT })
    const read = await getSecret(env)
    ok('上线前已存在的 agent 不被要求重新批准', read.status === 200)
    const state = await readState(env)
    ok('老 agent 不产生连接记录', Object.keys(state.connections ?? {}).length === 0)
  }

  // 7: deny is sticky and does not spawn a new pending row.
  {
    const env = await freshEnv()
    const first = await getSecret(env)
    const pending = await first.json()
    const cookie = await login(env)
    const denied = await decide(env, cookie, { id: pending.requestId, decision: 'deny', reason: 'not mine' })
    ok('拒绝返回 200', denied.status === 200 && denied.body.ok === true, JSON.stringify(denied.body))

    const read = await getSecret(env)
    const body = await read.json()
    ok('被拒绝的连接继续被拒', read.status === 403 && body.status === 'connection-denied', JSON.stringify(body))
    const state = await readState(env)
    ok('拒绝不会生成新的待批项', Object.values(state.connections ?? {}).length === 1
      && Object.values(state.connections)[0].state === 'denied')
    ok('拒绝写入 connection.deny 审计',
      env._vault.auditRows.some((entry) => entry.event === 'connection.deny'
        && entry.reasonCode === 'admin-denied'))
  }

  // 8: the kill switch, and the MCP surface.
  {
    const env = await freshEnv({ policy: { required: false } })
    const read = await getSecret(env)
    ok('connectionPolicy.required=false 时不启用准入', read.status === 200)
    const listed = await mcpCall(env, 'list_secrets', {})
    const payload = JSON.parse(mcpText(listed))
    ok('准入关闭时保留 totalCount，hiddenCount 为 0',
      payload.count === 2 && payload.totalCount === 2 && payload.hiddenCount === 0 && payload.hidden === false,
      mcpText(listed))
  }

  {
    const env = await freshEnv()
    const blocked = await mcpCall(env, 'get_secret', { name: HARNESS.ITEM })
    const text = mcpText(blocked)
    ok('MCP 首次调用返回连接待批',
      blocked.status === 200 && text.includes('pending-connection') && text.includes('connection-pending'), text)
    const pending = JSON.parse(text)
    const cookie = await login(env)
    const approved = await decide(env, cookie, {
      id: pending.requestId, decision: 'approve', itemIds: [HARNESS.ITEM_ID],
      plaintextAllowed: true, duration: '24h',
    })
    ok('MCP 待批项可以批准', approved.status === 200 && approved.body.ok === true, JSON.stringify(approved.body))
    const listed = await mcpCall(env, 'list_secrets', {})
    const listText = mcpText(listed)
    ok('MCP 列表只显示许可范围内的条目', listText.includes(HARNESS.ITEM) && !listText.includes(ITEM2), listText)
  }

  // 9: approval input validation, so a bad click cannot create a broad grant.
  {
    const env = await freshEnv()
    const first = await getSecret(env)
    const pending = await first.json()
    const cookie = await login(env)
    const empty = await decide(env, cookie, {
      id: pending.requestId, decision: 'approve', plaintextAllowed: true, duration: '24h',
    })
    ok('批准时必须选条目或选全部',
      empty.status === 400 && empty.body.reasonCode === 'connection-scope-empty', JSON.stringify(empty.body))
    const badTtl = await decide(env, cookie, {
      id: pending.requestId, decision: 'approve', all: true, plaintextAllowed: true, ttlMs: 30_000,
    })
    ok('过短的授权时间被拒',
      badTtl.status === 400 && badTtl.body.reasonCode === 'connection-ttl-invalid', JSON.stringify(badTtl.body))
  }

  // 10: a long poll that is approved in-flight answers "approved" in the same
  // call, so the client never has to resubmit.
  {
    const env = await freshEnv()
    const first = await getSecret(env)
    const pending = await first.json()
    const cookie = await login(env)
    const approval = (async () => {
      await pause(600)
      return decide(env, cookie, {
        id: pending.requestId, decision: 'approve', all: true, plaintextAllowed: true, duration: '1h',
      })
    })()
    const response = await statusCall(env, '3')
    const body = await response.json()
    const approved = await approval
    ok('长轮询在批准后返回 approved',
      response.status === 200 && body.state === 'approved' && body.reasonCode === null && body.retryAfterMs === 0,
      JSON.stringify(body))
    ok('长轮询返回的范围与批准时选定的一致',
      approved.status === 200 && body.scope?.all === true && body.plaintextAllowed === true, JSON.stringify(body))
    ok('批准后没有产生第二次连接申请',
      env._vault.auditRows.filter((entry) => entry.event === 'connection.request').length === 1)
  }

  // 11: the poll honours `wait` and, when the decision has not arrived, still
  // tells the client to keep polling.
  {
    const live = record({ id: 'conn-live', createdAt: iso(-30 * 1000), expiresAt: iso(9 * 60 * 1000), state: 'pending' })
    const env = await freshEnv({ connections: { [live.id]: live } })
    const started = Date.now()
    const response = await statusCall(env, '1')
    const elapsed = Date.now() - started
    const body = await response.json()
    ok('长轮询到点未决时返回 pending + retryAfterMs',
      response.status === 200 && body.state === 'pending' && body.reasonCode === 'connection-pending'
      && body.retryAfterMs === 2000 && body.waitUntil === live.expiresAt,
      JSON.stringify(body))
    ok('长轮询确实按 wait 挂起，而不是立即返回', elapsed >= 900, String(elapsed))
  }

  // 12: the CLI waits instead of giving up. Real bridge code, real Worker.
  {
    const env = await freshEnv()
    const cookie = await login(env)
    const originalFetch = globalThis.fetch
    const bridge = createBridge({ brokerUrl: 'https://broker.test', staticToken: HARNESS.AUTH, opener: () => true })
    globalThis.fetch = fetchTo(env)
    try {
      const pending = bridge.request({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'get_secret', arguments: { name: HARNESS.ITEM } },
      })
      const id = await pendingId(env)
      ok('CLI 首次调用产生了连接待批', Boolean(id))
      await pause(300)
      const approved = await decide(env, cookie, { id, decision: 'approve', all: true, plaintextAllowed: true, duration: '1h' })
      const text = await pending
      const value = JSON.parse(text)?.result?.content?.[0]?.text ?? ''
      ok('CLI 在批准后继续原请求并拿到值',
        approved.status === 200 && String(value).includes(HARNESS.PASSWORD), String(value).slice(0, 200))
      ok('CLI 等待没有重复提交连接申请',
        env._vault.auditRows.filter((entry) => entry.event === 'connection.request').length === 1)
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  // 13: a denial ends the wait with the broker's reasonCode, verbatim.
  {
    const env = await freshEnv()
    const cookie = await login(env)
    const originalFetch = globalThis.fetch
    const bridge = createBridge({ brokerUrl: 'https://broker.test', staticToken: HARNESS.AUTH, opener: () => true })
    globalThis.fetch = fetchTo(env)
    try {
      const pending = bridge.request({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'get_secret', arguments: { name: HARNESS.ITEM } },
      })
      const id = await pendingId(env)
      await pause(300)
      await decide(env, cookie, { id, decision: 'deny', reason: 'not mine' })
      let error = null
      try { await pending } catch (caught) { error = caught }
      ok('CLI 在拒绝时失败，并原样显示 reasonCode',
        Boolean(error) && error.reasonCode === 'admin-denied' && /admin-denied/.test(String(error.message)),
        String(error?.message ?? error))
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  // 14: visibility — hidden items are counted, never named, and cannot be
  // applied for.
  {
    const env = await freshEnv()
    env.MCP_ALLOW_READ = '1'
    const first = await getSecret(env)
    const pending = await first.json()
    const cookie = await login(env)
    await decide(env, cookie, {
      id: pending.requestId, decision: 'approve', itemIds: [HARNESS.ITEM_ID], plaintextAllowed: true, duration: '1h',
    })

    const listed = await mcpCall(env, 'list_secrets', {})
    const listText = mcpText(listed)
    const payload = JSON.parse(listText)
    ok('list_secrets 只给可见条目与布尔 hidden，不泄露范围外总量',
      Array.isArray(payload.items) && payload.items.length === 1
      && payload.items[0].id === HARNESS.ITEM_ID
      && payload.items[0].requestable === true
      && payload.count === 1 && payload.hidden === true
      && !('hiddenCount' in payload) && !('totalCount' in payload),
      listText)
    ok('list_secrets 不泄露不可见条目的名称', !listText.includes(ITEM2), listText)

    const apply = await mcpCall(env, 'request_access', { name: ITEM2 })
    const applyText = mcpText(apply)
    const absentApply = await mcpCall(env, 'request_access', { name: 'no-such-item-xyz' })
    const absentText = mcpText(absentApply)
    const applyPayload = JSON.parse(applyText)
    ok('对不可见条目的申请对外只说 not_found',
      applyPayload.status === 'not_found' && applyPayload.code === 'not_found'
      && !applyText.includes('connection-item-not-approved'),
      applyText)
    ok('不可见与不存在的申请对外逐字节一致',
      applyText.split(ITEM2).join('<name>') === absentText.split('no-such-item-xyz').join('<name>'),
      applyText + ' / ' + absentText)
    const state = await readState(env)
    ok('范围外申请不生成待审批记录',
      Object.keys(state.pending ?? {}).length === 0
      && !env._vault.auditRows.some((entry) => entry.event === 'request.create'))
    ok('审计里仍能区分范围外与不存在',
      env._vault.auditRows.some((entry) => entry.event === 'connection.access-deny'
        && entry.itemExists === true && entry.reasonCode === 'connection-item-not-approved'
        && entry.detail === 'outside-admitted-scope')
      && env._vault.auditRows.some((entry) => entry.event === 'connection.access-deny'
        && entry.itemExists === false && entry.reasonCode === 'connection-item-not-found'
        && entry.detail === 'name-not-in-vault'),
      JSON.stringify(env._vault.auditRows.filter((entry) => entry.event === 'connection.access-deny')))

    const getHidden = await mcpCall(env, 'get_secret', { name: ITEM2 })
    const getAbsent = await mcpCall(env, 'get_secret', { name: 'no-such-item-xyz' })
    ok('读取不可见与读取不存在的条目对外逐字节一致',
      mcpText(getHidden).split(ITEM2).join('<name>') === mcpText(getAbsent).split('no-such-item-xyz').join('<name>'),
      mcpText(getHidden) + ' / ' + mcpText(getAbsent))

    // Same trail for both probes: an out-of-scope item must not be cheaper or
    // quieter than a name that does not exist.
    const afterReads = await readState(env)
    const hiddenAttempt = Object.values(afterReads.deniedAttempts ?? {}).find((entry) => entry.name === ITEM2)
    const absentAttempt = Object.values(afterReads.deniedAttempts ?? {}).find((entry) => entry.name === 'no-such-item-xyz')
    ok('范围外读取与不存在读取写同样的 deniedAttempts 汇总',
      Boolean(hiddenAttempt && absentAttempt) && hiddenAttempt.count === 1 && absentAttempt.count === 1
      && hiddenAttempt.reasonCode === absentAttempt.reasonCode
      && hiddenAttempt.reason.split(ITEM2).join('<name>') === absentAttempt.reason.split('no-such-item-xyz').join('<name>'),
      JSON.stringify({ hiddenAttempt, absentAttempt }))
    ok('两条路径都写一条 access.denied 审计',
      env._vault.auditRows.filter((entry) => entry.event === 'access.denied').length === 2,
      JSON.stringify(env._vault.auditRows.filter((entry) => entry.event === 'access.denied')))

    // explain_access used to describe any name the agent asked about: it
    // returned the itemId, classification and policies even for items outside
    // the connection, which confirmed both existence and configuration.
    const exHidden = await mcpCall(env, 'explain_access', { name: ITEM2 })
    const exAbsent = await mcpCall(env, 'explain_access', { name: 'no-such-item-xyz' })
    ok('explain_access 对范围外条目与读取路径同答复', mcpText(exHidden) === mcpText(getHidden), mcpText(exHidden))
    ok('explain_access 对不存在条目与读取路径同答复', mcpText(exAbsent) === mcpText(getAbsent), mcpText(exAbsent))
    ok('explain_access 范围外不再泄露 itemId/分类/策略',
      !mcpText(exHidden).includes(HARNESS.ITEM_ID) && !mcpText(exHidden).includes('"kind"') && !mcpText(exHidden).includes('"policy"'),
      mcpText(exHidden))
    const exState = await readState(env)
    ok('explain_access 范围外不生成待审批',
      Object.keys(exState.pending ?? {}).length === 0
      && env._vault.auditRows.some((entry) => entry.event === 'connection.access-deny'
        && entry.detail === 'explain-outside-admitted-scope' && entry.itemExists === true),
      JSON.stringify(env._vault.auditRows.filter((entry) => entry.event === 'connection.access-deny')))
  }

  // 15: an exhausted capability must not be reported as granted. The status
  // helper used to read maxReads/reads, which only legacy grants carry, so a
  // spent capability looked live forever.
  {
    const env = await freshEnv({
      policy: { required: false },
      extra: {
        policies: {},
        capabilities: {
          [HARNESS.AGENT + '\u0000' + HARNESS.ITEM_ID + '\u0000secret.read']: {
            id: 'cap-spent', subjectId: HARNESS.AGENT, itemId: HARNESS.ITEM_ID, action: 'secret.read',
            accountId: HARNESS.ACCT, createdAt: iso(-60 * 1000), expiresAt: iso(24 * 3600e3),
            maxUses: 1, usedCount: 1, revokedAt: null, policyVersion: 1,
          },
        },
      },
    })
    const listed = await mcpCall(env, 'list_secrets', {})
    const payload = JSON.parse(mcpText(listed))
    const item = (payload.items ?? []).find((entry) => entry.id === HARNESS.ITEM_ID)
    ok('用尽的 capability 在 list_secrets 里不再显示 granted', Boolean(item) && item.grant_status === 'none', mcpText(listed))
  }

  // 16: a plaintext-refused read must not spend the capability it was refused
  // by. The guard used to run after the atomic consume, so one refused attempt
  // exhausted a maxUses=1 capability and the next allowed read looked used-up.
  {
    const capKey = HARNESS.AGENT + '\u0000' + HARNESS.ITEM_ID + '\u0000secret.read'
    const env = await freshEnv({
      policy: { required: false },
      extra: {
        policies: {},
        credentialKinds: { [HARNESS.ITEM_ID]: 'web', [ITEM2_ID]: 'api' },
        capabilities: {
          [capKey]: {
            id: 'cap-plain', subjectId: HARNESS.AGENT, itemId: HARNESS.ITEM_ID, action: 'secret.read',
            accountId: HARNESS.ACCT, createdAt: iso(-60 * 1000), expiresAt: iso(24 * 3600e3),
            maxUses: 1, usedCount: 0, revokedAt: null, policyVersion: 1,
          },
        },
      },
    })
    const refused = await mcpCall(env, 'get_secret', { name: HARNESS.ITEM })
    ok('web 凭据的明文读取被读门拒绝', mcpText(refused).includes('不能读明文'), mcpText(refused))
    const afterRefusal = await readState(env)
    ok('被拒的明文读取没有消耗 capability', afterRefusal.capabilities[capKey].usedCount === 0,
      JSON.stringify(afterRefusal.capabilities[capKey]))
    // The operator's real switch, not a test-only bypass.
    const opened = afterRefusal
    opened.settings = { ...(opened.settings ?? {}), webPlaintext: true }
    await writeState(env, opened)
    const allowed = await mcpCall(env, 'get_secret', { name: HARNESS.ITEM })
    ok('打开明文开关后同一条 capability 仍可用', mcpText(allowed).includes(HARNESS.PASSWORD), mcpText(allowed))
    const afterAllowed = await readState(env)
    ok('成功读取才消耗唯一一次', afterAllowed.capabilities[capKey].usedCount === 1,
      JSON.stringify(afterAllowed.capabilities[capKey]))
  }

  // 17: approving needs the vault key and denying does not — and the lock is
  // the same definition consoleVault uses (a live session *or* a cached v2
  // slot), so the console cannot refuse an approval the server would take.
  {
    const env = await freshEnv()
    const first = await getSecret(env)
    const pending = await first.json()
    const cookie = await login(env)
    // Logged in but locked: the unlocked vault session is gone.
    await env.BROKER_STATE.get().fetch('https://state/session', { method: 'DELETE' })
    const locked = await decide(env, cookie, {
      id: pending.requestId, decision: 'approve', all: true, plaintextAllowed: false, duration: '1h',
    })
    ok('未解锁时批准返回 423', locked.status === 423 && locked.body.error === 'locked', JSON.stringify(locked.body))
    await putSession(env)
    const approved = await decide(env, cookie, {
      id: pending.requestId, decision: 'approve', all: true, plaintextAllowed: false, duration: '1h',
    })
    ok('解锁后同一条申请可以继续批准',
      approved.status === 200 && approved.body.ok === true, JSON.stringify(approved.body))
  }
  {
    const env = await freshEnv()
    const first = await getSecret(env)
    const pending = await first.json()
    const cookie = await login(env)
    await env.BROKER_STATE.get().fetch('https://state/session', { method: 'DELETE' })
    const denied = await decide(env, cookie, { id: pending.requestId, decision: 'deny' })
    ok('未解锁也能拒绝连接', denied.status === 200 && denied.body.ok === true, JSON.stringify(denied.body))
  }

  // 18: the console must not stop at "Vault is locked". The local check mirrors
  // consoleVault, a locked click opens the inline sheet, and the unlock
  // callback resumes the same approval body without a page change.
  {
    ok('UI 的解锁判定同时接受 v1 session 与 v2 槽',
      /function vaultUnlocked\(\)[\s\S]{0,400}app\.v2\.initialized === true && app\.v2\.unlocked === true[\s\S]{0,160}app\.me \? app\.me\.unlocked === true/.test(uiHtml))
    ok('未解锁时批准会先就地解锁并续批',
      /if \(!vaultUnlocked\(\)\) \{[\s\S]{0,260}inlineUnlockSheet\(\(\) => \{ openPendingSheet\(\); decideConnection\(null, body, null, \{ afterUnlock: true \}\) \}\)/.test(uiHtml))
    ok('423 不只提示，还会打开就地解锁并继续这次批准',
      /error\.status === 423[\s\S]{0,700}inlineUnlockSheet\(\(\) => \{ openPendingSheet\(\); decideConnection\(null, body, null, \{ afterUnlock: true \}\) \}\)/.test(uiHtml))
    ok('解锁完成后执行续批回调',
      /if \(typeof options\.after === 'function'\) await options\.after\(\)/.test(uiHtml))
    ok('锁定的连接卡提供「先解锁并回到审批」入口',
      uiHtml.includes('data-conn-unlock') && uiHtml.includes('先解锁并回到审批'))
  }

  // 19: one approval must cover the chosen scope. A connection approval used to
  // only admit the device; every later read/write still asked, which is what
  // "I already granted this and it asks again" described. The admission itself
  // is now the authority and is judged at read/write time, so nothing is
  // pre-minted per item (an item added later is covered too) — the behavioural
  // assertions below are what matters, not the absence of capability rows.
  {
    const env = await freshEnv()
    // The grandfathered helper agent has blanket read. Remove it so the only
    // thing that can authorise a read is the approval under test.
    const seeded = await readState(env)
    seeded.agents[HARNESS.AGENT].legacy = false
    await writeState(env, seeded)
    const first = await getSecret(env)
    const pending = await first.json()
    const cookie = await login(env)
    const approved = await decide(env, cookie, {
      id: pending.requestId, decision: 'approve', itemIds: [HARNESS.ITEM_ID],
      plaintextAllowed: true, writeAllowed: true, duration: '1h',
    })
    ok('一次批准同时记录写入许可',
      approved.status === 200 && approved.body.connection.writeAllowed === true, JSON.stringify(approved.body))
    const state = await readState(env)
    ok('批准只翻写入位，不再批量铸能力或写入票',
      state.agents[HARNESS.AGENT].write === true
      && Object.keys(state.capabilities ?? {}).length === 0
      && Object.keys(state.writeTickets ?? {}).length === 0,
      JSON.stringify({ caps: Object.keys(state.capabilities ?? {}), grants: Object.keys(state.grants ?? {}) }))
    const second = await getSecret(env)
    ok('范围内再次读取不再要求审批', second.status === 200, String(second.status))
    const after = await readState(env)
    ok('再次读取没有新增待批项',
      Object.values(after.connections ?? {}).filter((entry) => entry.state === 'pending').length === 0)
    const writeText = mcpText(await mcpCall(env, 'put_secret', { name: HARNESS.ITEM, value: 'ROTATED-VALUE' }))
    const write = JSON.parse(writeText)
    ok('范围内写入不再逐次询问', write.status === 'written', writeText)
    const outsideText = mcpText(await mcpCall(env, 'put_secret', { name: ITEM2, value: 'OUTSIDE' }))
    const outside = JSON.parse(outsideText)
    ok('范围外写入仍然要审批', outside.status === 'pending-approval', outsideText)
  }

  // 20: the create form no longer asks for scope. An agent created with an empty
  // allow list, approved as all+write, must write without a ticket: the empty
  // creation-time scope must not veto the approval the operator just gave.
  {
    const env = await freshEnv()
    const seeded = await readState(env)
    Object.assign(seeded.agents[HARNESS.AGENT], { allow: [], groups: [], allowAll: false, write: false, legacy: false })
    await writeState(env, seeded)
    const first = await getSecret(env)
    const pending = await first.json()
    const cookie = await login(env)
    const approved = await decide(env, cookie, {
      id: pending.requestId, decision: 'approve', all: true, plaintextAllowed: true, writeAllowed: true, duration: '1h',
    })
    ok('批准 all+write 时即使创建范围为空也生效',
      approved.status === 200 && approved.body.connection.writeAllowed === true, JSON.stringify(approved.body))
    const afterApprove = await readState(env)
    ok('批准把创建时关闭的写入位打开',
      afterApprove.agents[HARNESS.AGENT].write === true, JSON.stringify(afterApprove.agents[HARNESS.AGENT]))

    const existing = JSON.parse(mcpText(await mcpCall(env, 'put_secret', { name: HARNESS.ITEM, value: 'EMPTY-SCOPE-OK' })))
    ok('空创建范围不再反拒已批准范围内的写入', existing.status === 'written', JSON.stringify(existing))
    const fresh = JSON.parse(mcpText(await mcpCall(env, 'put_secret', { name: 'brand-new-item', value: 'NEW' })))
    ok('all 范围覆盖批准后新建的条目', fresh.status === 'written', JSON.stringify(fresh))

    // 21: the admission is editable. Narrow it to one item and the other write
    // must be asked again immediately, without waiting for the TTL.
    const narrowed = await call(env, '/api/connections/admission/update', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ agent: HARNESS.AGENT, all: false, itemIds: [HARNESS.ITEM_ID], plaintextAllowed: true, writeAllowed: true, duration: '1h' }),
    })
    const narrowedBody = await narrowed.json()
    ok('修改准入返回 200 并保存新范围',
      narrowed.status === 200 && narrowedBody.connection.scope.all === false
      && JSON.stringify(narrowedBody.connection.scope.itemIds) === JSON.stringify([HARNESS.ITEM_ID]),
      JSON.stringify(narrowedBody))
    const outsideAfter = mcpText(await mcpCall(env, 'put_secret', { name: 'brand-new-item', value: 'NOW-OUTSIDE' }))
    ok('缩小范围后立即对范围外写入拒绝', outsideAfter.includes('outside the agent scope') && !outsideAfter.includes('"written"'), outsideAfter)
    const insideAfter = JSON.parse(mcpText(await mcpCall(env, 'put_secret', { name: HARNESS.ITEM, value: 'STILL-OK' })))
    ok('缩小范围后范围内写入仍然通过', insideAfter.status === 'written', JSON.stringify(insideAfter))

    // 22: revoking the admission takes effect immediately, and the write flag it
    // switched on is switched back off.
    const revoked = await call(env, '/api/connections/admission/revoke', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ agent: HARNESS.AGENT }),
    })
    const revokedBody = await revoked.json()
    ok('撤销准入返回 200 且状态为 revoked',
      revoked.status === 200 && revokedBody.connection.state === 'revoked', JSON.stringify(revokedBody))
    const afterRevoke = await readState(env)
    ok('撤销立即结束准入而不是等过期',
      afterRevoke.connections[revokedBody.connection.id].state === 'revoked'
      && Date.parse(afterRevoke.connections[revokedBody.connection.id].expiresAt) <= Date.now() + 5000,
      JSON.stringify(afterRevoke.connections[revokedBody.connection.id]))
    ok('撤销把本次准入打开的写入位关回去',
      afterRevoke.agents[HARNESS.AGENT].write === false, JSON.stringify(afterRevoke.agents[HARNESS.AGENT]))
    const nextRead = await getSecret(env)
    const nextBody = await nextRead.json()
    ok('撤销后下一次调用重新申请准入，而不是沿用旧批准',
      nextRead.status === 202 && nextBody.status === 'pending-connection' && nextBody.requestId !== revokedBody.connection.id,
      JSON.stringify(nextBody))
    ok('修改与撤销都写入审计',
      env._vault.auditRows.some((entry) => entry.event === 'connection.update')
      && env._vault.auditRows.some((entry) => entry.event === 'connection.revoke'))
  }

  // 23: existing agents keep their creation-time allow list. The new form omits
  // scope, so an unrelated edit must not clear it.
  {
    const env = await freshEnv()
    const cookie = await login(env)
    const before = (await readState(env)).agents[HARNESS.AGENT]
    const edited = await call(env, '/api/agents/update', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: HARNESS.AGENT, alias: 'renamed' }),
    })
    const afterEdit = (await readState(env)).agents[HARNESS.AGENT]
    ok('不带范围的编辑保留旧的长期范围',
      edited.status === 200 && JSON.stringify(afterEdit.allow) === JSON.stringify(before.allow)
      && JSON.stringify(afterEdit.groups) === JSON.stringify(before.groups), JSON.stringify(afterEdit))

    const created = await call(env, '/api/agents/create', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'new-agent', alias: '', note: '' }),
    })
    const createdBody = await created.json()
    const fresh = (await readState(env)).agents['new-agent'] ?? {}
    ok('新表单只建身份，不再预置范围或写入',
      created.status === 200 && Boolean(createdBody.token)
      && Array.isArray(fresh.allow) && fresh.allow.length === 0 && fresh.write !== true,
      JSON.stringify(fresh))
  }

  report.finish()
}

await main()
