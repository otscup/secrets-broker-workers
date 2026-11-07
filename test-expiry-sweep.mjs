// One sweep must cover every object that carries a clock. Expired rows are
// deleted (the audit line is the trace), permanent rows are untouched, and a
// second pass with nothing due writes no new audit.
import { HARNESS, makeEnv, seedState, login, call, makeReporter } from './test-support/broker-harness.mjs'

const { pass, fail, finish } = makeReporter()

const now = Date.now()
const expired = now - 60 * 1000

function seed(extra = {}) {
  return {
    capabilities: {
      'cap-expired': { id: 'cap-expired', subjectId: HARNESS.AGENT, itemId: HARNESS.ITEM_ID, itemName: HARNESS.ITEM, action: 'secret.read', expiresAt: expired },
      'cap-permanent': { id: 'cap-permanent', subjectId: HARNESS.AGENT, itemId: 'other-id', itemName: 'other', action: 'secret.read', expiresAt: 0 },
    },
    oauthTokens: {
      tok: { hash: 'tok', agent: 'oauth:expired', clientId: 'client', expiresAt: expired },
      keep: { hash: 'keep', agent: 'oauth:permanent', clientId: 'client', expiresAt: null },
    },
    oauthRefreshTokens: {
      ref: { hash: 'ref', agent: 'oauth:expired', expiresAt: expired, grantExpiresAt: expired },
    },
    oauthCodes: {
      code: { clientId: 'client', expiresAt: expired },
    },
    writeTickets: {
      ticket: { agent: HARNESS.AGENT, name: HARNESS.ITEM, mode: '1h', expiresAt: expired, account: HARNESS.ACCT },
      permanent: { agent: HARNESS.AGENT, name: 'other', mode: 'always', expiresAt: 0, account: HARNESS.ACCT },
    },
    pendingResults: {
      answer: { expiresAt: expired },
    },
    adminSessions: {
      stale: { id: 'stale', expiresAt: expired },
    },
    ...extra,
  }
}

async function stateOf(env) {
  const payload = await (await env.BROKER_STATE.get().fetch('https://state/state')).json()
  return payload.state
}

// 1. One pass removes every expired shape and keeps the permanent ones.
{
  const env = makeEnv()
  await seedState(env, seed())
  // Any request may start a pass, so login can already commit the cleanup
  // before /api/state runs; count from zero and match by event name.
  const beforeAudit = 0
  const cookie = await login(env)
  const response = await call(env, '/api/state', { headers: { cookie } })
  const body = await response.json()
  const state = await stateOf(env)
  const ok = response.status === 200 && body.ok !== false
    && !state.capabilities['cap-expired'] && Boolean(state.capabilities['cap-permanent'])
    && !state.oauthTokens.tok && Boolean(state.oauthTokens.keep)
    && !state.oauthRefreshTokens.ref && !state.oauthCodes.code
    && !state.writeTickets.ticket && Boolean(state.writeTickets.permanent)
    && !state.pendingResults.answer && !state.adminSessions.stale
  if (ok) pass('1a expired capability, token, refresh token, code, ticket, result and session are gone')
  else fail('1a sweep', JSON.stringify({ status: response.status, capabilities: Object.keys(state.capabilities), tokens: Object.keys(state.oauthTokens), tickets: Object.keys(state.writeTickets), sessions: Object.keys(state.adminSessions) }))

  const events = env._vault.auditRows.slice(beforeAudit).map((row) => row.event)
  const has = (name) => events.includes(name)
  if (has('capability.expire') && has('oauth.token-expire') && has('oauth.refresh-expire') && has('oauth.code-expire') && has('write-ticket.expire') && has('session.expire')) {
    pass('1b each removed shape is recorded in audit')
  } else {
    fail('1b audit events', JSON.stringify(events))
  }

  const capRow = env._vault.auditRows.slice(beforeAudit).find((row) => row.event === 'capability.expire')
  const counts = capRow ? { before: capRow.before, after: capRow.after } : null
  if (counts?.before?.capabilities === 2 && counts?.after?.capabilities === 1) {
    pass('1c the audit line carries before/after counts')
  } else {
    fail('1c counts', JSON.stringify(counts))
  }
}

// 2. A second pass with nothing due writes no audit and no state change.
{
  const env = makeEnv()
  await seedState(env, seed())
  const cookie = await login(env)
  await call(env, '/api/state', { headers: { cookie } })
  const auditAfterFirst = env._vault.auditRows.length
  const stateAfterFirst = JSON.stringify(await stateOf(env))
  await call(env, '/api/state', { headers: { cookie } })
  const auditAfterSecond = env._vault.auditRows.length
  const stateAfterSecond = JSON.stringify(await stateOf(env))
  if (auditAfterSecond === auditAfterFirst && stateAfterSecond === stateAfterFirst) pass('2a the sweep is idempotent')
  else fail('2a idempotence', JSON.stringify({ auditAfterFirst, auditAfterSecond, changed: stateAfterFirst !== stateAfterSecond }))
}

finish()
