// A successful second factor belongs to one admin session for one unlock. It
// must stop at lock, must not leak to another browser session, and must never
// become optional: without the pass a sensitive action still gets 428.
import { makeEnv, seedState, login, call, putSession, makeReporter } from './test-support/broker-harness.mjs'

const { pass, fail, finish } = makeReporter()

async function stateOf(env) {
  return (await (await env.BROKER_STATE.get().fetch('https://state/state')).json()).state
}
async function setSecurity(env, enabled) {
  const state = await stateOf(env)
  state.security = { ...(state.security || {}), totpEnabled: enabled }
  await env.BROKER_STATE.get().fetch('https://state/state', { method: 'PUT', body: JSON.stringify(state) })
}
function sessionOf(cookie) {
  return String(cookie).split('.')[1] ?? ''
}
async function exportStatus(env, cookie) {
  const response = await call(env, '/api/items/export', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })
  return response.status
}

// 1. Without a pass the factor is still mandatory; a pass makes the same call
//    pass; another browser session does not inherit it.
{
  const env = makeEnv()
  await seedState(env)
  await putSession(env)
  const cookie = await login(env)
  // A second browser logs in while TOTP is still off; it must not inherit the
  // first session's pass once TOTP is on.
  const other = await login(env)
  await setSecurity(env, true)
  const before = await exportStatus(env, cookie)
  const session = sessionOf(cookie)
  await env.BROKER_STATE.get().fetch('https://state/factor', {
    method: 'POST',
    body: JSON.stringify({ session, expiresAt: Date.now() + 3600e3 }),
  })
  const after = await exportStatus(env, cookie)
  const otherStatus = await exportStatus(env, other)
  if (before === 428 && after === 200 && otherStatus === 428) pass('1a one pass unlocks this session only; others still get 428')
  else fail('1a session pass', JSON.stringify({ before, after, otherStatus, session }))
}

// 2. Locking clears the pass, so the next sensitive action asks again.
{
  const env = makeEnv()
  await seedState(env)
  await putSession(env)
  const cookie = await login(env)
  await setSecurity(env, true)
  const session = sessionOf(cookie)
  await env.BROKER_STATE.get().fetch('https://state/factor', {
    method: 'POST',
    body: JSON.stringify({ session, expiresAt: Date.now() + 3600e3 }),
  })
  const unlocked = await exportStatus(env, cookie)
  await env.BROKER_STATE.get().fetch('https://state/v2-key', { method: 'DELETE' })
  const locked = await exportStatus(env, cookie)
  if (unlocked === 200 && locked === 428) pass('2a lock clears the session pass')
  else fail('2a lock clears pass', JSON.stringify({ unlocked, locked }))
}

// 3. The pass never outlives its unlock window; an expired record is ignored.
{
  const env = makeEnv()
  await seedState(env)
  await putSession(env)
  const cookie = await login(env)
  await setSecurity(env, true)
  const session = sessionOf(cookie)
  await env.BROKER_STATE.get().fetch('https://state/factor', {
    method: 'POST',
    body: JSON.stringify({ session, expiresAt: Date.now() + 1000 }),
  })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const status = await exportStatus(env, cookie)
  if (status === 428) pass('3a an expired pass is not accepted')
  else fail('3a expired pass', JSON.stringify({ status }))
}

finish()
