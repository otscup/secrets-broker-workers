/**
 * The private key that unwraps the vault key must not sit in a readable file.
 *
 * On Windows it goes to DPAPI and device.json keeps only a pointer; on other
 * platforms there is no such store here, so the file keeps the key and these
 * cases check the pointer-free shape still opens. Either way a pairing made
 * before this change keeps working.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { newDek, newDeviceKeypair, wrapDekDevice, sealItem, dekFingerprint } from './src/envelope.js'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-devkey-'))
process.env.BROKER_HOME = home
const results = []

async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log('FAIL ' + name + ' :: ' + (error?.message ?? error))
  }
}

const dek = await newDek()
const fingerprint = await dekFingerprint(dek)
const realFetch = globalThis.fetch
const deviceFile = path.join(home, 'device.json')

const { pair, pull, loadDevice } = await import('./cli/vault.mjs')
const { savePull } = await import('./cli/cache.mjs')

// Pair against a server that answers with an envelope wrapped to the key the
// client just sent, which is what the real endpoint does.
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body)
  return new Response(JSON.stringify({
    id: 'dev-1',
    name: body.name,
    envelope: await wrapDekDevice(dek, body.publicKey),
    token: 'device-token-for-the-test',
    fingerprint,
  }), { status: 200 })
}
try {
  await pair({ url: 'https://devkey.invalid', cookie: 'session=test', name: 'test-machine' })
} finally {
  globalThis.fetch = realFetch
}

savePull({
  url: 'https://devkey.invalid',
  revision: 4,
  rows: [{ id: 'item-1', kind: 'api', revision: 4, updatedAt: '2026-10-26T12:00:00Z', ciphertext: await sealItem(dek, 'item-1', { name: 'openai', secret: 'sk-devkey-123456' }) }],
})

await check('D1 the pairing file keeps no readable private key', () => {
  const raw = fs.readFileSync(deviceFile, 'utf8')
  const record = JSON.parse(raw)
  if (process.platform === 'win32') {
    assert.ok(!record.privateJwk, 'the private key is still in the file')
    assert.equal(record.privateKeyStore, 'dpapi')
    assert.ok(fs.existsSync(path.join(home, 'device-key.dpapi')), 'the OS store holds nothing')
  } else {
    assert.ok(record.privateJwk, 'without an OS store the key has to stay in the file')
  }
  assert.ok(!raw.includes('sk-devkey-123456'), 'no secret may reach the pairing file')
})

await check('D2 a pull still opens after the key moved to the OS store', async () => {
  globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND devkey.invalid') }
  try {
    const local = await pull({ since: 0 })
    assert.equal(local.items[0].payload.secret, 'sk-devkey-123456')
  } finally {
    globalThis.fetch = realFetch
  }
})

await check('D3 a pairing made before this change still opens', async () => {
  const record = loadDevice()
  const keypair = await newDeviceKeypair()
  fs.writeFileSync(deviceFile, JSON.stringify({
    ...record,
    privateJwk: keypair.privateJwk,
    privateKeyStore: undefined,
    envelope: await wrapDekDevice(dek, keypair.publicJwk),
  }, null, 2))
  globalThis.fetch = async () => { throw new Error('offline') }
  try {
    const local = await pull({ since: 0 })
    assert.equal(local.items[0].payload.secret, 'sk-devkey-123456')
  } finally {
    globalThis.fetch = realFetch
  }
})

await check('D4 a pairing with no key left says so instead of failing oddly', async () => {
  const record = loadDevice()
  fs.writeFileSync(deviceFile, JSON.stringify({ ...record, privateJwk: undefined, privateKeyStore: undefined }, null, 2))
  try {
    await pull({ since: 0 })
    throw new Error('a pairing without a key should not open the vault')
  } catch (error) {
    assert.match(String(error.message), /no private key|pair/)
  }
})

const failed = results.filter((result) => !result.ok)
console.log(`\n==== pairing key ${results.length - failed.length}/${results.length} passed ====`)
try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
if (failed.length) {
  for (const result of failed) console.log(result.error?.stack ?? '')
  process.exit(1)
}
