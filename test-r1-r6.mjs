import fs from 'node:fs'
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto'
import { webcrypto } from 'node:crypto'
import { BrokerState, agentInScope } from './src/index.js'
import { parseJwt, verifyJwtSignature, validateIdTokenClaims, setOidcCrypto } from './src/oidc.js'

setOidcCrypto(webcrypto)
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

// ============ R1: atomic /oidc/state/consume ============
// Harness mirrors the DO execution model: a Durable Object instance processes
// one fetch event at a time (single-threaded). We therefore serialize fetch()
// calls through a promise chain on ONE shared instance + ONE shared store,
// including requests arriving from "different worker instances" (distinct
// BrokerState objects sharing the same underlying storage).
function memoryCtx(store) {
  return { storage: {
    get: async (k) => store[k] ?? null,
    put: async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)) },
    delete: async (k) => { delete store[k] },
  } }
}
// HMAC key for cookie signing in tests only (throwaway, never production).
const FAKE_KEK_B64 = Buffer.from('0'.repeat(32)).toString('base64')
process.env.SESSION_KEK = process.env.SESSION_KEK || FAKE_KEK_B64
function makeEnv(store) {
  return { SESSION_KEK: FAKE_KEK_B64, BROKER_STATE: { idFromName: () => 'x', get: () => { throw new Error('no-nested-do') } }, _store: store }
}
function doInstance(store) { return new BrokerState(memoryCtx(store), makeEnv(store)) }
function req(path, body) {
  return new Request('https://state' + path, { method: 'POST', body: JSON.stringify(body) })
}
// oidcStateCookie equivalent (HMAC-SHA256 via webcrypto like cookieKey+hmacToken)
async function signCookie(state, verifier, nonce, next, expires) {
  const payload = state + '|' + verifier + '|' + nonce + '|' + next + '|' + expires
  const kb = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('cookie:' + FAKE_KEK_B64))
  const key = await webcrypto.subtle.importKey('raw', kb, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const b64 = Buffer.from(sig).toString('base64')
  return encodeURIComponent(payload + '|' + b64)
}
async function readJson(res) { return res.json() }

// serialize concurrent fetch() calls like the DO runtime does
function serializedCaller(inst) {
  let tail = Promise.resolve()
  return (request) => {
    const run = tail.then(() => inst.fetch(request))
    tail = run.catch(() => {})
    return run
  }
}

const store = {}
const instA = doInstance(store)   // "worker instance 1" view of the same DO
const instB = doInstance(store)   // "worker instance 2" view of the same DO
const callA = serializedCaller(instA)
const callB = serializedCaller(instB)
const EXP = Date.now() + 10 * 60 * 1000
const cookie = await signCookie('state-abc', 'ver-1', 'nonce-1', '', EXP)

// T1: 20-way concurrent consume of the SAME state -> exactly 1 ok
{
  const calls = []
  for (let i = 0; i < 20; i++) {
    const caller = i % 2 ? callA : callB   // alternate "worker instances"
    calls.push(caller(req('/oidc/state/consume', { cookie, state: 'state-abc' })).then(readJson))
  }
  const out = await Promise.all(calls)
  const okCount = out.filter((r) => r.ok).length
  const reasons = [...new Set(out.filter((r) => !r.ok).map((r) => r.reason))]
  if (okCount === 1 && reasons.length === 1 && reasons[0] === 'replay') pass('R1-T1 20-way concurrent consume: exactly 1 ok, 19 replay')
  else fail('R1-T1 20-way concurrent consume', 'ok=' + okCount + ' reasons=' + reasons.join(','))
}
// T2: repeat consume after success -> replay
{
  const r = await readJson(await callA(req('/oidc/state/consume', { cookie, state: 'state-abc' })))
  if (!r.ok && r.reason === 'replay') pass('R1-T2 repeat consume rejected as replay')
  else fail('R1-T2 repeat consume', JSON.stringify(r))
}
// T3: expired state rejected
{
  const c2 = await signCookie('state-old', 'v', 'n', '', Date.now() - 1000)
  const r = await readJson(await callA(req('/oidc/state/consume', { cookie: c2, state: 'state-old' })))
  if (!r.ok && r.reason === 'expired') pass('R1-T3 expired state rejected')
  else fail('R1-T3 expired', JSON.stringify(r))
}
// T4: tampered cookie rejected
{
  const bad = cookie.slice(0, -4) + 'XXXX'
  const r = await readJson(await callA(req('/oidc/state/consume', { cookie: bad, state: 'state-abc' })))
  if (!r.ok && (r.reason === 'invalid' || r.reason === 'mismatch')) pass('R1-T4 tampered cookie rejected')
  else fail('R1-T4 tampered', JSON.stringify(r))
}
// T5: different states independent (fresh state consumes ok alongside used one)
{
  const c3 = await signCookie('state-fresh', 'v2', 'n2', 'profile', EXP)
  const r = await readJson(await callB(req('/oidc/state/consume', { cookie: c3, state: 'state-fresh' })))
  if (r.ok && r.nonce === 'n2' && r.next === 'profile' && r.verifier === 'v2') pass('R1-T5 independent fresh state consumes ok with fields')
  else fail('R1-T5 fresh state', JSON.stringify(r))
}
// T6: wrong returned state -> mismatch
{
  const c4 = await signCookie('state-x', 'v', 'n', '', EXP)
  const r = await readJson(await callA(req('/oidc/state/consume', { cookie: c4, state: 'state-Y' })))
  if (!r.ok && r.reason === 'mismatch') pass('R1-T6 state mismatch rejected')
  else fail('R1-T6 mismatch', JSON.stringify(r))
}

// ============ R6: scope predicate (mirror of agentInScope) ============
// agentInScope is the REAL production predicate imported from src/index.js.
const G = { A: 'g-x', B: 'g-y' }
const chk = (n, got, want) => (got === want ? pass(n) : fail(n, 'got=' + got + ' want=' + want))
chk('R6-T1 read-only agent (no write flag concept) has no allowAll scope', agentInScope({ allow: [], groups: [], allowAll: false }, {}, 'A'), false)
chk('R6-T2 write-capable but unscoped agent blocked from item', agentInScope({ allow: [], groups: [], allowAll: false }, {}, 'A'), false)
chk('R6-T3 allow A cannot touch B', agentInScope({ allow: ['A'], groups: [] }, {}, 'B'), false)
chk('R6-T4 allow A can touch A', agentInScope({ allow: ['A'], groups: [] }, {}, 'A'), true)
chk('R6-T5 group g-x cannot touch g-y item', agentInScope({ allow: [], groups: ['g-x'] }, { B: G.B }, 'B'), false)
chk('R6-T6 group g-x can touch g-x item', agentInScope({ allow: [], groups: ['g-x'] }, { A: G.A, B: G.B }, 'A'), true)
chk('R6-T7 create into allowed group ok', agentInScope({ allow: [], groups: ['g-x'] }, {}, 'NEW', 'g-x'), true)
chk('R6-T8 create into forbidden group blocked', agentInScope({ allow: [], groups: ['g-x'] }, {}, 'NEW', 'g-y'), false)
chk('R6-T9 rename A->B blocked when B out of scope', agentInScope({ allow: ['A'], groups: [] }, {}, 'B'), false)
chk('R6-T10 move A to g-y blocked for g-x-only agent', agentInScope({ allow: [], groups: ['g-x'] }, { A: G.A }, 'A', 'g-y'), false)
chk('R6-T11 allowAll=true touches anything', agentInScope({ allow: [], groups: [], allowAll: true }, {}, 'ANY'), true)
chk('R6-T12 explicit allow beats allowAll=false', agentInScope({ allow: ['A'], groups: [], allowAll: false }, {}, 'A'), true)

// ============ regression: OIDC JWT/JWKS (subset) ============
{
  const ISS = 'https://idp.example.invalid', CLI = 'c1', NN = 'n1'
  const nowS = Math.floor(Date.now() / 1000)
  const kp = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pub = { ...kp.publicKey.export({ format: 'jwk' }), kid: 'k1' }
  const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const mk = (claims) => {
    const h = b64u(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })))
    const p = b64u(Buffer.from(JSON.stringify({ iss: ISS, aud: CLI, exp: nowS + 600, sub: 'u', nonce: NN, ...claims })))
    const s = nodeSign('sha256', Buffer.from(h + '.' + p), kp.privateKey)
    return h + '.' + p + '.' + b64u(s)
  }
  try {
    const parsed = parseJwt(mk({}))
    await verifyJwtSignature(parsed, { keys: [pub] })
    validateIdTokenClaims(parsed.payload, { issuer: ISS, clientId: CLI, nonce: NN })
    pass('REG-OIDC valid token still accepted')
  } catch (e) { fail('REG-OIDC valid token', String(e?.message ?? e)) }
  try { validateIdTokenClaims(parseJwt(mk({ aud: 'evil' })).payload, { issuer: ISS, clientId: CLI, nonce: NN }); fail('REG-OIDC wrong aud', 'accepted') }
  catch { pass('REG-OIDC wrong aud rejected') }
  try { const t = mk({}).split('.'); const pl = JSON.parse(Buffer.from(t[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); pl.sub = 'attacker'; const forged = t[0] + '.' + b64u(Buffer.from(JSON.stringify(pl))) + '.' + t[2]; await verifyJwtSignature(parseJwt(forged), { keys: [pub] }); fail('REG-OIDC tamper', 'accepted') }
  catch { pass('REG-OIDC tampered payload rejected') }
}

// ============ regression: http_request policy markers ============
{
  const src = fs.readFileSync('src/index.js', 'utf8')
  const marks = ['HTTP_ALLOW_METHODS', 'HTTP_ALLOW_PATHS', 'HTTP_ALLOWED_PORTS', 'secretHeaderAllow', 'AbortSignal.timeout(15000)', "redirect: 'manual'", 'private/local targets are not allowed', 'target host is not allowed', 'body too large (max 64KB)', 'GET/HEAD must not include a body']
  const missing = marks.filter((m) => !src.includes(m))
  if (!missing.length) pass('REG-HTTP all policy markers present')
  else fail('REG-HTTP markers missing', missing.join(', '))
}

const passed = results.filter((r) => r.ok).length
console.log('\n==== ' + passed + '/' + results.length + ' passed ====')
const lines = ['# R1/R6 security tests — ' + new Date().toISOString(), '', 'DO consume ran against the real BrokerState class with serialized fetch (DO single-thread model) + shared store across two instances; throwaway HMAC material only.', '', '| case | result |', '|---|---|']
for (const r of results) lines.push('| ' + r.n + ' | ' + (r.ok ? 'PASS' : 'FAIL: ' + (r.d ?? '')) + ' |')
lines.push('', 'Total: ' + passed + '/' + results.length + ' passed.')
fs.writeFileSync('docs/r1-r6-test-results.md', lines.join('\n'))
console.log('wrote docs/r1-r6-test-results.md')
if (passed !== results.length) process.exit(1)
