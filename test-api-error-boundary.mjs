// A failed API call must leave the Worker as JSON with a code. Before this
// regression, an exception escaped src/index.js entirely and the platform
// answered with a body the console could not parse: api() then fell back to
// "HTTP 500" and painted the "database temporarily unavailable" banner even
// when the failure had nothing to do with D1. The two cases below pin both
// halves of that contract: a plain crash names itself as internal, and a
// storage failure is the only one allowed to claim an outage.
//
// Run with: node --import ./test-support/register.mjs test-api-error-boundary.mjs
import { makeEnv, seedState, putSession, login, call, makeReporter } from './test-support/broker-harness.mjs'

const { pass, fail, finish } = makeReporter()

async function revealWithBrokenState(throwMessage) {
  const env = makeEnv()
  await seedState(env)
  await putSession(env)
  const cookie = await login(env)
  // The console session lives in the Durable Object; breaking it after login
  // reproduces "the route threw after authentication passed", which is the
  // shape the incident produced.
  env.BROKER_STATE.get = () => { throw new Error(throwMessage) }
  const response = await call(env, '/api/secret/reveal', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'harness-item' }),
  })
  const contentType = String(response.headers.get('content-type') || '')
  const body = await response.json().catch(() => null)
  return { response, contentType, body }
}

{
  const { response, contentType, body } = await revealWithBrokenState('state object evicted')
  if (response.status === 500 && contentType.includes('application/json') && body?.code === 'internal' && body?.error) {
    pass('B1 an uncaught route error is a JSON 500 instead of an unreadable platform page')
  } else {
    fail('B1', JSON.stringify({ status: response.status, contentType, body }))
  }
}

{
  const { response, body } = await revealWithBrokenState('D1_ERROR: database is locked')
  if (response.status === 500 && body?.code === 'db_unavailable' && /D1_ERROR/.test(String(body?.error))) {
    pass('B2 only a storage failure is reported as a database outage')
  } else {
    fail('B2', JSON.stringify({ status: response.status, body }))
  }
}

{
  // The banner decision in the console reads this code, so an ordinary crash
  // must not carry it.
  const { body } = await revealWithBrokenState('ambiguous_item_name: two items')
  if (body?.code === 'internal') pass('B3 an ordinary failure is not labelled db_unavailable')
  else fail('B3', JSON.stringify(body))
}

finish()
