// EdDSA (Ed25519) id_token verification. auth-cf.otscup.com signs with EdDSA,
// and the verify path only accepted RS*/ES*, so every sign-in through it failed
// at signature verification. Ed25519 imports as an OKP JWK and takes no hash.
import crypto from 'node:crypto'
import { parseJwt, verifyJwtSignature, validateIdTokenClaims, ALLOWED_ALGS } from './src/oidc.js'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

// Node exposes Ed25519 keys directly; export the public half as the OKP JWK a
// JWKS would carry.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const okpJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'ed-1', use: 'sig', alg: 'EdDSA' }
const b64url = (buf) => Buffer.from(buf).toString('base64url')

function signEdDsa({ claims = {}, kid = 'ed-1', tamper = false }) {
  const header = { alg: 'EdDSA', kid, typ: 'JWT' }
  const input = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims))
  const signature = crypto.sign(null, Buffer.from(input), privateKey)
  if (tamper) signature[0] ^= 0xff
  return input + '.' + b64url(signature)
}

const nowSec = Math.floor(Date.now() / 1000)
const future = nowSec + 600
const claims = { iss: 'https://auth-cf.example', aud: 'cid', sub: 'user-1', exp: future, iat: nowSec - 60, nonce: 'n-1' }

// E1: EdDSA is on the accepted list
if (ALLOWED_ALGS.has('EdDSA')) pass('E1 EdDSA is an accepted id_token algorithm')
else fail('E1', [...ALLOWED_ALGS].join(','))

// E2: a correctly signed EdDSA token verifies
{
  const parsed = parseJwt(signEdDsa({ claims }))
  try {
    const result = await verifyJwtSignature(parsed, { keys: [okpJwk] })
    if (result.alg === 'EdDSA' && result.kid === 'ed-1') pass('E2 an EdDSA id_token verifies against an OKP key')
    else fail('E2', JSON.stringify(result))
  } catch (error) { fail('E2', error.message) }
}

// E3: a tampered EdDSA signature is rejected
{
  const parsed = parseJwt(signEdDsa({ claims, tamper: true }))
  let rejected = false
  try { await verifyJwtSignature(parsed, { keys: [okpJwk] }) } catch { rejected = true }
  if (rejected) pass('E3 a tampered EdDSA signature is rejected')
  else fail('E3', 'tampered signature accepted')
}

// E4: EdDSA must not verify against an RSA key of the same kid
{
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const rsaJwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'ed-1', use: 'sig' }
  const parsed = parseJwt(signEdDsa({ claims }))
  let rejected = false
  try { await verifyJwtSignature(parsed, { keys: [rsaJwk] }) } catch { rejected = true }
  if (rejected) pass('E4 EdDSA refuses a non-OKP key with the same kid')
  else fail('E4', 'an RSA key verified an EdDSA token')
}

// E5: alg=none is still refused
{
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const input = header + '.' + b64url(JSON.stringify(claims))
  const parsed = parseJwt(input + '.')
  let rejected = false
  try { await verifyJwtSignature(parsed, { keys: [okpJwk] }) } catch { rejected = true }
  if (rejected) pass('E5 alg=none is still refused')
  else fail('E5', 'alg=none accepted')
}

// E6: the full claim check still passes on a verified EdDSA token, so the
// algorithm change did not loosen any other rule.
{
  const parsed = parseJwt(signEdDsa({ claims }))
  await verifyJwtSignature(parsed, { keys: [okpJwk] })
  try {
    validateIdTokenClaims(parsed.payload, { issuer: 'https://auth-cf.example', clientId: 'cid', nonce: 'n-1' })
    pass('E6 a verified EdDSA token passes full claim validation')
  } catch (error) { fail('E6', error.message) }
}

// E7: a nonce mismatch is still refused after verification
{
  const parsed = parseJwt(signEdDsa({ claims }))
  await verifyJwtSignature(parsed, { keys: [okpJwk] })
  let rejected = false
  try { validateIdTokenClaims(parsed.payload, { issuer: 'https://auth-cf.example', clientId: 'cid', nonce: 'other' }) } catch { rejected = true }
  if (rejected) pass('E7 EdDSA does not bypass the nonce check')
  else fail('E7', 'nonce mismatch accepted')
}

const passed = results.filter((r) => r.ok).length
console.log('\n==== eddsa oidc ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
