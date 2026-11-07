/**
 * 0.8.9 round: "approval is the second factor" + permanent unlock + signed
 * notification links. Pure Node, no workerd.
 *
 * Run: node --import ./test-support/register.mjs test-approval-forever-link.mjs
 */
import { createHash } from 'node:crypto'
import { hmacToken } from './src/crypto.js'
import {
  HARNESS, makeEnv, seedState, tokenHash, call, login, makeReporter,
  FakeD1, legacyCipherRow, mcpCall, mcpText,
} from './test-support/broker-harness.mjs'

const { pass, fail, finish } = makeReporter()
function ok(name, condition, detail = '') {
  if (condition) pass(name)
  else fail(name, detail)
}
const DEK = Array.from({ length: 32 }, (_, i) => i + 1)
const LEGACY = Array.from({ length: 32 }, (_, i) => 255 - i)
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()

async function readState(env) {
  const response = await env.BROKER_STATE.get().fetch('https://state/state')
  return (await response.json()).state ?? {}
}
async function writeState(env, state) {
  await env.BROKER_STATE.get().fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
}
const keyUrl = (session, account) => '/v2-key?account=' + encodeURIComponent(account) + '&session=' + encodeURIComponent(session)
async function keyCall(env, path, method = 'GET', body) {
  const response = await env.BROKER_STATE.get().fetch('https://state' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}
async function putPermanent(env, account = HARNESS.ACCT) {
  return await keyCall(env, keyUrl('', account), 'PUT', {
    dek: DEK, legacyDek: LEGACY, ttlMs: null, duration: 'forever', plainOk: true, factorVerified: true,
  })
}
async function signLink(kind, id, exp) {
  const key = new Uint8Array(createHash('sha256').update('cookie:' + String(HARNESS.KEK)).digest())
  return await hmacToken(key, `approval-link:${kind}:${id}:${exp}`)
}
async function issueLink(env, kind, id, ttlMs = 30 * 60 * 1000) {
  const exp = Date.now() + ttlMs
  const sig = await signLink(kind, id, exp)
  const state = await readState(env)
  state.approvalLinks ??= {}
  state.approvalLinks[sig] = { kind, id, exp, createdAt: iso(), source: 'test' }
  await writeState(env, state)
  return `/approve?k=${kind}&id=${encodeURIComponent(id)}&exp=${exp}&sig=${encodeURIComponent(sig)}&ch=test`
}
function cookieSession(cookie) {
  // login() returns the first Set-Cookie pair, which still carries its name
  // (e.g. sb_session=v2.<id>.<exp>.<sig>). The session id is the value's second
  // dot-separated field, not the second field of the whole header.
  let value = String(cookie || '')
  const eq = value.indexOf('=')
  if (eq !== -1) value = value.slice(eq + 1)
  if (!value.startsWith('v2.')) return ''
  return value.split('.')[1] ?? ''
}
function jsonOf(text) {
  try { return JSON.parse(text) } catch { return { raw: String(text) } }
}

async function freshEnv({ connections = {}, pending = {}, agents = {}, policy = { required: false }, legacyRow = true } = {}) {
  const legacy = new FakeD1({ cipherRows: legacyRow ? [await legacyCipherRow()] : [] })
  // The write cases go through the v2 table, so the store must look
  // initialised here or vault2Context declines the key and the write falls back
  // to the legacy cipher path (which this fixture has no key material for).
  const vault = new FakeD1({ v2Initialized: true })
  const env = makeEnv({ legacy, vault })
  await seedState(env, {
    connectionPolicy: policy,
    agents: {
      [HARNESS.AGENT]: {
        hash: await tokenHash(), allow: [], groups: [], allowAll: false, write: true,
        legacy: false, account: HARNESS.ACCT, createdAt: '2027-01-01T00:00:00.000Z',
        ...(agents[HARNESS.AGENT] ?? {}),
      },
    },
    policies: {},
    connections,
    pending,
    itemIds: { [HARNESS.ITEM]: HARNESS.ITEM_ID },
    credentialKinds: { [HARNESS.ITEM_ID]: 'api' },
  })
  return env
}
function connectionRecord(overrides = {}) {
  return {
    id: 'conn-link', agent: HARNESS.AGENT, account: HARNESS.ACCT,
    source: { ipHash: 'ip:unknown' }, origin: 'https://broker.test',
    createdAt: iso(-2 * 60 * 1000), expiresAt: iso(10 * 60 * 1000),
    state: 'pending', requestedScope: { all: true, itemIds: [] }, requestedPlaintext: false,
    scope: null, plaintextAllowed: null, ttlMs: null, decidedAt: null, decidedBy: null, reasonCode: null,
    ...overrides,
  }
}

async function main() {
  // 1. permanent slot: no expiry, survives an object restart, and a lock kills
  //    the wrapped copy (not just the slot).
  {
    const env = await freshEnv()
    const put = await putPermanent(env)
    const got = await keyCall(env, keyUrl('', HARNESS.ACCT))
    ok('1a 永久解锁槽 expiresAt 为 null（不是 0，也不是按时长截断）',
      put.status === 200 && got.status === 200 && got.body.expiresAt === null,
      `put=${put.status} get=${got.status} expiresAt=${JSON.stringify(got.body.expiresAt)}`)
    const backup = Object.entries(env._store || {}).find(([name]) => name.startsWith('v2backup:'))
    ok('1b 存在被 SESSION_KEK 包裹的副本，且不以明文保存 32 字节密钥',
      Boolean(backup) && typeof backup[1].dek === 'string' && !JSON.stringify(backup[1]).includes(DEK.join(',')),
      backup ? String(backup[1].dek).slice(0, 24) : 'missing')
    const cookie = await login(env)
    const locked = await call(env, '/api/lock', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }),
    })
    const after = await keyCall(env, keyUrl('', HARNESS.ACCT))
    const backups = Object.keys(env._store || {}).filter((name) => name.startsWith('v2backup:'))
    ok('1c 主动锁定后：槽 401、包裹副本被删除（副本为空而不是仅槽为空）',
      locked.status === 200 && after.status === 401 && backups.length === 0,
      `lock=${locked.status} slot=${after.status} backups=${backups.length}`)
  }

  // 2. Notification link: login first, render the request, one POST approves,
  //    replay/tamper rejected, and the session gets an approval factor pass.
  {
    const env = await freshEnv({ connections: { 'conn-link': connectionRecord() } })
    await putPermanent(env)
    const link = await issueLink(env, 'connection', 'conn-link')
    const cookie = await login(env)
    const anon = await call(env, link)
    const anonLocation = String(anon.headers.get('location') || '')
    ok('2a 未登录点链接会带 next= 回到原请求，而不是落到首页',
      anon.status === 302 && anonLocation.startsWith('/login?next=') && anonLocation.includes('%2Fapprove'),
      `status=${anon.status} location=${anonLocation.slice(0, 120)}`)
    const page = await call(env, link, { headers: { cookie } })
    const html = await page.text()
    ok('2b 登录后直接落到该请求的批准页，范围/明文/写入/时长都在同一张表单',
      page.status === 200 && html.includes('确认首次连接')
        && html.includes('name="scope"') && html.includes('name="plaintextAllowed"')
        && html.includes('name="writeAllowed"') && html.includes('name="duration"'),
      `status=${page.status}`)
    const form = new URLSearchParams({
      k: 'connection', id: 'conn-link', exp: String(new URL('https://x' + link).searchParams.get('exp')),
      sig: String(new URL('https://x' + link).searchParams.get('sig')), ch: 'test',
      scope: 'all', plaintextAllowed: 'on', writeAllowed: 'on', duration: 'always',
    })
    const approved = await call(env, '/approve', {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    })
    const state = await readState(env)
    const record = state.connections['conn-link']
    ok('2c 一次 POST 完成批准：scope all + 明文 + 写入 + 永久时长',
      approved.status === 200 && record.state === 'approved' && record.scope.all === true
        && record.plaintextAllowed === true && record.writeAllowed === true && record.expiresAt === null,
      JSON.stringify({ status: approved.status, scope: record.scope, plain: record.plaintextAllowed, write: record.writeAllowed, exp: record.expiresAt }))
    const factorKey = env._store['v2factor:' + cookieSession(cookie)]
    const factorKeys = Object.keys(env._store).filter((name) => name.startsWith('v2factor:'))
    ok('2d 该管理员会话拿到审批 factor pass，且是长期 pass（槽为永久）',
      Boolean(factorKey) && Number(factorKey.expiresAt) > Date.now() + 24 * 3600e3,
      JSON.stringify({ wanted: 'v2factor:' + cookieSession(cookie), have: factorKeys, value: factorKey }))
    ok('2e 审计写入 session.factor(reason=approval) 与 approval.link-used',
      (env._vault.auditRows || []).some((entry) => entry.event === 'session.factor' && entry.reason === 'approval' && entry.grantId === 'conn-link')
        && (env._vault.auditRows || []).some((entry) => entry.event === 'approval.link-used' && entry.requestId === 'conn-link'),
      JSON.stringify((env._vault.auditRows || []).map((entry) => entry.event)))
    const replay = await call(env, '/approve', {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    })
    const tampered = await call(env, '/approve?' + new URLSearchParams({
      k: 'connection', id: 'conn-other', exp: form.get('exp'), sig: form.get('sig'), ch: 'test',
    }))
    ok('2f 重复使用 410；改 id 不能换到别的请求', replay.status === 410 && tampered.status === 410,
      `replay=${replay.status} tamper=${tampered.status}`)
  }

  // 3. Item link: the pending sheet's signed link approves a read request
  //    without a second jump, and the pending row disappears.
  {
    const env = await freshEnv({ policy: { required: false } })
    await putPermanent(env)
    await seedState(env, {
      connectionPolicy: { required: false },
      agents: {
        [HARNESS.AGENT]: {
          hash: await tokenHash(), allow: [HARNESS.ITEM], groups: [], allowAll: false, write: true,
          legacy: false, account: HARNESS.ACCT, createdAt: '2027-01-01T00:00:00.000Z',
        },
      },
      policies: {},
      itemIds: { [HARNESS.ITEM]: HARNESS.ITEM_ID },
      credentialKinds: { [HARNESS.ITEM_ID]: 'api' },
    })
    const first = await mcpCall(env, 'request_access', { name: HARNESS.ITEM })
    const payload = JSON.parse(mcpText(first))
    const requestId = String(payload.request_id ?? '')
    const cookie = await login(env)
    const link = await issueLink(env, 'pending', requestId, 10 * 60 * 1000)
    const page = await call(env, link, { headers: { cookie } })
    ok('3a 条目申请的链接落到确认页', page.status === 200 && (await page.text()).includes('确认读取'))
    const form = new URLSearchParams({
      k: 'pending', id: requestId, d: '24h',
      exp: String(new URL('https://x' + link).searchParams.get('exp')),
      sig: String(new URL('https://x' + link).searchParams.get('sig')), ch: 'test',
    })
    const approved = await call(env, '/approve', {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    })
    const after = await readState(env)
    ok('3b 一次提交完成授权，pending 行被消费',
      approved.status === 200 && !after.pending?.[requestId],
      `status=${approved.status} pending=${Object.keys(after.pending ?? {}).length}`)
    const replay = await call(env, '/approve', {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    })
    ok('3c 同一链接第二次提交被拒', replay.status === 410, `status=${replay.status}`)
  }

  // 4. Locked/no slot: the approval path says "unlock once", never "Vault 已锁定".
  {
    const env = await freshEnv({ connections: { 'conn-locked': connectionRecord({ id: 'conn-locked' }) } })
    const cookie = await login(env)
    const link = await issueLink(env, 'connection', 'conn-locked')
    const form = new URLSearchParams({
      k: 'connection', id: 'conn-locked',
      exp: String(new URL('https://x' + link).searchParams.get('exp')),
      sig: String(new URL('https://x' + link).searchParams.get('sig')), ch: 'test',
      scope: 'all', duration: '24h',
    })
    const response = await call(env, '/approve', {
      method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    })
    const text = await response.text()
    ok('4a 无解锁槽时返回 428 且是「先解锁一次」的可读文案',
      response.status === 428 && text.includes('解锁') && !text.includes('Vault 已锁定'),
      `status=${response.status} text=${text.slice(0, 100)}`)
  }

  // 5. Write side: an approved write admission (scope all) survives a lock
  //    decision only while the slot is live; after approval the write works.
  {
    const env = await freshEnv({
      legacyRow: false,
      policy: { required: true },
      connections: { 'conn-write': connectionRecord({
        id: 'conn-write', state: 'approved', scope: { all: true, itemIds: [] },
        plaintextAllowed: true, writeAllowed: true, decidedAt: iso(-60 * 1000), expiresAt: null, ttlMs: 0,
      }) },
    })
    await putPermanent(env)
    const saved = await call(env, '/agent/items/save', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + HARNESS.AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ name: HARNESS.ITEM, value: 'NEW_VALUE', group: 'g1' }),
    })
    const savedText = await saved.text()
    ok('5a 无 legacy 会话、agent 空 allow、批准 write+scope all：save 不被 agentInScope 拦回',
      saved.status === 200 && !savedText.includes('not allowed'),
      `status=${saved.status} body=${savedText.slice(0, 100)}`)
    const put = await mcpCall(env, 'put_secret', { name: 'new-item', value: 'NEW_VALUE' })
    const putPayload = jsonOf(mcpText(put))
    ok('5b 无 legacy 会话也能 put_secret（用长期解锁槽，不再要验证码/密码）',
      putPayload.status === 'written',
      mcpText(put).slice(0, 140))
    const lock = await call(env, '/api/lock', {
      method: 'POST', headers: { cookie: await login(env), 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }),
    })
    const afterLock = await mcpCall(env, 'put_secret', { name: 'after-lock', value: 'X' })
    const afterText = mcpText(afterLock)
    ok('5c 锁定后写入被拒并要求重新解锁（不是静默成功）',
      lock.status === 200 && afterText.includes('vault locked'),
      `lock=${lock.status} write=${afterText.slice(0, 100)}`)
  }

  // 6. Expired grant stops the write; revocation stops it immediately.
  {
    const expired = connectionRecord({
      id: 'conn-expired', state: 'approved', scope: { all: true, itemIds: [] },
      plaintextAllowed: true, writeAllowed: true, decidedAt: iso(-2 * 60 * 60 * 1000), expiresAt: iso(-60 * 1000), ttlMs: 0,
    })
    const env = await freshEnv({ policy: { required: true }, connections: { [expired.id]: expired } })
    await putPermanent(env)
    const write1 = await mcpCall(env, 'put_secret', { name: 'expired-item', value: 'X' })
    const body1 = jsonOf(mcpText(write1))
    ok('6a 授权到期后写入不再放行，改为新的待批', body1.status === 'pending-connection', mcpText(write1).slice(0, 140))
    const revoked = connectionRecord({
      id: 'conn-revoked', state: 'revoked', scope: { all: true, itemIds: [] },
      plaintextAllowed: true, writeAllowed: true, decidedAt: iso(-60 * 1000), expiresAt: null, ttlMs: 0,
    })
    const env2 = await freshEnv({ policy: { required: true }, connections: { [revoked.id]: revoked } })
    await putPermanent(env2)
    const write2 = await mcpCall(env2, 'put_secret', { name: 'revoked-item', value: 'X' })
    const body2 = jsonOf(mcpText(write2))
    // A revoked row is live by expiry but its state is not 'approved', so the
    // admission answers "connection-expired"; either refused status is correct.
    ok('6b 撤销授权立即失效（写入变为待批/被拒，不是成功）',
      body2.status === 'pending-connection' || body2.status === 'connection-expired',
      mcpText(write2).slice(0, 140))
  }

  await finish()
}

main().catch((error) => { console.error(error); process.exit(1) })
