// The v2 envelope: one data key, wrapped for a password and for each device.
// These assertions are the contract the D1 schema will be built on, so they run
// without a Worker: pure WebCrypto, the same code a CLI would call.
import {
  newDek, sealItem, openItem,
  wrapDekPassword, unwrapDekPassword,
  newDeviceKeypair, wrapDekDevice, unwrapDekDevice,
  dekFingerprint,
} from './src/envelope.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const rejects = async (run) => { try { await run(); return false } catch { return true } }
const same = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index])

const FAST = { iterations: 100000 }
const dek = await newDek()

// E1: the password envelope gives back the same key it wrapped.
{
  const envelope = await wrapDekPassword(dek, 'correct horse battery staple', FAST)
  const opened = await unwrapDekPassword(envelope, 'correct horse battery staple')
  if (same(opened, dek)) pass('E1 a password envelope round-trips the data key')
  else fail('E1', 'data key changed')
}

// E2: a wrong password cannot open it.
{
  const envelope = await wrapDekPassword(dek, 'right', FAST)
  if (await rejects(() => unwrapDekPassword(envelope, 'wrong'))) pass('E2 a wrong password fails instead of returning garbage')
  else fail('E2', 'wrong password opened the envelope')
}

// E3: a device envelope belongs to one keypair. Another device cannot open it.
{
  const laptop = await newDeviceKeypair()
  const phone = await newDeviceKeypair()
  const envelope = await wrapDekDevice(dek, laptop.publicJwk)
  const opened = await unwrapDekDevice(envelope, laptop.privateJwk)
  const stranger = await rejects(() => unwrapDekDevice(envelope, phone.privateJwk))
  if (same(opened, dek) && stranger) pass('E3 a device envelope opens only for that device key')
  else fail('E3', JSON.stringify({ opened: same(opened, dek), stranger }))
}

// E4: an item is bound to its row id, so a stolen ciphertext cannot be moved to
// another row, and a flipped byte fails instead of decrypting to nonsense.
{
  const sealed = await sealItem(dek, 'item-1', { name: 'openai', secret: 'sk-test' })
  const opened = await openItem(dek, 'item-1', sealed)
  const moved = await rejects(() => openItem(dek, 'item-2', sealed))
  const flipped = sealed.slice(0, -2) + (sealed.slice(-2) === 'AA' ? 'BB' : 'AA')
  const tampered = await rejects(() => openItem(dek, 'item-1', flipped))
  const ok = opened.secret === 'sk-test' && moved && tampered
  if (ok) pass('E4 items are bound to their row and reject tampering')
  else fail('E4', JSON.stringify({ opened, moved, tampered }))
}

// E5: changing the password re-wraps the data key and leaves items untouched —
// the whole reason for a DEK layer.
{
  const first = await wrapDekPassword(dek, 'old-password', FAST)
  const sealed = await sealItem(dek, 'item-1', { secret: 'unchanged' })
  const again = await wrapDekPassword(await unwrapDekPassword(first, 'old-password'), 'new-password', FAST)
  const opened = await openItem(await unwrapDekPassword(again, 'new-password'), 'item-1', sealed)
  if (opened.secret === 'unchanged') pass('E5 a password change re-wraps the key without touching items')
  else fail('E5', JSON.stringify(opened))
}

// E6: neither envelope carries the data key in the clear.
{
  const dekText = Buffer.from(dek).toString('base64').slice(0, 16)
  const password = await wrapDekPassword(dek, 'pw', FAST)
  const device = await wrapDekDevice(dek, (await newDeviceKeypair()).publicJwk)
  if (!password.includes(dekText) && !device.includes(dekText)) pass('E6 no envelope carries the data key in the clear')
  else fail('E6', 'data key visible in an envelope')
}

// E7: the fingerprint names a keyring without revealing it.
{
  const a = await dekFingerprint(dek)
  const b = await dekFingerprint(await newDek())
  if (/^[0-9a-f]{12}$/.test(a) && a !== b) pass('E7 the fingerprint is short, stable and per key')
  else fail('E7', JSON.stringify({ a, b }))
}

const passed = results.filter((r) => r.ok).length
console.log('\n==== envelope ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
