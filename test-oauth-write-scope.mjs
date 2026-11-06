/**
 * OAuth consent: one page must be able to hand over read scope, plaintext,
 * write and a duration; the admission is written at consent time so the first
 * MCP call is already admitted; and a grant longer than a day gets a refresh
 * token instead of forcing a new consent every 24 hours.
 *
 * Run: node --import ./test-support/register.mjs test-oauth-write-scope.mjs
 */
import {
  HARNESS, makeEnv, seedState, putSession, call, login, makeReporter,
  FakeD1, legacyCipherRow, mcpText,
} from './test-support/broker-harness.mjs'

const report = makeReporter()
function ok(name, condition, detail = '') {
  if (condition) report.pass(name)
  else report.fail(name, detail)
}

const REDIRECT = 'https://client.test/callback'
const encoder = new TextEncoder()
function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function pkce() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64Url(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)))
  return { verifier, challenge }
}

async function readState(env) {
  const response = await env.BROKER_STATE.get().fetch('https://state/state')
  return (await response.json()).state ?? {}
}

async function freshEnv() {
  const env = makeEnv({ legacy: new FakeD1({ cipherRows: [await legacyCipherRow()] }) })
  await seedState(env, {
    connectionPolicy: { required: true },
    agents: {},
    policies: { [HARNESS.ITEM]: { noApproval: true } },
    itemIds: { [HARNESS.ITEM]: HARNESS.ITEM_ID },
    credentialKinds: { [HARNESS.ITEM_ID]: 'api' },
  })
  await putSession(env)
  return env
}

async function register(env) {
  const response = await call(env, '/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test Agent', redirect_uris: [REDIRECT] }),
  })
  return (await response.json()).client_id
}

async function consentPage(env, cookie, clientId, scope) {
  const query = new URLSearchParams({
    client_id: clientId, redirect_uri: REDIRECT, state: 'xyz',
    code_challenge: 'challenge', code_challenge_method: 'S256', scope,
  })
  const response = await call(env, '/oauth/authorize?' + query.toString(), {
    headers: { cookie },
  })
  return { status: response.status, html: await response.text() }
}

async function authorize(env, cookie, clientId, { scope = 'secrets.read secrets.write', extra = {} } = {}) {
  const { verifier, challenge } = await pkce()
  const form = new URLSearchParams({
    client_id: clientId, redirect_uri: REDIRECT, state: 'xyz',
    code_challenge: challenge, code_challenge_method: 'S256', scope,
    decision: 'allow', grant_all: '1', grant_plaintext: '1', grant_hours: '24',
    ...extra,
  })
  const response = await call(env, '/oauth/authorize', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  const location = String(response.headers.get('location') ?? '')
  const code = new URL(location).searchParams.get('code') ?? ''
  return { status: response.status, code, location, verifier }
}

async function exchange(env, clientId, code, verifier) {
  const response = await call(env, '/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT,
      client_id: clientId, code_verifier: verifier,
    }).toString(),
  })
  return { status: response.status, body: await response.json() }
}

async function refresh(env, clientId, refreshToken) {
  const response = await call(env, '/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }).toString(),
  })
  return { status: response.status, body: await response.json() }
}

async function mcpAs(env, token, tool, args = {}) {
  const response = await call(env, '/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  })
  return { status: response.status, body: await response.json() }
}

async function connected(env, cookie, clientId, options = {}) {
  const auth = await authorize(env, cookie, clientId, options)
  const token = await exchange(env, clientId, auth.code, auth.verifier)
  return token
}

async function main() {
  const env = await freshEnv()
  const cookie = await login(env)
  const clientId = await register(env)
  ok('注册返回 client_id', Boolean(clientId))

  // 1: the write switch only exists when the client asked for the scope.
  {
    const readOnly = await consentPage(env, cookie, clientId, 'secrets.read')
    ok('只请求读时同意页不出现写开关',
      readOnly.status === 200 && !readOnly.html.includes('name="grant_write"'), String(readOnly.status))
    const writable = await consentPage(env, cookie, clientId, 'secrets.read secrets.write')
    ok('请求写时同意页出现写开关',
      writable.status === 200 && writable.html.includes('name="grant_write"'))
    ok('同意页同时给出时长选择', writable.html.includes('name="grant_hours"') && writable.html.includes('7 天'))
  }

  // 2: ticking write + 7 days yields write authority, a refresh token and one
  // admission that covers the first MCP call (no second connection approval).
  let accessToken = ''
  let refreshToken = ''
  {
    const token = await connected(env, cookie, clientId, { extra: { grant_write: '1', grant_hours: '168' } })
    ok('授权码换到 token', token.status === 200 && Boolean(token.body.access_token), JSON.stringify(token.body))
    accessToken = token.body.access_token
    refreshToken = token.body.refresh_token ?? ''
    ok('token 的 scope 包含 secrets.write', String(token.body.scope).includes('secrets.write'), String(token.body.scope))
    ok('超过 24 小时的授权同时发 refresh token', Boolean(refreshToken))
    ok('access token 仍按 24 小时封顶', token.body.expires_in === 86400, String(token.body.expires_in))

    const state = await readState(env)
    const records = Object.values(state.connections ?? {}).filter((entry) => entry.agent === 'oauth:' + clientId)
    ok('同意时写入一条 approved admission', records.length === 1 && records[0].state === 'approved', records.length)
    const admission = records[0]
    ok('admission 带上范围、明文、写入与时长',
      admission.scope?.all === true && admission.plaintextAllowed === true
      && admission.writeAllowed === true && admission.ttlMs === 168 * 3600e3,
      JSON.stringify({ scope: admission.scope, p: admission.plaintextAllowed, w: admission.writeAllowed, ttl: admission.ttlMs }))
    ok('admission 到期时间等于所选时长',
      Math.abs(Date.parse(admission.expiresAt) - (Date.now() + 168 * 3600e3)) < 5 * 60e3, admission.expiresAt)
    const profile = state.oauthAgentProfiles?.['oauth:' + clientId]
    ok('token 记录保存 scope，profile 置写入位',
      String(state.oauthTokens?.[Object.keys(state.oauthTokens)[0]]?.scope ?? '').includes('secrets.write')
      && profile?.write === true)

    const read = await mcpAs(env, accessToken, 'get_secret', { name: HARNESS.ITEM })
    ok('首个 MCP 读取不再要求第二次连接审批', read.status === 200 && mcpText(read).includes(HARNESS.PASSWORD), mcpText(read))
    const again = await readState(env)
    ok('读取没有生成新的连接待审批',
      Object.values(again.connections ?? {}).filter((entry) => entry.state === 'pending').length === 0)
    const write = await mcpAs(env, accessToken, 'put_secret', { name: HARNESS.ITEM, value: 'ROTATED-BY-AGENT' })
    ok('勾选写入后 agent 可以直接写入', mcpText(write).includes('"status":"written"'), mcpText(write))
    const afterWrite = await readState(env)
    ok('写入没有退回逐次审批',
      Object.keys(afterWrite.pending ?? {}).length === 0,
      JSON.stringify(Object.keys(afterWrite.pending ?? {})))
  }

  // 3: refreshing rotates the token and never outlives the consent window.
  {
    const renewed = await refresh(env, clientId, refreshToken)
    ok('refresh_token 换到新的 access token',
      renewed.status === 200 && Boolean(renewed.body.access_token) && Boolean(renewed.body.refresh_token), JSON.stringify(renewed.body))
    ok('续期保留 scope', String(renewed.body.scope).includes('secrets.write'), String(renewed.body.scope))
    const reused = await refresh(env, clientId, refreshToken)
    ok('旧 refresh token 用过即失效', reused.status === 400 && reused.body.error === 'invalid_grant', JSON.stringify(reused.body))
    const read = await mcpAs(env, renewed.body.access_token, 'get_secret', { name: HARNESS.ITEM })
    ok('续期后的 token 仍可读取', mcpText(read).includes(HARNESS.PASSWORD), mcpText(read))
    const state = await readState(env)
    const records = Object.values(state.oauthRefreshTokens ?? {})
    ok('refresh 记录的到期不超过授权窗口', records.every((record) => Number(record.expiresAt) > Date.now()))
    const admission = Object.values(state.connections ?? {}).find((entry) => entry.agent === 'oauth:' + clientId)
    ok('续期不改动 admission 的到期时间',
      Math.abs(Date.parse(admission.expiresAt) - (Date.now() + 168 * 3600e3)) < 5 * 60e3, admission.expiresAt)
  }

  // 4: without the tick the scope is trimmed, no refresh is issued, and the
  // agent cannot write.
  {
    const env2 = await freshEnv()
    const cookie2 = await login(env2)
    const client2 = await register(env2)
    const token = await connected(env2, cookie2, client2, { extra: { grant_hours: '168' } })
    ok('未勾写时 scope 被裁剪', !String(token.body.scope).includes('secrets.write'), String(token.body.scope))
    ok('未勾写时不写写入位', (await readState(env2)).oauthAgentProfiles?.['oauth:' + client2]?.write === false)
    const admission = Object.values((await readState(env2)).connections ?? {}).find((entry) => entry.agent === 'oauth:' + client2)
    ok('未勾写时 admission 的 writeAllowed 为 false', admission?.writeAllowed === false, JSON.stringify(admission))
    const write = await mcpAs(env2, token.body.access_token, 'put_secret', { name: HARNESS.ITEM, value: 'NOPE' })
    ok('未勾写时写入被拒且不生成待审批',
      mcpText(write).includes('not allowed to write')
      && Object.keys((await readState(env2)).pending ?? {}).length === 0, mcpText(write))
  }

  // 5: 24h consent issues no refresh token (nothing to renew yet).
  {
    const env3 = await freshEnv()
    const cookie3 = await login(env3)
    const client3 = await register(env3)
    const token = await connected(env3, cookie3, client3, { extra: { grant_write: '1', grant_hours: '24' } })
    ok('24 小时授权只发 access token', !token.body.refresh_token && token.body.expires_in === 86400, JSON.stringify(token.body))
  }

  // 6: a second consent replaces the first admission rather than stacking.
  {
    const second = await connected(env, cookie, clientId, { extra: { grant_write: '1', grant_hours: '168' } })
    ok('再次同意换到新 token', second.status === 200 && Boolean(second.body.access_token))
    const state = await readState(env)
    const records = Object.values(state.connections ?? {}).filter((entry) => entry.agent === 'oauth:' + clientId && entry.state === 'approved')
    ok('同一 agent 只保留一条 admission', records.length === 1, String(records.length))
  }

  report.finish()
}

await main()
