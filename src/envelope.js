// Envelope encryption for the v2 vault: one data key (DEK) encrypts every item,
// and the DEK is wrapped separately for each thing allowed to open the vault.
//
// Fetch nothing, Buffer nothing: this file runs in a Worker and in Node alike,
// so a Durable Object, a CLI and a test share one implementation.
//
// Two ways to wrap the DEK, and only two:
//   password  PBKDF2 -> AES-GCM. Proves knowledge of the vault password.
//   device    ephemeral ECDH P-256 -> HKDF -> AES-GCM. Proves ownership of a
//             private key that never leaves the machine.
// A server-issued token is deliberately NOT a wrapping key: whatever the server
// can unwrap, the server can read, and that is not zero knowledge.

const ITERATIONS = 600000
const SALT_BYTES = 16
const IV_BYTES = 12
const decoder = new TextDecoder()

const enc = new TextEncoder()

export async function newDek() {
  return crypto.getRandomValues(new Uint8Array(32))
}

function bytesToBase64(bytes) {
  let text = ''
  // Chunked: spreading a multi-kilobyte array into fromCharCode throws.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000))
  }
  return btoa(text)
}

function base64ToBytes(value) {
  const text = atob(String(value || ''))
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index)
  return bytes
}

async function derivePasswordKek(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256)
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function aesGcmKey(rawBytes) {
  return crypto.subtle.importKey('raw', rawBytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// AAD pins the ciphertext to the row it belongs to, so two rows cannot be swapped.
function aadFor(id) {
  return enc.encode('sb-v2|' + String(id))
}

export async function sealItem(dek, id, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await aesGcmKey(dek)
  const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(id) }, key, enc.encode(JSON.stringify(payload)))
  return 'v2.' + bytesToBase64(iv) + '.' + bytesToBase64(new Uint8Array(body))
}

export async function openItem(dek, id, ciphertext) {
  const parts = String(ciphertext || '').split('.')
  if (parts.length !== 3 || parts[0] !== 'v2') throw new Error('not a v2 item ciphertext')
  const key = await aesGcmKey(dek)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(parts[1]), additionalData: aadFor(id) },
    key,
    base64ToBytes(parts[2]),
  )
  return JSON.parse(decoder.decode(plain))
}

export async function wrapDekPassword(dek, password, options = {}) {
  const iterations = Math.max(100000, Number(options.iterations) || ITERATIONS)
  const salt = options.salt ? base64ToBytes(options.salt) : crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const kek = await derivePasswordKek(password, salt, iterations)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, dek)
  return JSON.stringify({ kind: 'password', v: 2, iterations, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(wrapped)) })
}

export async function unwrapDekPassword(envelope, password) {
  const box = typeof envelope === 'string' ? JSON.parse(envelope) : envelope
  if (!box || box.kind !== 'password') throw new Error('not a password envelope')
  const kek = await derivePasswordKek(password, base64ToBytes(box.salt), Number(box.iterations) || ITERATIONS)
  const dek = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(box.iv) },
    kek,
    base64ToBytes(box.ct),
  )
  return new Uint8Array(dek)
}

export async function newDeviceKeypair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  return {
    publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  }
}

async function deviceKek(privateJwk, peerPublicJwk, saltText) {
  const priv = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const pub = await crypto.subtle.importKey('jwk', peerPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256)
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
  // The salt is the ephemeral public key on both sides, so wrapping the same
  // data key twice never reuses a wrapping key.
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(saltText), info: enc.encode('sb-v2-dek') }, base, 256)
  return aesGcmKey(new Uint8Array(bits))
}

export async function wrapDekDevice(dek, devicePublicJwk) {
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const ephemeralJwk = await crypto.subtle.exportKey('jwk', ephemeral.publicKey)
  const priv = await crypto.subtle.exportKey('jwk', ephemeral.privateKey)
  const kek = await deviceKek(priv, devicePublicJwk, JSON.stringify(ephemeralJwk))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, dek)
  return JSON.stringify({ kind: 'device', v: 2, ephemeralJwk, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(wrapped)) })
}

export async function unwrapDekDevice(envelope, devicePrivateJwk) {
  const box = typeof envelope === 'string' ? JSON.parse(envelope) : envelope
  if (!box || box.kind !== 'device') throw new Error('not a device envelope')
  const kek = await deviceKek(devicePrivateJwk, box.ephemeralJwk, JSON.stringify(box.ephemeralJwk))
  const dek = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(box.iv) },
    kek,
    base64ToBytes(box.ct),
  )
  return new Uint8Array(dek)
}

// A short label for logs and "which keyring is this" lists. Never the DEK.
export async function dekFingerprint(dek) {
  const digest = await crypto.subtle.digest('SHA-256', dek)
  const bytes = new Uint8Array(digest)
  return [...bytes.slice(0, 6)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Eight hex characters of a public key, so a human can compare the terminal
// line with the browser before approving. Public key material only, and derived
// from a fixed field order so both sides hash the same bytes.
export async function publicKeyFingerprint(publicJwk) {
  const canonical = JSON.stringify({ kty: publicJwk?.kty ?? '', crv: publicJwk?.crv ?? '', x: publicJwk?.x ?? '', y: publicJwk?.y ?? '' })
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(canonical))
  const hex = [...new Uint8Array(digest).slice(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  return hex.slice(0, 4) + '-' + hex.slice(4, 8)
}
