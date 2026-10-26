// The local half of v2: pair this machine, then prove the wrapped key opens.
// The private key never leaves this file, and nothing here asks the server to
// decrypt.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { newDeviceKeypair, unwrapDekDevice, dekFingerprint } from '../src/envelope.js'

const DIR = join(homedir(), '.secrets-broker')
const FILE = join(DIR, 'device.json')

export function deviceFile() {
  return FILE
}

export function loadDevice() {
  if (!existsSync(FILE)) return null
  return JSON.parse(readFileSync(FILE, 'utf8'))
}

function saveDevice(record) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  writeFileSync(FILE, JSON.stringify(record, null, 2), { mode: 0o600 })
}

// Pairing needs an admin session, which the server accepts as a cookie. Until
// the device-code flow exists, that cookie is the handover.
export async function pair({ url, cookie, name = 'this computer' }) {
  if (!url) throw new Error('a broker url is required')
  if (!cookie) throw new Error('pairing needs an admin session cookie (the panel hands it out after login)')
  const keypair = await newDeviceKeypair()
  const endpoint = String(url).replace(/\/+$/, '') + '/api/v2/pair'
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name, publicKey: keypair.publicJwk }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error('pairing failed (' + response.status + '): ' + text.slice(0, 300))
  const body = JSON.parse(text)
  saveDevice({
    url: String(url).replace(/\/+$/, ''),
    deviceId: body.id,
    name: body.name,
    privateJwk: keypair.privateJwk,
    envelope: body.envelope,
    token: body.token,
    fingerprint: body.fingerprint,
    pairedAt: new Date().toISOString(),
  })
  return { id: body.id, name: body.name, fingerprint: body.fingerprint, file: FILE }
}

export async function unlock() {
  const record = loadDevice()
  if (!record) throw new Error('no paired device yet: run `secrets-broker pair --url <broker>` first')
  const dek = await unwrapDekDevice(record.envelope, record.privateJwk)
  if (dek.length !== 32) throw new Error('the stored envelope did not unwrap to a 32-byte key')
  const fingerprint = await dekFingerprint(dek)
  if (record.fingerprint && fingerprint !== record.fingerprint) throw new Error('the unwrapped key does not match the vault this device paired with')
  return { fingerprint, name: record.name, url: record.url, pairedAt: record.pairedAt }
}

// Ciphertext pull with the device token: this is what keeps working while the
// server-side vault is locked.
export async function count(record) {
  const response = await fetch(record.url + '/api/v2/items?since=0', { headers: { authorization: 'Bearer ' + record.token } })
  if (!response.ok) return { error: 'HTTP ' + response.status }
  const body = await response.json()
  return { items: (body.items || []).length, revision: body.revision }
}
