/**
 * End-to-end check of the offline path: a paired device, a local ciphertext
 * copy, and no network. Uses the real envelope crypto, so this proves the
 * fallback actually decrypts rather than only returning rows.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { newDek, newDeviceKeypair, wrapDekDevice, sealItem, dekFingerprint } from './src/envelope.js'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-offline-'))
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

// Build the machine state a real pairing leaves behind: the private key here,
// the same DEK wrapped to it, and the ciphertext the server had handed over.
const dek = await newDek()
const keypair = await newDeviceKeypair()
const envelope = await wrapDekDevice(dek, keypair.publicJwk)
fs.writeFileSync(path.join(home, 'device.json'), JSON.stringify({
  name: 'test-machine',
  url: 'https://offline.invalid',
  token: 'device-token-for-the-test',
  privateJwk: keypair.privateJwk,
  envelope,
  fingerprint: await dekFingerprint(dek),
  pairedAt: new Date().toISOString(),
}, null, 2))

const { savePull, loadPull } = await import('./cli/cache.mjs')
const { pull } = await import('./cli/vault.mjs')

savePull({
  url: 'https://offline.invalid',
  revision: 12,
  rows: [{ id: 'item-1', kind: 'api', revision: 12, updatedAt: '2026-10-26T12:00:00Z', ciphertext: await sealItem(dek, 'item-1', { name: 'openai', secret: 'sk-offline-123456' }) }],
})

const realFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND offline.invalid') }

let offline
try {
  offline = await pull({ since: 0 })
} finally {
  globalThis.fetch = realFetch
}

await check('O1 an offline pull serves the local copy and says it is old', () => {
  assert.equal(offline.items.length, 1)
  assert.equal(offline.items[0].payload.secret, 'sk-offline-123456')
  assert.ok(offline.stale, 'the reply must be marked stale')
  assert.match(offline.stale.reason, /ENOTFOUND/)
})

await check('O2 the cached row still opens with the key on this machine', () => {
  const loaded = loadPull({ since: 0 })
  assert.equal(loaded.rows.length, 1)
  assert.ok(!JSON.stringify(loaded.rows).includes('sk-offline-123456'), 'the copy holds ciphertext only')
})

await check('O3 a revoked device hears the error instead of an old copy', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  try {
    await pull({ since: 0 })
    throw new Error('a 401 should not be answered from cache')
  } catch (error) {
    assert.match(String(error.message), /401/)
  } finally {
    globalThis.fetch = realFetch
  }
})

let attempts = 0
await check('O4 --offline answers from the copy without trying the network', async () => {
  globalThis.fetch = async () => { attempts += 1; throw new Error('the network must not be touched') }
  try {
    const local = await pull({ offline: true })
    assert.equal(attempts, 0, 'offline pull touched the network')
    assert.equal(local.items[0].payload.secret, 'sk-offline-123456')
    assert.equal(local.stale.reason, 'offline')
  } finally {
    globalThis.fetch = realFetch
  }
})

await check('O5 --offline with no copy yet says so instead of pretending', async () => {
  const { clearCache } = await import('./cli/cache.mjs')
  clearCache()
  try {
    await pull({ offline: true })
    throw new Error('an empty copy should not answer')
  } catch (error) {
    assert.match(String(error.message), /no local copy yet/)
  }
})

const failed = results.filter((result) => !result.ok)
console.log(`\n==== offline pull ${results.length - failed.length}/${results.length} passed ====`)
try { fs.rmSync(home, { recursive: true, force: true }) } catch {}
if (failed.length) {
  for (const result of failed) console.log(result.error?.stack ?? '')
  process.exit(1)
}
