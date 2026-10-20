import { generateKeyPairSync, sign as nodeSign } from 'node:crypto'
import { webcrypto } from 'node:crypto'
import fs from 'node:fs'
import {
  parseJwt, verifyJwtSignature, validateIdTokenClaims, checkUserinfoSub,
  isUsedState, markUsedState, setOidcCrypto,
} from './src/oidc.js'

setOidcCrypto(webcrypto)

const ISSUER = 'https://idp.example.invalid'
const CLIENT = 'client_test_1'
const NONCE = 'nonce_test_abc123'
const NOW = Date.now()
const nowSec = Math.floor(NOW / 1000)

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// --- fake keys (test-only, never production) ---
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const rsaOther = generateKeyPairSync('rsa', { modulusLength: 2048 })
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const rsaPub = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'rsa-1', use: 'sig', alg: 'RS256' }
const ecPub = { ...ec.publicKey.export({ format: 'jwk' }), kid: 'ec-1', use: 'sig', alg: 'ES256' }
const JWKS = { keys: [rsaPub, ecPub] }

function signJwt({ alg = 'RS256', claims = {}, header = {}, key = rsa.privateKey, kid = 'rsa-1' }) {
  const h = { alg, kid, typ: 'JWT', ...header }
  const p = { iss: ISSUER, aud: CLIENT, exp: nowSec + 3600, iat: nowSec, sub: 'user-1', nonce: NONCE, ...claims }
  const input = b64url(Buffer.from(JSON.stringify(h))) + '.' + b64url(Buffer.from(JSON.stringify(p)))
  let sig
  if (alg === 'none') sig = Buffer.alloc(0)
  else if (alg.startsWith('RS')) sig = nodeSign(alg === 'RS256' ? 'sha256' : alg === 'RS384' ? 'sha384' : 'sha512', Buffer.from(input), key)
  else if (alg.startsWith('ES')) {
    const hash = alg === 'ES256' ? 'sha256' : alg === 'ES384' ? 'sha384' : 'sha512'
    sig = nodeSign(hash, Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
  } else sig = Buffer.from('ZmFrZQ')
  return input + '.' + b64url(sig)
}

const results = []
function pass(name) { results.push({ name, ok: true }); console.log('PASS  ' + name) }
function fail(name, detail) { results.push({ name, ok: false, detail }); console.log('FAIL  ' + name + ' :: ' + detail) }

async function expectOk(name, fn) {
  try { await fn(); pass(name) } catch (e) { fail(name, 'expected accept, got reject: ' + (e?.message ?? e)) }
}
async function expectReject(name, fn, pattern) {
  try {
    await fn()
    fail(name, 'expected reject, got accept')
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (pattern && !msg.toLowerCase().includes(pattern.toLowerCase())) fail(name, 'wrong reason: ' + msg)
    else pass(name)
  }
}

// ---------- positive ----------
await expectOk('P1 valid RS256 verifies + claims pass', async () => {
  const parsed = parseJwt(signJwt({}))
  await verifyJwtSignature(parsed, JWKS)
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
})
await expectOk('P2 valid ES256 verifies', async () => {
  const parsed = parseJwt(signJwt({ alg: 'ES256', key: ec.privateKey, kid: 'ec-1' }))
  await verifyJwtSignature(parsed, JWKS)
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
})
await expectOk('P3 aud array + matching azp passes', async () => {
  const parsed = parseJwt(signJwt({ claims: { aud: [CLIENT, 'other-aud'], azp: CLIENT } }))
  await verifyJwtSignature(parsed, JWKS)
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
})
await expectOk('P4 exp 30s ago passes within 60s leeway', async () => {
  const parsed = parseJwt(signJwt({ claims: { exp: nowSec - 30 } }))
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
})
await expectOk('P5 no-kid token scans single-key JWKS', async () => {
  const single = { keys: [rsaPub] }
  const t = signJwt({})
  const noKid = t.split('.')
  const h = JSON.parse(Buffer.from(noKid[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
  delete h.kid
  const hb = b64url(Buffer.from(JSON.stringify(h)))
  const input = hb + '.' + noKid[1]
  const sig = nodeSign('sha256', Buffer.from(input), rsa.privateKey)
  const parsed = parseJwt(input + '.' + b64url(sig))
  await verifyJwtSignature(parsed, single)
})

// ---------- negative: signature / jwks ----------
await expectReject('N1 alg=none rejected', async () => {
  const parsed = parseJwt(signJwt({ alg: 'none' }))
  await verifyJwtSignature(parsed, JWKS)
}, 'unsupported')
await expectReject('N2 HS256 rejected (symmetric confusion)', async () => {
  const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const p = b64url(Buffer.from(JSON.stringify({ iss: ISSUER, aud: CLIENT, exp: nowSec + 60, sub: 'x', nonce: NONCE })))
  const parsed = parseJwt(h + '.' + p + '.ZmFrZQ')
  await verifyJwtSignature(parsed, JWKS)
}, 'unsupported')
await expectReject('N3 tampered payload fails signature', async () => {
  const t = signJwt({}).split('.')
  const p = JSON.parse(Buffer.from(t[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
  p.sub = 'attacker'
  const forged = t[0] + '.' + b64url(Buffer.from(JSON.stringify(p))) + '.' + t[2]
  const parsed = parseJwt(forged)
  await verifyJwtSignature(parsed, JWKS)
}, 'signature')
await expectReject('N4 unknown kid rejected', async () => {
  const parsed = parseJwt(signJwt({ kid: 'ghost-key' }))
  await verifyJwtSignature(parsed, JWKS)
}, 'no jwks key')
await expectReject('N5 signed by wrong key rejected', async () => {
  const parsed = parseJwt(signJwt({ key: rsaOther.privateKey }))
  await verifyJwtSignature(parsed, JWKS)
}, 'signature')
await expectReject('N6 empty JWKS rejected', async () => {
  const parsed = parseJwt(signJwt({}))
  await verifyJwtSignature(parsed, { keys: [] })
}, 'no keys')
await expectReject('N7 enc-use key not usable', async () => {
  const parsed = parseJwt(signJwt({}))
  await verifyJwtSignature(parsed, { keys: [{ ...rsaPub, use: 'enc' }] })
}, 'no jwks key')
await expectReject('N8 two-segment token malformed', async () => {
  parseJwt('abc.def')
}, 'three')

// ---------- negative: claims ----------
await expectReject('N9 wrong iss rejected', async () => {
  const parsed = parseJwt(signJwt({ claims: { iss: 'https://evil.example.invalid' } }))
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
}, 'issuer')
await expectReject('N10 wrong aud rejected', async () => {
  const parsed = parseJwt(signJwt({ claims: { aud: 'someone-else' } }))
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
}, 'audience')
await expectReject('N11 expired token rejected', async () => {
  const parsed = parseJwt(signJwt({ claims: { exp: nowSec - 120 } }))
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
}, 'expired')
await expectReject('N12 future nbf rejected', async () => {
  const parsed = parseJwt(signJwt({ claims: { nbf: nowSec + 600 } }))
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
}, 'not yet valid')
await expectReject('N13 nonce mismatch rejected', async () => {
  const parsed = parseJwt(signJwt({ claims: { nonce: 'attacker-nonce' } }))
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
}, 'nonce')
await expectReject('N14 missing nonce rejected', async () => {
  const t = signJwt({}).split('.')
  const p = JSON.parse(Buffer.from(t[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
  delete p.nonce
  const rebuilt = t[0] + '.' + b64url(Buffer.from(JSON.stringify(p)))
  const sig = nodeSign('sha256', Buffer.from(rebuilt), rsa.privateKey)
  const parsed = parseJwt(rebuilt + '.' + b64url(sig))
  await verifyJwtSignature(parsed, JWKS)
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
}, 'nonce')
await expectReject('N15 missing sub rejected', async () => {
  const parsed = parseJwt(signJwt({ claims: { sub: '' } }))
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
}, 'subject')
await expectReject('N16 wrong azp on multi-aud rejected', async () => {
  const parsed = parseJwt(signJwt({ claims: { aud: [CLIENT, 'other'], azp: 'impostor' } }))
  validateIdTokenClaims(parsed.payload, { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW })
}, 'azp')

// ---------- negative: userinfo + replay ----------
await expectReject('N17 userinfo sub mismatch rejected', async () => {
  checkUserinfoSub('attacker', 'user-1')
}, 'userinfo sub')
try { checkUserinfoSub('user-1', 'user-1'); pass('P6 userinfo sub match accepted') } catch (e) { fail('P6 userinfo sub match accepted', String(e?.message ?? e)) }

const used0 = markUsedState(undefined, 'state-1', { now: NOW })
if (isUsedState(used0, 'state-1', { now: NOW })) pass('N18 replayed state detected as used')
else fail('N18 replayed state detected as used', 'isUsedState returned false')
if (!isUsedState(used0, 'state-2', { now: NOW })) pass('P7 fresh state not flagged')
else fail('P7 fresh state not flagged', 'isUsedState returned true')
if (!isUsedState(used0, 'state-1', { now: NOW + 20 * 60 * 1000 })) pass('P8 used entry expires after TTL')
else fail('P8 used entry expires after TTL', 'stale entry still flagged')

// ---------- report ----------
const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok)
console.log('\n==== ' + passed + '/' + results.length + ' passed ====')
const lines = ['# OIDC verification tests — ' + new Date().toISOString(), '', 'Pure unit tests of src/oidc.js with throwaway keys (nothing production).', '', '| case | result |', '|---|---|']
for (const r of results) lines.push('| ' + r.name + ' | ' + (r.ok ? 'PASS' : 'FAIL: ' + (r.detail ?? '')) + ' |')
lines.push('', 'Total: ' + passed + '/' + results.length + ' passed.')
fs.writeFileSync('docs/oidc-test-results.md', lines.join('\n'))
console.log('wrote docs/oidc-test-results.md')
if (failed.length) process.exit(1)
