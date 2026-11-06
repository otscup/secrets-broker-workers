/**
 * Item approvals: a waiting client gets the operator's answer in the same call.
 * /api/pending/status long-polls a request id, "decided" means replay the
 * original tool, and a refusal is returned as a refusal instead of becoming a
 * fresh approval prompt. The CLI bridge is exercised for real (parse, wait,
 * replay), because that is the code an agent actually runs.
 *
 * Run: node --import ./test-support/register.mjs test-pending-approval.mjs
 */
import {
  HARNESS, makeEnv, seedState, putSession, call, login, makeReporter,
  FakeD1, legacyCipherRow, tokenHash, mcpCall, mcpText,
} from './test-support/broker-harness.mjs'
import { createBridge } from './cli/bridge.mjs'

const report = makeReporter()
function ok(name, condition, detail = '') {
  if (condition) report.pass(name)
  else report.fail(name, detail)
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function readState(env) {
  const response = await env.BROKER_STATE.get().fetch('https://state/state')
  return (await response.json()).state ?? {}
}

async function freshEnv() {
  const legacy = new FakeD1({ cipherRows: [await legacyCipherRow()] })
  const env = makeEnv({ legacy })
  await seedState(env, {
    // No connection admission here: this suite is about the per-item approval
    // wait, and an admitted connection would answer the read itself.
    connectionPolicy: { required: false },
    agents: {
      [HARNESS.AGENT]: {
        hash: await tokenHash(), allow: [HARNESS.ITEM], groups: [], allowAll: false,
        // Non-legacy: the name is in scope, but nothing grants the read yet,
        // so the request has to ask the operator.
        write: true, legacy: false, account: HARNESS.ACCT, createdAt: '2027-01-01T00:00:00.000Z',
      },
    },
    policies: {},
    itemIds: { [HARNESS.ITEM]: HARNESS.ITEM_ID },
    credentialKinds: { [HARNESS.ITEM_ID]: 'api' },
  })
  await putSession(env)
  return env
}

function statusCall(env, id, wait = '') {
  return call(env, '/api/pending/status?id=' + encodeURIComponent(id) + (wait ? '&wait=' + wait : ''), {
    headers: { authorization: 'Bearer ' + HARNESS.AUTH },
  })
}

async function decide(env, cookie, body) {
  const response = await call(env, '/api/pending/decide', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

function pendingOf(raw) {
  return JSON.parse(raw)
}

function fetchTo(env) {
  return async (url, init = {}) => {
    const target = new URL(String(url))
    return call(env, target.pathname + target.search, init)
  }
}

async function main() {
  // 1: the pending payload tells the caller where to wait, and the wait
  // endpoint answers "pending" without failing.
  {
    const env = await freshEnv()
    const first = await mcpCall(env, 'request_access', { name: HARNESS.ITEM })
    const pending = pendingOf(mcpText(first))
    ok('读取申请被拦时返回 pending 与 request_id',
      pending.status === 'pending' && Boolean(pending.request_id), mcpText(first))
    ok('pending 载荷给出等待地址与等待时长',
      String(pending.waitUrl).includes('/api/pending/status?id=') && pending.waitSeconds === 30 && pending.retryAfterMs > 0,
      JSON.stringify(pending))

    const waiting = await statusCall(env, pending.request_id)
    const body = await waiting.json()
    ok('未决定时返回 pending + retryAfterMs',
      waiting.status === 200 && body.status === 'pending' && body.retryAfterMs === 2000, JSON.stringify(body))
  }

  // 2: a long poll approved in flight answers "decided/allow" and the replay
  // returns the value. No second request is created.
  {
    const env = await freshEnv()
    const first = await mcpCall(env, 'request_access', { name: HARNESS.ITEM })
    const pending = pendingOf(mcpText(first))
    const cookie = await login(env)
    const started = Date.now()
    const approval = (async () => {
      await pause(600)
      return decide(env, cookie, { id: pending.request_id, decision: '1h' })
    })()
    const response = await statusCall(env, pending.request_id, '3')
    const body = await response.json()
    const approved = await approval
    const elapsed = Date.now() - started
    ok('长轮询在批准后返回 decided/allow',
      response.status === 200 && body.status === 'decided' && body.decision === 'allow',
      JSON.stringify(body))
    ok('长轮询确实按 wait 挂起', elapsed >= 500, String(elapsed))
    ok('批准调用成功', approved.status === 200, JSON.stringify(approved.body))
    const replayed = await mcpCall(env, 'request_access', { name: HARNESS.ITEM })
    ok('批准后重放申请返回已授权', mcpText(replayed).includes('access already allowed'), mcpText(replayed))
    const replay = await mcpCall(env, 'get_secret', { name: HARNESS.ITEM })
    ok('批准后读取拿到值', mcpText(replay).includes(HARNESS.PASSWORD), mcpText(replay))
    const after = await readState(env)
    ok('批准后没有新增待审批', Object.keys(after.pending ?? {}).length === 0
      && Object.keys(after.pendingResults ?? {}).length === 1)
    ok('批准的结果记在该申请名下', after.pendingResults?.[pending.request_id]?.decision === 'allow'
      && after.pendingResults?.[pending.request_id]?.action === 'secret.read',
      JSON.stringify(after.pendingResults))
    ok('批准写入 request.approve 审计', env._vault.auditRows.some((entry) => entry.event === 'request.approve'),
      JSON.stringify(env._vault.auditRows.map((entry) => entry.event)))
  }

  // 3: a denied request answers "decided/deny" with the reason code, and the
  // replay returns the refusal. It must not queue the same question again.
  {
    const env = await freshEnv()
    const first = await mcpCall(env, 'request_access', { name: HARNESS.ITEM })
    const pending = pendingOf(mcpText(first))
    const cookie = await login(env)
    const denied = await decide(env, cookie, { id: pending.request_id, decision: 'deny' })
    ok('拒绝返回 200', denied.status === 200 && denied.body.ok === true, JSON.stringify(denied.body))
    const response = await statusCall(env, pending.request_id)
    const body = await response.json()
    ok('拒绝后状态返回 decided/deny 与原因码',
      response.status === 200 && body.status === 'decided' && body.decision === 'deny'
      && body.reasonCode === 'approval-denied', JSON.stringify(body))
    const replay = await mcpCall(env, 'request_access', { name: HARNESS.ITEM })
    ok('拒绝后重放带回拒绝原因',
      mcpText(replay).includes('管理员拒绝了这次申请'), mcpText(replay))
    const after = await readState(env)
    ok('拒绝后的重放没有再生成待审批', Object.keys(after.pending ?? {}).length === 0, JSON.stringify(after.pending))
    const again = await mcpCall(env, 'request_access', { name: HARNESS.ITEM })
    ok('短时间内重复重放仍得到同一条拒绝', mcpText(again).includes('管理员拒绝了这次申请'), mcpText(again))
    const afterAgain = await readState(env)
    ok('重复重放依旧不产生新的待审批', Object.keys(afterAgain.pending ?? {}).length === 0)
  }

  // 4: a write denial follows the same rule, and is not answered by a read.
  {
    const env = await freshEnv()
    const first = await mcpCall(env, 'put_secret', { name: HARNESS.ITEM, value: 'ROTATED' })
    const pending = pendingOf(mcpText(first))
    ok('写入被拦时返回 pending-approval', pending.status === 'pending-approval' && Boolean(pending.requestId), mcpText(first))
    const cookie = await login(env)
    await decide(env, cookie, { id: pending.requestId, decision: 'deny' })
    const replay = await mcpCall(env, 'put_secret', { name: HARNESS.ITEM, value: 'ROTATED' })
    ok('写入拒绝后重放带回拒绝原因',
      mcpText(replay).includes('管理员拒绝了这次写入申请'), mcpText(replay))
    // A read is a different question and must still be asked.
    const read = await mcpCall(env, 'request_access', { name: HARNESS.ITEM })
    ok('写入被拒不等于读取被拒', pendingOf(mcpText(read)).status === 'pending', mcpText(read))
    const after = await readState(env)
    ok('读取申请仍在待审批', Object.keys(after.pending ?? {}).length === 1)
  }

  // 5: the CLI bridge waits and then replays the exact call, so the agent gets
  // the value without retrying by hand.
  {
    const env = await freshEnv()
    const cookie = await login(env)
    const originalFetch = globalThis.fetch
    const bridge = createBridge({ brokerUrl: 'https://broker.test', staticToken: HARNESS.AUTH, opener: () => true })
    globalThis.fetch = fetchTo(env)
    try {
      const callPromise = bridge.request({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'request_access', arguments: { name: HARNESS.ITEM } },
      })
      let state = await readState(env)
      for (let i = 0; i < 100 && !Object.keys(state.pending ?? {}).length; i++) {
        await pause(25)
        state = await readState(env)
      }
      const id = Object.keys(state.pending ?? {})[0]
      ok('CLI 首次调用产生了条目待审批', Boolean(id))
      await pause(300)
      await decide(env, cookie, { id, decision: '1h' })
      const text = await callPromise
      const value = JSON.parse(text)?.result?.content?.[0]?.text ?? ''
      ok('CLI 在批准后自动重放并返回已授权', String(value).includes('access already allowed'), String(value).slice(0, 200))
      const read = await mcpCall(env, 'get_secret', { name: HARNESS.ITEM })
      ok('CLI 批准后读取拿到值', mcpText(read).includes(HARNESS.PASSWORD), mcpText(read))
      const after = await readState(env)
      ok('CLI 等待没有重复提交申请', Object.keys(after.pending ?? {}).length === 0
        && env._vault.auditRows.filter((entry) => entry.event === 'request.create').length === 1,
      JSON.stringify(env._vault.auditRows.map((entry) => entry.event)))
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  // 6: the bridge surfaces the refusal instead of waiting out the window.
  {
    const env = await freshEnv()
    const cookie = await login(env)
    const originalFetch = globalThis.fetch
    const bridge = createBridge({ brokerUrl: 'https://broker.test', staticToken: HARNESS.AUTH, opener: () => true })
    globalThis.fetch = fetchTo(env)
    try {
      const callPromise = bridge.request({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'request_access', arguments: { name: HARNESS.ITEM } },
      })
      let state = await readState(env)
      for (let i = 0; i < 100 && !Object.keys(state.pending ?? {}).length; i++) {
        await pause(25)
        state = await readState(env)
      }
      const id = Object.keys(state.pending ?? {})[0]
      await pause(300)
      await decide(env, cookie, { id, decision: 'deny' })
      const text = await callPromise
      const value = JSON.parse(text)?.result?.content?.[0]?.text ?? ''
      ok('CLI 在拒绝后结束等待并返回原因', String(value).includes('管理员拒绝了这次申请'), String(value).slice(0, 240))
      const after = await readState(env)
      ok('CLI 拒绝后没有残留待审批', Object.keys(after.pending ?? {}).length === 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  report.finish()
}

await main()
