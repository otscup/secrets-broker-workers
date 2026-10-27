// The local half of v2: pair this machine, then prove the wrapped key opens.
// The private key never leaves this file, and nothing here asks the server to
// decrypt.
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { newDeviceKeypair, unwrapDekDevice, dekFingerprint, openItem, sealItem } from '../src/envelope.js'
import { loadPull, savePull, clearCache, cacheFile } from './cache.mjs'
import { protectSecret, unprotectSecret } from './store.mjs'

// BROKER_HOME keeps a second broker (or a test) from touching the real pairing.
const DIR = process.env.BROKER_HOME || join(homedir(), '.secrets-broker')
const FILE = join(DIR, 'device.json')
const KEY_FILE = join(DIR, 'device-key.dpapi')

export function deviceFile() {
  return FILE
}

export function loadDevice() {
  if (!existsSync(FILE)) return null
  return JSON.parse(readFileSync(FILE, 'utf8'))
}

// A revoked device is not allowed to keep reading, and its local ciphertext is
// no longer something we can vouch for. Forget both sides in one step.
export function forgetDevice() {
  for (const file of [FILE, KEY_FILE]) {
    try { rmSync(file, { force: true }) } catch {}
  }
  try { clearCache() } catch {}
  try { rmSync(cacheFile(), { force: true }) } catch {}
}

function saveDevice(record) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 })
  const saved = { ...record }
  // The private key unwraps the vault key, so it does not belong in a readable
  // JSON file: hand it to the OS store and keep only a pointer here.
  const key = saved.privateJwk
  delete saved.privateJwk
  if (key && protectSecret(KEY_FILE, JSON.stringify(key))) saved.privateKeyStore = 'dpapi'
  // shortcut: only Windows has an OS store wired here; macOS and Linux keep the
  // key in the file until store.mjs grows a keychain path for it.
  else if (key) saved.privateJwk = key
  writeFileSync(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 })
}

// Older pairings kept the key in the file; both shapes must keep opening.
function deviceKey(record) {
  if (record?.privateJwk) return record.privateJwk
  const stored = record?.privateKeyStore ? unprotectSecret(KEY_FILE) : ''
  return stored ? JSON.parse(stored) : null
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

// Device-code pairing: no cookie, no password on the command line. This machine
// asks for a short code, prints it beside the key fingerprint, and waits for an
// admin to approve the same fingerprint in a browser.
export async function pairRequest({ url, name = 'this computer' }) {
  if (!url) throw new Error('a broker url is required')
  const base = String(url).replace(/\/+$/, '')
  const keypair = await newDeviceKeypair()
  const response = await fetch(base + '/api/v2/pair/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, publicJwk: keypair.publicJwk }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error('pairing request failed (' + response.status + '): ' + text.slice(0, 300))
  const body = JSON.parse(text)
  return { base, keypair, code: body.code, pollToken: body.pollToken, url: body.url, fingerprint: body.fingerprint, expiresAt: body.expiresAt }
}

// The desktop app owns the window and the sidecar; the terminal only has to hand
// it the short code. The HTTP approval URL still goes to stdout as a fallback.
export function pairDeepLink({ base, code }) {
  return 'secrets-broker://pair?url=' + encodeURIComponent(base) + '&code=' + encodeURIComponent(code)
}

export async function pairPoll({ base, pollToken }) {
  const response = await fetch(base + '/api/v2/pair/poll', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pollToken }),
  })
  if (response.status === 202) return { status: 'pending' }
  if (response.status === 410) throw new Error('this pairing request expired or was already redeemed')
  const text = await response.text()
  if (!response.ok) throw new Error('pairing poll failed (' + response.status + '): ' + text.slice(0, 300))
  return JSON.parse(text)
}

export async function pairWait({ base, pollToken, keypair, name, timeoutMs = 5 * 60 * 1000 }) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await pairPoll({ base, pollToken })
    if (result.status === 'approved') {
      saveDevice({
        url: base,
        deviceId: result.deviceId,
        name,
        privateJwk: keypair.privateJwk,
        envelope: result.envelope,
        token: result.token,
        keygen: result.keygen,
        fingerprint: result.fingerprint,
        pairedAt: new Date().toISOString(),
      })
      return { id: result.deviceId, name, fingerprint: result.fingerprint, file: FILE }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('nobody approved the pairing within five minutes')
}

export async function unlock() {
  const { record, fingerprint } = await openLocal()
  return { fingerprint, name: record.name, url: record.url, pairedAt: record.pairedAt }
}

// Pull ciphertext and open it with the key this machine already holds. What
// comes back is plaintext on disk, so the caller decides where it goes.
export async function pull({ since = 0, offline = false } = {}) {
  const { dek, record } = await openLocal()
  const fromCopy = (reason) => {
    const cached = loadPull({ since })
    if (!cached.rows.length) return null
    return { revision: cached.revision, items: cached.rows, stale: { savedAt: cached.savedAt, reason } }
  }
  // Air-gapped: answer from the last copy, never touching the network.
  let body = offline ? fromCopy('offline') : null
  if (offline && !body) throw new Error('no local copy yet; run `secrets-broker pull` once while online')
  if (!body) {
    try {
      const response = await fetch(record.url + '/api/v2/items?since=' + Number(since || 0), { headers: { authorization: 'Bearer ' + record.token } })
      const text = await response.text()
      if (!response.ok) {
        const failure = new Error('pull failed (' + response.status + '): ' + text.slice(0, 300))
        failure.status = response.status
        throw failure
      }
      body = JSON.parse(text)
      // Keep a copy of the ciphertext, so a restart with no network still answers.
      try { savePull({ url: record.url, revision: body.revision, rows: body.items ?? [] }) } catch {}
    } catch (error) {
      // A revoked device must hear about it, not quietly read an old copy.
      // 403 is usually an edge/WAF refusal, so only 401 erases the pairing.
      if (error?.status === 401) {
        forgetDevice()
        throw error
      }
      body = fromCopy(String(error?.message ?? error).slice(0, 200))
      if (!body) throw error
    }
  }
  const items = []
  for (const row of body.items ?? []) {
    if (row.deletedAt) { items.push({ id: row.id, revision: row.revision, deleted: true }); continue }
    const payload = await openItem(dek, row.id, row.ciphertext).catch(() => null)
    items.push({ id: row.id, kind: row.kind, revision: row.revision, updatedAt: row.updatedAt, payload })
  }
  return { revision: body.revision, items, url: record.url, ...(body.stale ? { stale: body.stale } : {}) }
}

// Seal here, not there: the server is handed ciphertext and keeps its promise
// that it never sees a secret.
export async function push({ items } = {}) {
  const { dek, record } = await openLocal()
  const rows = []
  for (const item of items ?? []) {
    if (!item?.id) continue
    if (item.deleted) { rows.push({ id: item.id, kind: item.kind ?? 'api', ciphertext: '', deletedAt: new Date().toISOString() }); continue }
    if (!item.payload) continue
    rows.push({ id: item.id, kind: item.kind === 'web' ? 'web' : 'api', ciphertext: await sealItem(dek, item.id, item.payload) })
  }
  if (!rows.length) return { written: 0, revision: 0 }
  const response = await fetch(record.url + '/api/v2/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + record.token },
    body: JSON.stringify({ items: rows }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error('push failed (' + response.status + '): ' + text.slice(0, 300))
  return JSON.parse(text)
}

async function openLocal() {
  const record = loadDevice()
  if (!record) throw new Error('no paired device yet: run `secrets-broker pair --url <broker>` first')
  const key = deviceKey(record)
  if (!key) throw new Error('this machine kept no private key for its pairing; run `secrets-broker pair` again')
  let current = record
  let dek = await unwrapDekDevice(record.envelope, key).catch(() => null)
  let fingerprint = dek ? await dekFingerprint(dek) : null
  // A rekey replaced every envelope: the one on disk no longer opens. Ask the
  // server for the current one and unwrap it with the key this machine already
  // has, so a rotation never turns into a re-pairing.
  if (!fingerprint || (record.fingerprint && fingerprint !== record.fingerprint)) {
    const refreshed = await refreshEnvelope(record).catch(() => null)
    if (refreshed) {
      current = refreshed
      dek = await unwrapDekDevice(refreshed.envelope, key).catch(() => null)
      fingerprint = dek ? await dekFingerprint(dek) : null
    }
  }
  if (!dek || dek.length !== 32) throw new Error('the stored envelope did not unwrap to a 32-byte key')
  if (current.fingerprint && fingerprint !== current.fingerprint) throw new Error('the unwrapped key does not match the vault this device paired with')
  return { dek, fingerprint, record: current }
}

async function refreshEnvelope(record) {
  const response = await fetch(record.url + '/api/v2/device/self', { headers: { authorization: 'Bearer ' + record.token } })
  if (!response.ok) return null
  const body = await response.json()
  if (!body.envelope) return null
  const next = { ...record, envelope: body.envelope }
  if (body.keygen) next.fingerprint = body.keygen
  saveDevice(next)
  return next
}

// Ciphertext pull with the device token: this is what keeps working while the
// server-side vault is locked.
export async function count(record) {
  const response = await fetch(record.url + '/api/v2/items?since=0', { headers: { authorization: 'Bearer ' + record.token } })
  if (!response.ok) return { error: 'HTTP ' + response.status }
  const body = await response.json()
  // The key generation rides along with the pull: a rotation is noticed here and
  // the envelope is refreshed before anyone tries to decrypt a row.
  if (body.keygen && record.fingerprint && body.keygen !== record.fingerprint) {
    await refreshEnvelope(record).catch(() => null)
  }
  return { items: (body.items || []).length, revision: body.revision, keygen: body.keygen }
}
