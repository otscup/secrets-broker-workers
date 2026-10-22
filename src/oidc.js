/* Pure OIDC ID-token verification helpers. No platform-specific imports:
 * uses globalThis.crypto (WebCrypto) + TextEncoder/TextDecoder, so the same
 * module runs in the Cloudflare Worker and in Node unit tests.
 * Every failure is an Error with a stable, human-readable reason; callers must
 * treat any throw as a hard reject (never fall back to userinfo-only trust).
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const ALG_PARAMS = {
  RS256: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  RS384: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
  RS512: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
  ES256: { name: 'ECDSA', hash: 'SHA-256' },
  ES384: { name: 'ECDSA', hash: 'SHA-384' },
  ES512: { name: 'ECDSA', hash: 'SHA-512' },
  // Ed25519. auth-cf (better-auth) signs id_tokens with EdDSA, so without this
  // every sign-in through it failed at signature verification.
  EdDSA: { name: 'Ed25519' },
}

// Algorithms accepted for an id_token signature. EdDSA is Ed25519 only: Ed448
// is not what any of our providers issue and WebCrypto does not expose it.
export const ALLOWED_ALGS = new Set(Object.keys(ALG_PARAMS))

const EC_CURVE = { ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' }

let webcrypto = globalThis.crypto

/** Allow tests to inject Node's webcrypto implementation. */
export function setOidcCrypto(impl) {
  webcrypto = impl ?? globalThis.crypto
}

function b64urlDecode(text) {
  const clean = String(text).replace(/-/g, '+').replace(/_/g, '/')
  const pad = clean.length % 4 === 0 ? '' : '='.repeat(4 - (clean.length % 4))
  return Uint8Array.from(atob(clean + pad), (c) => c.charCodeAt(0))
}

export function b64urlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Split a JWS into { header, payload, signingInput, signature }. Throws on malformed input. */
export function parseJwt(token) {
  if (typeof token !== 'string' || !token) throw new Error('missing id_token')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('malformed id_token: expected three JWS segments')
  if (!/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]*$/.test(parts[2])) throw new Error('malformed id_token: bad segment characters')
  let header = null
  let payload = null
  try {
    header = JSON.parse(decoder.decode(b64urlDecode(parts[0])))
    payload = JSON.parse(decoder.decode(b64urlDecode(parts[1])))
  } catch { throw new Error('malformed id_token: header/payload are not valid JSON') }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') throw new Error('malformed id_token: header/payload must be JSON objects')
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: parts[2] }
}

/**
 * Verify the JWS signature against a JWKS document.
 * Requires alg in ALLOWED_ALGS; picks keys by kid (falls back to scanning when
 * kid is absent), filters by use/key_ops/alg, and rejects on any mismatch.
 * Returns { alg, kid, keyId } on success; throws on failure.
 */
export async function verifyJwtSignature(parsed, jwks) {
  const { header, signingInput, signature } = parsed
  const alg = header.alg
  if (typeof alg !== 'string' || !ALLOWED_ALGS.has(alg)) throw new Error(`unsupported id_token alg: ${String(alg)}`)
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : []
  if (!keys.length) throw new Error('jwks contains no keys')
  const candidates = typeof header.kid === 'string' ? keys.filter((key) => key?.kid === header.kid) : keys.slice()
  const usable = candidates.filter((key) => {
    if (!key || typeof key !== 'object' || typeof key.kty !== 'string') return false
    if (key.use && key.use !== 'sig') return false
    if (Array.isArray(key.key_ops) && key.key_ops.length && !key.key_ops.includes('verify')) return false
    if (key.alg && key.alg !== alg) return false
    if (EC_CURVE[alg] && key.kty === 'EC' && key.crv && key.crv !== EC_CURVE[alg]) return false
    // EdDSA is Ed25519 only, and only an OKP key can verify it. Rejecting the
    // wrong key type here turns a confusing import error into a clear reason.
    if (alg === 'EdDSA' && (key.kty !== 'OKP' || (key.crv && key.crv !== 'Ed25519'))) return false
    return true
  })
  if (!usable.length) throw new Error('no jwks key matches id_token (kid/key mismatch)')
  if (!webcrypto?.subtle) throw new Error('WebCrypto unavailable')
  const base = ALG_PARAMS[alg]
  // Ed25519 takes no hash: its import/verify params are just the algorithm name.
  const params = alg === 'EdDSA'
    ? { name: base.name }
    : (EC_CURVE[alg] ? { name: base.name, hash: base.hash, namedCurve: EC_CURVE[alg] } : { name: base.name, hash: base.hash })
  const data = encoder.encode(signingInput)
  const signatureBytes = b64urlDecode(signature)
  let lastError = new Error('id_token signature verification failed')
  for (const key of usable.slice(0, 8)) {
    try {
      const cryptoKey = await webcrypto.subtle.importKey('jwk', key, params, false, ['verify'])
      const ok = await webcrypto.subtle.verify(params, cryptoKey, signatureBytes, data)
      if (ok) return { alg, kid: typeof header.kid === 'string' ? header.kid : null, keyId: key.kid ?? null }
    } catch (error) { lastError = error }
  }
  throw lastError
}

/**
 * Strict claim validation per OIDC Core 3.1.3.7: iss exact match, aud contains
 * clientId (azp required for multi-audience and must equal clientId), exp in
 * the future (leeway allowed), nbf/iat sanity, nonce exact match, sub present.
 * Throws on any violation.
 */
export function validateIdTokenClaims(payload, { issuer, clientId, nonce, now = Date.now(), leewayMs = 60000 }) {
  if (!payload || typeof payload !== 'object') throw new Error('id_token claims missing')
  if (typeof payload.iss !== 'string' || payload.iss !== issuer) throw new Error(`issuer mismatch (expected ${issuer})`)
  const aud = payload.aud
  const matchesAud = Array.isArray(aud) ? aud.includes(clientId) : aud === clientId
  if (!matchesAud) throw new Error('audience mismatch')
  if (Array.isArray(aud) && aud.length > 1 && payload.azp !== clientId) throw new Error('azp mismatch (multi-audience requires azp=client_id)')
  if (payload.azp != null && payload.azp !== clientId) throw new Error('azp mismatch')
  const nowSec = Math.floor(now / 1000)
  const leewaySec = Math.floor(leewayMs / 1000)
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= nowSec - leewaySec) throw new Error('id_token expired')
  if (payload.nbf != null && (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || payload.nbf > nowSec + leewaySec)) throw new Error('id_token not yet valid')
  if (payload.iat != null && typeof payload.iat === 'number' && payload.iat > nowSec + leewaySec) throw new Error('id_token iat in the future')
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('id_token subject missing')
  if (typeof nonce !== 'string' || !nonce) throw new Error('nonce not provided by broker')
  if (payload.nonce !== nonce) throw new Error('nonce mismatch')
  return payload
}

/** userinfo sub must equal the verified id_token sub; no fallback. */
export function checkUserinfoSub(userinfoSub, idTokenSub) {
  if (typeof idTokenSub !== 'string' || !idTokenSub) throw new Error('id_token subject missing')
  if (typeof userinfoSub !== 'string' || userinfoSub !== idTokenSub) throw new Error('userinfo sub does not match id_token sub')
  return true
}

/** Replay protection registry helpers (state/nonce single-use). */
export function isUsedState(usedMap, key, { now = Date.now(), ttlMs = 15 * 60 * 1000 } = {}) {
  const entry = usedMap?.[key]
  if (!entry) return false
  return typeof entry.at === 'number' && now - entry.at <= ttlMs
}

export function markUsedState(usedMap, key, { now = Date.now(), ttlMs = 15 * 60 * 1000, maxEntries = 5000 } = {}) {
  const out = { ...(usedMap ?? {}) }
  for (const [k, entry] of Object.entries(out)) {
    if (typeof entry?.at !== 'number' || now - entry.at > ttlMs) delete out[k]
  }
  out[key] = { at: now }
  const entries = Object.entries(out)
  if (entries.length > maxEntries) {
    entries.sort((a, b) => (a[1]?.at ?? 0) - (b[1]?.at ?? 0))
    for (const [k] of entries.slice(0, entries.length - maxEntries)) delete out[k]
  }
  return out
}
