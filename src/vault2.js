// The v2 vault, on its own D1: ciphertext rows plus the keyrings that can open
// them. Nothing in here knows what a Bitwarden cipher row looks like.
//
// The data key lives only in the caller's memory for the length of a session.
// This module never logs it, never writes it to D1, and never returns it.
import { sealItem, openItem, wrapDekPassword, unwrapDekPassword, wrapDekDevice, newDek, dekFingerprint } from './envelope.js'

const PASSWORD_KEYRING = 'password'

async function nextRevision(env) {
  const row = await env.VAULT_DB.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision' RETURNING value").first()
  return Number(row?.value ?? 0)
}

export async function vault2HasPasswordKeyring(env) {
  const row = await env.VAULT_DB.prepare('SELECT id FROM keyrings WHERE kind = ? AND revoked_at IS NULL').bind(PASSWORD_KEYRING).first()
  return Boolean(row)
}

export async function vault2Init(env, password) {
  if (await vault2HasPasswordKeyring(env)) throw new Error('vault already initialised')
  const dek = await newDek()
  const fingerprint = await dekFingerprint(dek)
  const envelope = await wrapDekPassword(dek, password)
  const at = new Date().toISOString()
  await env.VAULT_DB.batch([
    env.VAULT_DB.prepare('INSERT INTO keyrings (id, kind, envelope, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(PASSWORD_KEYRING, PASSWORD_KEYRING, envelope, at, at),
    // The key generation is public: a device compares it with the one it cached to
    // notice a rekey without asking anyone to decrypt anything.
    env.VAULT_DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('keygen', ?)").bind(fingerprint),
  ])
  return { dek, fingerprint }
}

export async function vault2Unlock(env, password) {
  const row = await env.VAULT_DB.prepare('SELECT envelope FROM keyrings WHERE id = ? AND revoked_at IS NULL').bind(PASSWORD_KEYRING).first()
  if (!row) throw new Error('vault is not initialised')
  const dek = await unwrapDekPassword(row.envelope, password)
  return { dek, fingerprint: await dekFingerprint(dek) }
}

export async function vault2Status(env) {
  const meta = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'revision'").first()
  const counts = await env.VAULT_DB.prepare('SELECT COUNT(*) AS live FROM vault_items WHERE deleted_at IS NULL').first()
  const keyrings = await env.VAULT_DB.prepare('SELECT id, kind, created_at FROM keyrings WHERE revoked_at IS NULL ORDER BY created_at').all()
  return {
    initialized: await vault2HasPasswordKeyring(env),
    revision: Number(meta?.value ?? 0),
    items: Number(counts?.live ?? 0),
    keyrings: keyrings.results ?? [],
  }
}

// Ciphertext only: a peer syncs rows, it does not ask this endpoint to decrypt.
export async function vault2List(env, since = 0) {
  const rows = await env.VAULT_DB.prepare('SELECT id, kind, ciphertext, revision, created_at, updated_at, deleted_at FROM vault_items WHERE revision > ? ORDER BY revision ASC')
    .bind(Number(since) || 0)
    .all()
  const results = (rows.results ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    ciphertext: row.ciphertext,
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
  }))
  const meta = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'revision'").first()
  const keygen = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'keygen'").first()
  return { items: results, revision: Number(meta?.value ?? 0), keygen: keygen?.value ?? null }
}

export async function vault2Create(env, dek, item) {
  const id = item.id || crypto.randomUUID()
  const kind = item.kind === 'web' ? 'web' : 'api'
  const ciphertext = await sealItem(dek, id, item.payload ?? {})
  const revision = await nextRevision(env)
  const at = new Date().toISOString()
  await env.VAULT_DB.prepare('INSERT INTO vault_items (id, kind, ciphertext, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, kind, ciphertext, revision, at, at)
    .run()
  return { id, kind, revision, updatedAt: at }
}

export async function vault2Update(env, dek, id, item) {
  const existing = await env.VAULT_DB.prepare('SELECT id, kind FROM vault_items WHERE id = ?').bind(id).first()
  if (!existing) return null
  const kind = item.kind === 'web' ? 'web' : (item.kind === 'api' ? 'api' : existing.kind)
  // A null payload means "keep the fields the caller cannot see": re-seal what is
  // there rather than blanking a credential nobody asked to change.
  const payload = item.payload ?? (await openItem(dek, id, (await env.VAULT_DB.prepare('SELECT ciphertext FROM vault_items WHERE id = ?').bind(id).first()).ciphertext))
  const ciphertext = await sealItem(dek, id, payload)
  const revision = await nextRevision(env)
  const at = new Date().toISOString()
  await env.VAULT_DB.prepare('UPDATE vault_items SET kind = ?, ciphertext = ?, revision = ?, updated_at = ? WHERE id = ?')
    .bind(kind, ciphertext, revision, at, id)
    .run()
  return { id, kind, revision, updatedAt: at }
}

export async function vault2Delete(env, id) {
  const existing = await env.VAULT_DB.prepare('SELECT id FROM vault_items WHERE id = ?').bind(id).first()
  if (!existing) return null
  const revision = await nextRevision(env)
  const at = new Date().toISOString()
  // Tombstone, not a DELETE: the peer needs to learn that the row went away.
  await env.VAULT_DB.prepare('UPDATE vault_items SET deleted_at = ?, revision = ?, updated_at = ? WHERE id = ?')
    .bind(at, revision, at, id)
    .run()
  return { id, revision, deletedAt: at }
}

export async function vault2Read(env, dek, id) {
  const row = await env.VAULT_DB.prepare('SELECT id, kind, ciphertext, revision, updated_at, deleted_at FROM vault_items WHERE id = ?').bind(id).first()
  if (!row || row.deleted_at) return null
  return {
    id: row.id,
    kind: row.kind,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    payload: await openItem(dek, row.id, row.ciphertext),
  }
}

// A device asking for its own keyring: after a rekey this is how it picks up the
// new envelope without anyone handing it a fresh token.
export async function vault2DeviceSelf(env, deviceId) {
  const row = await env.VAULT_DB.prepare('SELECT envelope FROM keyrings WHERE device_id = ? AND revoked_at IS NULL').bind(deviceId).first()
  if (!row) return null
  const keygen = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'keygen'").first()
  return { envelope: row.envelope, keygen: keygen?.value ?? null }
}

// A paired device holds the same data key, wrapped to its own public key. The
// token is returned once and stored only as a hash, so the row alone cannot be
// used to pull ciphertext.
export async function vault2Pair(env, dek, { name, publicKey, publicJwk }) {
  const label = String(name ?? '').trim().slice(0, 60)
  if (!label) throw new Error('a device needs a name')
  const offered = publicKey ?? publicJwk
  const jwk = typeof offered === 'string' ? JSON.parse(offered) : offered
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('public key must be a P-256 JWK')
  const id = crypto.randomUUID()
  const at = new Date().toISOString()
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const envelope = await wrapDekDevice(dek, jwk)
  await env.VAULT_DB.prepare('INSERT INTO devices (id, name, public_jwk, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, label, JSON.stringify(jwk), await sha256Base64(token), at)
    .run()
  await env.VAULT_DB.prepare('INSERT INTO keyrings (id, kind, envelope, device_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('device:' + id, 'device', envelope, id, at, at)
    .run()
  return { id, name: label, token, envelope, createdAt: at, fingerprint: await dekFingerprint(dek) }
}

export async function vault2Devices(env) {
  const rows = await env.VAULT_DB.prepare('SELECT id, name, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at DESC').all()
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? null,
    revokedAt: row.revoked_at ?? null,
  }))
}

// Revoking stops future pulls. It cannot un-learn a key the device already has:
// only a rekey (re-encrypt every row under a new DEK) does that.
export async function vault2RevokeDevice(env, id) {
  const row = await env.VAULT_DB.prepare('SELECT id FROM devices WHERE id = ?').bind(id).first()
  if (!row) return null
  const at = new Date().toISOString()
  await env.VAULT_DB.prepare('UPDATE devices SET revoked_at = ?, token_hash = NULL WHERE id = ?').bind(at, id).run()
  await env.VAULT_DB.prepare('UPDATE keyrings SET revoked_at = ? WHERE device_id = ?').bind(at, id).run()
  return { id, revokedAt: at }
}

export async function vault2DeviceByToken(env, token) {
  const value = String(token ?? '')
  if (value.length < 20) return null
  const hash = await sha256Base64(value)
  const row = await env.VAULT_DB.prepare('SELECT id, name, token_hash FROM devices WHERE token_hash IS NOT NULL AND revoked_at IS NULL').all()
  const hit = (row.results ?? []).find((candidate) => constantTimeEqual(candidate.token_hash, hash))
  if (!hit) return null
  await env.VAULT_DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), hit.id).run()
  return { id: hit.id, name: hit.name }
}


// Rotating the data key. A revoked device keeps whatever key it was given, so the
// only way to take it back is to re-encrypt everything under a new one — and to
// scrub the tombstones while we are at it, or the old key still opens every
// deleted secret.
//
// The swap is staged: the new key is parked in a staging keyring (wrapped with the
// same master password) while rows are converted chunk by chunk, and the password
// and device keyrings only move to the new key in the closing batch. A crash
// anywhere leaves the vault unlockable with the old key and the marker set, so a
// retry resumes instead of leaving half the rows unreadable.
export async function vault2Rekey(env, dekOld, password) {
  const ring = await env.VAULT_DB.prepare('SELECT envelope FROM keyrings WHERE id = ? AND revoked_at IS NULL').bind(PASSWORD_KEYRING).first()
  if (!ring) throw new Error('vault has no password keyring')
  // Prove the password opens the current ring: rekeying under a password we cannot
  // verify would mint a key its owner could not unlock.
  let proven = null
  try {
    proven = await unwrapDekPassword(ring.envelope, password)
  } catch {
    throw new Error('wrong password: this does not open the vault')
  }
  if (await dekFingerprint(proven) !== await dekFingerprint(dekOld)) throw new Error('this password does not open the key that is currently in use')

  const now = () => new Date().toISOString()
  const marker = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'rekey'").first()
  let plan = marker?.value ? JSON.parse(marker.value) : null
  let dekNew
  if (!plan) {
    dekNew = await newDek()
    const meta = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'revision'").first()
    plan = { from: await dekFingerprint(dekOld), to: await dekFingerprint(dekNew), startRevision: Number(meta?.value ?? 0), startedAt: now() }
    // Two statements only matter together: park the new key, then declare the job.
    await env.VAULT_DB.batch([
      env.VAULT_DB.prepare("INSERT OR REPLACE INTO keyrings (id, kind, envelope, created_at, updated_at) VALUES ('rekey-staging', 'password', ?, ?, ?)").bind(await wrapDekPassword(dekNew, password), now(), now()),
      env.VAULT_DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('rekey', ?)").bind(JSON.stringify(plan)),
    ])
  } else {
    const staging = await env.VAULT_DB.prepare("SELECT envelope FROM keyrings WHERE id = 'rekey-staging'").first()
    if (!staging) throw new Error('the rekey was interrupted and its staging key is gone; the old key still opens the vault')
    dekNew = await unwrapDekPassword(staging.envelope, password)
    if (await dekFingerprint(dekNew) !== plan.to) throw new Error('the staging key does not match the interrupted rekey')
  }

  let converted = 0
  let wiped = 0
  let lastId = ''
  for (let round = 0; round < 500; round += 1) {
    const rows = await env.VAULT_DB.prepare('SELECT id, ciphertext, deleted_at FROM vault_items WHERE id > ? ORDER BY id ASC LIMIT 40')
      .bind(lastId)
      .all()
    const batch = rows.results ?? []
    if (!batch.length) break
    lastId = batch[batch.length - 1].id
    const statements = []
    for (const row of batch) {
      // Deciding by key, not by revision: a row already under the new key opens
      // with it, so a concurrent write that slipped past the marker for a moment
      // is still caught instead of being left behind unreadable.
      if (await openItem(dekNew, row.id, row.ciphertext).then(() => true, () => false)) continue
      const revision = await nextRevision(env)
      const deleted = Boolean(row.deleted_at)
      // A tombstone must not keep a copy of the secret the old key can still read.
      const payload = deleted ? {} : await openItem(dekOld, row.id, row.ciphertext)
      if (deleted) wiped += 1
      else converted += 1
      statements.push(env.VAULT_DB.prepare('UPDATE vault_items SET ciphertext = ?, revision = ?, updated_at = ? WHERE id = ?')
        .bind(await sealItem(dekNew, row.id, payload), revision, now(), row.id))
    }
    if (statements.length) await env.VAULT_DB.batch(statements)
  }

  const devices = await env.VAULT_DB.prepare('SELECT id, public_jwk FROM devices WHERE revoked_at IS NULL AND public_jwk IS NOT NULL').all()
  const closing = []
  let rewrapped = 0
  for (const device of devices.results ?? []) {
    let jwk = null
    try { jwk = JSON.parse(device.public_jwk) } catch { jwk = null }
    if (!jwk) continue
    closing.push(env.VAULT_DB.prepare('UPDATE keyrings SET envelope = ?, updated_at = ? WHERE device_id = ? AND revoked_at IS NULL')
      .bind(await wrapDekDevice(dekNew, jwk), now(), device.id))
    rewrapped += 1
  }
  closing.push(env.VAULT_DB.prepare('UPDATE keyrings SET envelope = ?, updated_at = ? WHERE id = ?').bind(await wrapDekPassword(dekNew, password), now(), PASSWORD_KEYRING))
  closing.push(env.VAULT_DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('keygen', ?)").bind(plan.to))
  closing.push(env.VAULT_DB.prepare("DELETE FROM keyrings WHERE id = 'rekey-staging'"))
  closing.push(env.VAULT_DB.prepare("DELETE FROM meta WHERE key = 'rekey'"))
  await env.VAULT_DB.batch(closing)
  return { dek: dekNew, fingerprint: plan.to, converted, wiped, devices: rewrapped, startedAt: plan.startedAt }
}

export async function vault2RekeyPending(env) {
  const row = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'rekey'").first()
  return row?.value ? JSON.parse(row.value) : null
}
function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Base64(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

function constantTimeEqual(a, b) {
  const left = String(a ?? '')
  const right = String(b ?? '')
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return diff === 0
}

