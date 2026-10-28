import assert from 'node:assert/strict'
import { generateVapid, vapidAuthorization } from './src/webpush.js'

const pair = await generateVapid()
assert.equal(pair.publicKey.length, 87, 'P-256 uncompressed point is 65 bytes')
assert.match(pair.publicKey, /^[A-Za-z0-9_-]+$/)

const authorization = await vapidAuthorization('https://push.example.com/send/abc', pair.publicKey, pair.privateJwk)
assert.match(authorization, /^vapid t=.+, k=.+$/)
const token = authorization.slice('vapid t='.length, authorization.indexOf(', k='))
const [header, payload, signature] = token.split('.')
assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256')
assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).aud, 'https://push.example.com')
assert.ok(signature.length > 80)
console.log('webpush ok')
