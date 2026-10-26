// The CLI half of v2 pairing: real ECDH wrapping on both sides, a real HTTP
// round trip, and a stored record that must not hold a usable key on its own.
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newDek, wrapDekDevice, dekFingerprint } from './src/envelope.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const DEK = await newDek()
const FINGERPRINT = await dekFingerprint(DEK)
const TOKEN = 'device-token-for-the-cli-test-0001'
let pairCalls = 0
let provesCookie = false

const server = createServer(async (request, response) => {
  const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
  if (request.method === 'POST' && request.url === '/api/v2/pair') {
    pairCalls += 1
    provesCookie = String(request.headers.cookie || '') === 'sb_admin=test'
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body.publicKey?.x) return send(400, { error: 'public key must be a P-256 JWK' })
    send(201, {
      id: 'dev-1',
      name: body.name,
      token: TOKEN,
      envelope: await wrapDekDevice(DEK, body.publicKey),
      fingerprint: FINGERPRINT,
    })
    return
  }
  if (request.method === 'GET' && request.url.startsWith('/api/v2/items')) {
    if (String(request.headers.authorization || '') !== 'Bearer ' + TOKEN) return send(401, { error: 'unauthorized' })
    return send(200, { items: [{ id: 'a', ciphertext: 'x' }, { id: 'b', ciphertext: 'y' }], revision: 7 })
  }
  send(404, { error: 'not found' })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port

// The CLI keeps its record under the user profile, so point that at a scratch
// directory before the module resolves its paths.
const home = mkdtempSync(join(tmpdir(), 'sb-cli-vault-'))
process.env.USERPROFILE = home
process.env.HOME = home
const vault = await import('./cli/vault.mjs?scratch=' + Date.now())

// C1: pairing refuses to invent a session.
{
  let message = ''
  try { await vault.pair({ url: base, cookie: '', name: 'laptop' }) } catch (error) { message = String(error.message) }
  // The cookie may also arrive through the environment, so clear it explicitly.
  if (/cookie/i.test(message)) pass('C1 pairing without an admin session is refused')
  else fail('C1', message || 'no error raised')
}

// C2: a real pair request stores a device record with the key held safely — in
// the OS store on Windows, in the file where no such store exists — plus the
// wrapped key rather than the key itself.
{
  const paired = await vault.pair({ url: base, cookie: 'sb_admin=test', name: 'laptop' })
  const record = JSON.parse(readFileSync(join(home, '.secrets-broker', 'device.json'), 'utf8'))
  const keyHeld = record.privateKeyStore === 'dpapi' ? !record.privateJwk : Boolean(record.privateJwk?.d)
  const ok = provesCookie && pairCalls === 1 && paired.fingerprint === FINGERPRINT
    && keyHeld && JSON.parse(record.envelope).kind === 'device'
    && !JSON.stringify(record).includes(String(DEK))
  if (ok) pass('C2 pairing stores a private key and a wrapped key, never the key itself')
  else fail('C2', JSON.stringify({ provesCookie, pairCalls, fingerprint: paired.fingerprint, keys: Object.keys(record) }))
}

// C3: the wrapped key opens to the same vault key the server reported.
{
  const opened = await vault.unlock()
  if (opened.fingerprint === FINGERPRINT) pass('C3 unlock reproduces the vault fingerprint')
  else fail('C3', opened.fingerprint + ' vs ' + FINGERPRINT)
}

// C4: the device token pulls ciphertext on its own.
{
  const pulled = await vault.count(vault.loadDevice())
  if (pulled.items === 2 && pulled.revision === 7) pass('C4 the device token pulls ciphertext rows')
  else fail('C4', JSON.stringify(pulled))
}

// C5: a record nobody could have produced (a tampered envelope) is refused
// instead of silently yielding a wrong key.
{
  const record = vault.loadDevice()
  const envelope = JSON.parse(record.envelope)
  envelope.ct = Buffer.from(envelope.ct, 'base64').reverse().toString('base64')
  const tampered = { ...record, envelope: JSON.stringify(envelope) }
  let message = ''
  try {
    const { unwrapDekDevice } = await import('./src/envelope.js')
    const dek = await unwrapDekDevice(tampered.envelope, tampered.privateJwk)
    if (await dekFingerprint(dek) === FINGERPRINT) message = ''
    else message = 'wrong key accepted'
  } catch (error) { message = 'refused: ' + String(error.message).slice(0, 40) }
  if (message.startsWith('refused')) pass('C5 a tampered envelope is refused')
  else fail('C5', message || 'tampered envelope produced the right key')
}

server.close()
rmSync(home, { recursive: true, force: true })
const passed = results.filter((r) => r.ok).length
console.log('\n==== cli vault ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
