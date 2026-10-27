// Web Push without a payload: the push service only wakes the service worker,
// which reads the pending request from the API while the browser has the
// operator's session cookies. That keeps this module to VAPID signing and
// avoids reimplementing RFC 8291 payload encryption.
const textEncoder = new TextEncoder()

export function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlJson(value) {
  return b64url(textEncoder.encode(JSON.stringify(value)))
}

export async function generateVapid() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKey = b64url(await crypto.subtle.exportKey('raw', pair.publicKey))
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { publicKey, privateJwk }
}

export async function vapidAuthorization(endpoint, publicKey, privateJwk, subject = 'mailto:admin@otscup.com') {
  const audience = new URL(endpoint).origin
  const header = b64urlJson({ typ: 'JWT', alg: 'ES256' })
  const payload = b64urlJson({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, textEncoder.encode(`${header}.${payload}`))
  return `vapid t=${header}.${payload}.${b64url(signature)}, k=${publicKey}`
}
