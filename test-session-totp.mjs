// One TOTP per browser session, end to end.
//
// The defect this guards against: a v2 unlock used to delete the second-factor
// pass right after the operator proved it, so the next reveal/export asked for
// the same code again. Login also verified the same secret without recording
// anything, so "login -> unlock -> view" cost three codes for one presence proof.
//
// The required behaviour is: a successful login that includes the code writes
// the pass; the unlock reuses and refreshes that pass instead of clearing it;
// every sensitive action in that session reuses it; locking/logging out starts
// over. The factor stays mandatory — it is just asked once.
import { createHmac } from 'node:crypto'
import { wrapWithKek, hmacToken } from './src/crypto.js'
import { wrapDekPassword } from './src/envelope.js'
import { HARNESS, makeEnv, seedState, putSession, call, FakeD1, makeReporter } from './test-support/broker-harness.mjs'

const { pass, fail, finish } = makeReporter()
const MASTER = 'correct horse battery staple'
const SECRET = 'JBSWY3DPEHPK3PXP'
const DEK = Array.from({ length: 32 }, (_, i) => i + 1)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32(text) {
  let bits = 0
  let value = 0
  const bytes = []
  for (const char of String(text).replace(/=+$/, '').toUpperCase()) {
    const index = B32.indexOf(char)
    if (index < 0) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(bytes)
}
function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 30000)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const mac = createHmac('sha1', base32(secret)).update(buf).digest()
  const offset = mac[mac.length - 1] & 15
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  return String(binary % 1e6).padStart(6, '0')
}

// The v2 vault needs one password keyring row. The shared harness fake answers
// unknown statements with an empty result, so wrap the two keyring lookups
// vault2Unlock performs and leave everything else alone.
function keyringD1(envelope) {
  const base = new FakeD1()
  return {
    prepare(sql) {
      if (/FROM keyrings WHERE id = \?/.test(sql)) {
        return { bind: () => ({ first: async () => ({ envelope }) }), first: async () => ({ envelope }) }
      }
      return base.prepare(sql)
    },
    batch: (list) => base.batch(list),
  }
}

function cookieSession(cookie) {
  const value = cookie.slice(cookie.indexOf('=') + 1)
  const parts = value.split('.')
  return { id: parts[1] ?? '', expiresAt: Number(parts[2] ?? 0) }
}
function post(env, path, body, cookie) {
  return call(env, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  })
}
function get(env, path, cookie) {
  return call(env, path, { headers: cookie ? { cookie } : {} })
}

const env = makeEnv({ vault: keyringD1(await wrapDekPassword(Uint8Array.from(DEK), MASTER)) })
await seedState(env, {
  security: { totpEnabled: true, totpSecretWrapped: await wrapWithKek(new TextEncoder().encode(SECRET), Buffer.from(HARNESS.KEK, 'base64')) },
})
await putSession(env)

// ============ 1. The login still requires the code ============
{
  const without = await post(env, '/api/login', { password: 'p' })
  const payload = await without.json().catch(() => ({}))
  if (without.status === 401 && payload.totpRequired === true) pass('1a password-only login is refused and asks for the code')
  else fail('1a login must require TOTP', `status=${without.status} body=${JSON.stringify(payload).slice(0, 120)}`)

  const wrong = await post(env, '/api/login', { password: 'p', code: '000000' })
  if (wrong.status === 401) pass('1b a wrong code is refused')
  else fail('1b wrong code', `status=${wrong.status}`)
}

// ============ 2. One code at login writes the session pass ============
const ok = await post(env, '/api/login', { password: 'p', code: totp(SECRET) })
const cookie = String(ok.headers.get('set-cookie') || '').split(';')[0]
const session = cookieSession(cookie)
if (ok.status === 200 && session.id && session.expiresAt > Date.now()) pass('2a login with one code succeeds and the cookie session is live')
else fail('2a login with code', `status=${ok.status} session=${JSON.stringify(session)}`)

const factor = await (await env.BROKER_STATE.get().fetch('https://state/factor?session=' + encodeURIComponent(session.id))).json()
if (factor.ok === true && Number(factor.expiresAt) > Date.now()) pass('2b login recorded the second-factor pass for this cookie session')
else fail('2b login must write the pass', JSON.stringify(factor))

const status = await (await get(env, '/api/v2/status', cookie)).json()
if (status.factorOk === true) pass('2c /api/v2/status reports the session pass, so the unlock form can hide the field')
else fail('2c status factorOk', JSON.stringify(status).slice(0, 160))

// ============ 3. The unlock reuses the pass instead of deleting it ============
const unlocked = await post(env, '/api/v2/unlock', { password: MASTER, ttlMs: 12 * 3600 * 1000, duration: '12h' }, cookie)
const result = await unlocked.json().catch(() => ({}))
if (unlocked.status === 200 && result.plainOk === true) pass('3a unlock without a second code succeeds because the login pass covers it')
else fail('3a unlock reused the pass', `status=${unlocked.status} body=${JSON.stringify(result).slice(0, 160)}`)

const key = await (await env.BROKER_STATE.get().fetch('https://state/v2-key?account=&session=' + encodeURIComponent(session.id))).json()
const after = await (await env.BROKER_STATE.get().fetch('https://state/factor?session=' + encodeURIComponent(session.id))).json()
if (after.ok === true && Number(after.expiresAt) > Date.now()) pass('3b the unlock did not clear the pass (this is the batch C defect)')
else fail('3b pass survived the unlock', JSON.stringify(after))
if (key.ok === true && Number(after.expiresAt) === Number(key.expiresAt)) pass('3c the pass TTL matches the unlock slot TTL')
else fail('3c pass TTL alignment', `pass=${after.expiresAt} key=${key.expiresAt}`)

// ============ 4. Listing, export and reveal all reuse it ============
{
  const listing = await get(env, '/api/v2/items?plain=1', cookie)
  if (listing.status === 200) pass('4a plaintext listing answers without another code')
  else fail('4a plaintext listing', `status=${listing.status} body=${(await listing.text().catch(() => '')).slice(0, 120)}`)

  const exported = await post(env, '/api/items/export', {}, cookie)
  if (exported.status === 200) pass('4b export answers without another code')
  else fail('4b export', `status=${exported.status}`)

  const revealed = await post(env, '/api/secret/reveal', { name: HARNESS.ITEM }, cookie)
  if (revealed.status !== 428) pass('4c reveal did not ask for another code (404 is fine: the legacy row is absent in this harness)')
  else fail('4c reveal asked again', `status=${revealed.status}`)
}

// ============ 5. Locking clears it: the next view must ask again ============
{
  const locked = await post(env, '/api/lock', { password: 'p' }, cookie)
  if (locked.status === 200) pass('5a the lock succeeds')
  else fail('5a lock', `status=${locked.status}`)
  // /api/lock also ends the legacy vault session, so restore it to reach the
  // export gate; the point under test is the factor pass, not the session.
  await putSession(env)
  const exported = await post(env, '/api/items/export', {}, cookie)
  if (exported.status === 428) pass('5b after locking, viewing plaintext asks for a code again')
  else fail('5b export after lock', `status=${exported.status}`)

  const state = await (await env.BROKER_STATE.get().fetch('https://state/factor?session=' + encodeURIComponent(session.id))).json()
  if (state.ok === false) pass('5c the lock deleted the durable pass')
  else fail('5c factor after lock', JSON.stringify(state))
}

// ============ 6. Another browser has to prove itself ============
{
  // A different browser is a different cookie session. Mint one the way login
  // would (signed cookie + server record) but without the pass, then check that
  // the pass is bound to the id and never shared.
  const foreignId = 'foreign-browser'
  const foreignExpires = Date.now() + 3600 * 1000
  const stored = await (await env.BROKER_STATE.get().fetch('https://state/state')).json()
  const document = stored.state ?? stored
  document.adminSessions ??= {}
  document.adminSessions[foreignId] = { id: foreignId, ip: '', ua: '', createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), expiresAt: foreignExpires }
  await env.BROKER_STATE.get().fetch('https://state/state', { method: 'PUT', body: JSON.stringify(document) })
  const keyBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cookie:' + HARNESS.KEK)))
  const signature = await hmacToken(keyBytes, 'v2.' + foreignId + '.' + foreignExpires)
  const foreignCookie = cookie.split('=')[0] + '=v2.' + foreignId + '.' + foreignExpires + '.' + signature

  const state = await (await get(env, '/api/v2/status', foreignCookie)).json()
  if (state.factorOk === false) pass('6a a session that never proved the factor reports factorOk false')
  else fail('6a foreign status', JSON.stringify(state).slice(0, 120))

  const exported = await post(env, '/api/items/export', {}, foreignCookie)
  if (exported.status === 428) pass('6b that session is asked for a code instead of borrowing this browser’s pass')
  else fail('6b cross-session pass leak', `status=${exported.status}`)
}

finish()
