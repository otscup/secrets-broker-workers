// Miniflare-backed test: the REAL BrokerState class runs inside workerd with
// real Durable Object storage + transaction semantics. No fetch serialization
// harness, no mocks: 20 concurrent stub.fetch() calls race inside the runtime.
import { Miniflare } from 'miniflare'
import { webcrypto } from 'node:crypto'
import fs from 'node:fs'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const FAKE_KEK_B64 = Buffer.from('0'.repeat(32)).toString('base64')
const entry = fs.readFileSync('src/index.js', 'utf8')
if (!entry.includes('storage.transaction')) { fail('PRE runtime uses storage.transaction', 'marker missing') }
void entry;
// Worker entry imports ./ui.js and ./logo.js (fine) plus cloudflare:workers
// which Miniflare provides natively.
const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  compatibilityDate: '2024-01-01',
  scriptPath: 'src/index.js',
  // NOTE: this Miniflare version does not propagate `vars` into DO env;
  // declare the test-only key as a string binding too (production uses vars).
  vars: { SESSION_KEK: FAKE_KEK_B64 },
  bindings: { SESSION_KEK: FAKE_KEK_B64 },
  durableObjects: { BROKER_STATE: 'BrokerState' },
  serviceBindings: { NODEWARDEN: async () => new Response('{}') },
})
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))

async function signCookie(state, verifier, nonce, next, expires) {
  const payload = state + '|' + verifier + '|' + nonce + '|' + next + '|' + expires
  const kb = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('cookie:' + FAKE_KEK_B64))
  const key = await webcrypto.subtle.importKey('raw', kb, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return encodeURIComponent(payload + '|' + Buffer.from(sig).toString('base64'))
}
const post = (cookie, state) => stub.fetch('https://state/oidc/state/consume', { method: 'POST', body: JSON.stringify({ cookie, state }) }).then((r) => r.json())
const EXP = Date.now() + 10 * 60 * 1000

// MF-T1: 20 concurrent consumes, same state, zero coordination -> exactly 1 ok
{
  const cookie = await signCookie('mf-state', 'v', 'n', '', EXP)
  const out = await Promise.all(Array.from({ length: 20 }, () => post(cookie, 'mf-state')))
  const ok = out.filter((r) => r.ok).length
  const reasons = [...new Set(out.filter((r) => !r.ok).map((r) => r.reason))]
  if (ok === 1 && reasons.join() === 'replay') pass('MF-T1 20-way concurrent consume in workerd: 1 ok, 19 replay')
  else fail('MF-T1 20-way', 'ok=' + ok + ' reasons=' + reasons.join(','))
}
// MF-T2: expired / tampered / mismatch still rejected by the same endpoint
{
  const cExp = await signCookie('mf-old', 'v', 'n', '', Date.now() - 1000)
  const r1 = await post(cExp, 'mf-old')
  const cOk = await signCookie('mf-x', 'v', 'n', '', EXP)
  const r2 = await post(cOk.slice(0, -4) + 'XXXX', 'mf-x')
  const cMm = await signCookie('mf-a', 'v', 'n', '', EXP)
  const r3 = await post(cMm, 'mf-b')
  if (!r1.ok && r1.reason === 'expired' && !r2.ok && !r3.ok && r3.reason === 'mismatch') pass('MF-T2 expired/tampered/mismatch rejected')
  else fail('MF-T2 negatives', JSON.stringify([r1, r2, r3]))
}
// MF-T3: independent state unaffected
{
  const c = await signCookie('mf-fresh', 'v2', 'n2', 'profile', EXP)
  const r = await post(c, 'mf-fresh')
  if (r.ok && r.nonce === 'n2' && r.next === 'profile') pass('MF-T3 independent state consumes ok')
  else fail('MF-T3 fresh', JSON.stringify(r))
}
await mf.dispose()
const passed = results.filter((r) => r.ok).length
console.log('\n==== miniflare ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
