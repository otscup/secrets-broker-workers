// The v2 vault, on its own D1: ciphertext rows plus the keyrings that can open
// them. Nothing in here knows what a Bitwarden cipher row looks like.
//
// The data key lives only in the caller's memory for the length of a session.
// This module never logs it, never writes it to D1, and never returns it.
import { sealItem, openItem, wrapDekPassword, unwrapDekPassword, wrapDekDevice, newDek, dekFingerprint } from './envelope.js'

const PASSWORD_KEYRING = 'password'

// Accounts are the broker's vault email. An empty account means the vault was
// unlocked without one, and that path keeps the original single-key behaviour
// so a deployment that never sets VAULT_EMAIL does not change at all.
function accountOf(value) {
  return String(value ?? '').trim().toLowerCase().slice(0, 254)
}

function accountKeyring(account) {
  return account ? 'account:' + account : PASSWORD_KEYRING
}

// Callers can hand in either a bare Uint8Array (the historical signature) or a
// context object { dek, legacyDek, account }. Keeping both accepted is what lets
// the console helpers stay unchanged while the HTTP routes pass the full set.
function keyContext(key, options = {}) {
  if (key && typeof key === 'object' && !(key instanceof Uint8Array) && key.dek instanceof Uint8Array) {
    return { dek: key.dek, legacyDek: key.legacyDek instanceof Uint8Array ? key.legacyDek : null, account: accountOf(key.account ?? options.account) }
  }
  return { dek: key, legacyDek: options.legacyDek instanceof Uint8Array ? options.legacyDek : null, account: accountOf(options.account) }
}

// A row sealed before accounts existed carries no owner. Its key is the legacy
// ring; a row with an owner can only be opened by that owner's key.
function dekForRow(row, ctx) {
  const owner = accountOf(row?.account_id)
  if (owner && owner !== ctx.account) return null
  return owner ? ctx.dek : (ctx.legacyDek ?? ctx.dek)
}

async function nextRevision(env) {
  const row = await env.VAULT_DB.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision' RETURNING value").first()
  return Number(row?.value ?? 0)
}

export async function vault2HasPasswordKeyring(env) {
  // Any password ring means initialised: an account ring is just a scoped one,
  // and treating only the legacy id as "initialised" would let init run twice.
  const row = await env.VAULT_DB.prepare("SELECT id FROM keyrings WHERE kind = 'password' AND revoked_at IS NULL LIMIT 1").first()
  return Boolean(row)
}

export async function vault2Init(env, password, options = {}) {
  if (await vault2HasPasswordKeyring(env)) throw new Error('vault already initialised')
  const account = accountOf(options.account)
  const dek = await newDek()
  const fingerprint = await dekFingerprint(dek)
  const envelope = await wrapDekPassword(dek, password)
  const at = new Date().toISOString()
  await env.VAULT_DB.batch([
    env.VAULT_DB.prepare('INSERT INTO keyrings (id, kind, envelope, account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(accountKeyring(account), PASSWORD_KEYRING, envelope, account || null, at, at),
    // The key generation is public: a device compares it with the one it cached to
    // notice a rekey without asking anyone to decrypt anything.
    // Pin the source on the way in: an empty v2 is still the live store, not a
    // reason to fall back to the old cipher table.
    env.VAULT_DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('source', 'v2')"),
    env.VAULT_DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('keygen', ?)").bind(fingerprint),
  ])
  return { dek, fingerprint }
}

export async function vault2Unlock(env, password, options = {}) {
  const account = accountOf(options.account)
  const scoped = account ? await env.VAULT_DB.prepare('SELECT envelope FROM keyrings WHERE id = ? AND revoked_at IS NULL').bind(accountKeyring(account)).first() : null
  // Until an account has its own ring, the legacy key is the vault. Returning it
  // as the primary is the documented fallback, not an error.
  const legacy = await env.VAULT_DB.prepare('SELECT envelope FROM keyrings WHERE id = ? AND revoked_at IS NULL').bind(PASSWORD_KEYRING).first()
  const primaryRing = scoped ?? legacy
  if (!primaryRing) throw new Error('vault is not initialised')
  const dek = await unwrapDekPassword(primaryRing.envelope, password)
  // Rows written before accounts existed sit under the legacy key. Unlock both
  // when they differ, so the first listing can still read them.
  let legacyDek = null
  // A legacy ring under a different password must not block an account unlock:
  // the rows it guards simply stay unreadable until that ring is migrated.
  if (scoped && legacy) legacyDek = await unwrapDekPassword(legacy.envelope, password).catch(() => null)
  return { dek, legacyDek, account, legacyOnly: Boolean(!scoped), fingerprint: await dekFingerprint(dek) }
}

export async function vault2Status(env, options = {}) {
  const account = accountOf(options.account)
  const meta = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'revision'").first()
  const counts = account
    ? await env.VAULT_DB.prepare('SELECT COUNT(*) AS live FROM vault_items WHERE deleted_at IS NULL AND (account_id IS NULL OR account_id = ?)').bind(account).first()
    : await env.VAULT_DB.prepare('SELECT COUNT(*) AS live FROM vault_items WHERE deleted_at IS NULL').first()
  const keyrings = await env.VAULT_DB.prepare('SELECT id, kind, account_id, created_at FROM keyrings WHERE revoked_at IS NULL ORDER BY created_at').all()
  return {
    initialized: await vault2HasPasswordKeyring(env),
    account: account || null,
    revision: Number(meta?.value ?? 0),
    items: Number(counts?.live ?? 0),
    keyrings: keyrings.results ?? [],
  }
}

// Ciphertext only: a peer syncs rows, it does not ask this endpoint to decrypt.
// With an account, legacy rows travel too: they are still owned by the deployment
// until migration claims them, and the peer decides what it can open.
export async function vault2List(env, since = 0, options = {}) {
  const account = accountOf(options.account)
  const rows = account
    ? await env.VAULT_DB.prepare('SELECT id, kind, ciphertext, revision, created_at, updated_at, deleted_at, account_id FROM vault_items WHERE revision > ? AND (account_id IS NULL OR account_id = ?) ORDER BY revision ASC')
      .bind(Number(since) || 0, account).all()
    : await env.VAULT_DB.prepare('SELECT id, kind, ciphertext, revision, created_at, updated_at, deleted_at, account_id FROM vault_items WHERE revision > ? ORDER BY revision ASC')
      .bind(Number(since) || 0).all()
  const results = (rows.results ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    accountId: row.account_id ?? null,
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

// The panel needs names, not ciphertext. Only the holder of the data key can
// open a row, so this refuses without one rather than returning blank fields.
// A legacy row is opened with the legacy key when the caller still holds one;
// when it does not, the row stays present but its payload is null.
export async function vault2ListPlain(env, key, since = 0) {
  const ctx = keyContext(key)
  const listed = await vault2List(env, since, { account: ctx.account })
  const items = []
  for (const row of listed.items) {
    if (row.deletedAt) {
      items.push({ id: row.id, kind: row.kind, accountId: row.accountId, revision: row.revision, deletedAt: row.deletedAt })
      continue
    }
    const rowDek = dekForRow({ account_id: row.accountId }, ctx)
    const payload = rowDek ? await openItem(rowDek, row.id, row.ciphertext).catch(() => null) : null
    items.push({ id: row.id, kind: row.kind, accountId: row.accountId, revision: row.revision, updatedAt: row.updatedAt, payload })
  }
  return { items, revision: listed.revision, keygen: listed.keygen }
}

export async function vault2Create(env, key, item) {
  const ctx = keyContext(key)
  const id = item.id || crypto.randomUUID()
  const kind = item.kind === 'web' ? 'web' : 'api'
  const ciphertext = await sealItem(ctx.dek, id, item.payload ?? {})
  const revision = await nextRevision(env)
  const at = new Date().toISOString()
  await env.VAULT_DB.batch([
    env.VAULT_DB.prepare('INSERT INTO vault_items (id, kind, ciphertext, account_id, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, kind, ciphertext, ctx.account || null, revision, at, at),
    // Pin the source: an emptied v2 must not hand the item page back to the old
    // cipher table, or the next write lands somewhere nobody reads.
    env.VAULT_DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('source', 'v2')"),
  ])
  return { id, kind, revision, updatedAt: at }
}

export async function vault2Update(env, key, id, item) {
  const ctx = keyContext(key)
  const existing = await env.VAULT_DB.prepare('SELECT id, kind, ciphertext, account_id FROM vault_items WHERE id = ?').bind(id).first()
  if (!existing) return null
  // A row sealed for another account is not this account's to edit, even though
  // its id is guessable.
  const owner = accountOf(existing.account_id)
  if (owner && owner !== ctx.account) return null
  const kind = item.kind === 'web' ? 'web' : (item.kind === 'api' ? 'api' : existing.kind)
  // A null payload means "keep the fields the caller cannot see": re-seal what is
  // there rather than blanking a credential nobody asked to change.
  const payload = item.payload ?? (await openItem(dekForRow(existing, ctx) ?? ctx.dek, id, existing.ciphertext))
  // New writes use the account key. A legacy row updated here is claimed by the
  // current account in the same statement, so the legacy key becomes read-only.
  const ciphertext = await sealItem(ctx.dek, id, payload)
  const revision = await nextRevision(env)
  const at = new Date().toISOString()
  const accountId = owner || ctx.account || null
  await env.VAULT_DB.prepare('UPDATE vault_items SET kind = ?, ciphertext = ?, account_id = ?, revision = ?, updated_at = ? WHERE id = ?')
    .bind(kind, ciphertext, accountId, revision, at, id)
    .run()
  return { id, kind, revision, updatedAt: at }
}

// Rotation keeps the previous ciphertext so an operator can roll a bad secret
// back for a few days without ever storing a plaintext copy. The snapshot is
// the sealed row: same DEK, same algorithm, no new key material.
export async function vault2SnapshotItem(env, id) {
  return env.VAULT_DB.prepare('SELECT id, kind, ciphertext, revision FROM vault_items WHERE id = ? AND deleted_at IS NULL').bind(id).first()
}

export async function vault2RestoreItem(env, id, snapshot) {
  const revision = await nextRevision(env)
  const at = new Date().toISOString()
  await env.VAULT_DB.prepare('UPDATE vault_items SET kind = ?, ciphertext = ?, revision = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(snapshot.kind, snapshot.ciphertext, revision, at, id)
    .run()
  return { id, revision, updatedAt: at }
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

export async function vault2Read(env, key, id) {
  const ctx = keyContext(key)
  const row = await env.VAULT_DB.prepare('SELECT id, kind, ciphertext, revision, updated_at, deleted_at, account_id FROM vault_items WHERE id = ?').bind(id).first()
  if (!row || row.deleted_at) return null
  const rowDek = dekForRow(row, ctx)
  if (!rowDek) return null
  return {
    id: row.id,
    kind: row.kind,
    accountId: row.account_id ?? null,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    payload: await openItem(rowDek, row.id, row.ciphertext),
  }
}

// A device asking for its own keyring: after a rekey this is how it picks up the
// new envelope without anyone handing it a fresh token.
export async function vault2DeviceSelf(env, deviceId) {
  const row = await env.VAULT_DB.prepare('SELECT envelope, account_id FROM keyrings WHERE device_id = ? AND revoked_at IS NULL').bind(deviceId).first()
  if (!row) return null
  const keygen = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'keygen'").first()
  return { envelope: row.envelope, account: row.account_id ?? null, keygen: keygen?.value ?? null }
}

// A paired device holds the same data key, wrapped to its own public key. The
// token is returned once and stored only as a hash, so the row alone cannot be
// used to pull ciphertext.
// A missing canWrite means read-only, the same as the column default in
// migration 0002 and the same as every reader of the row. Callers that do grant
// writes (the CLI's cookie pairing, a human approving a device code) pass true
// explicitly, so no path can acquire write by forgetting a field.
export async function vault2Pair(env, key, { name, publicKey, publicJwk, canWrite = false }) {
  const ctx = keyContext(key)
  const label = String(name ?? '').trim().slice(0, 60)
  if (!label) throw new Error('a device needs a name')
  const offered = publicKey ?? publicJwk
  const jwk = typeof offered === 'string' ? JSON.parse(offered) : offered
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('public key must be a P-256 JWK')
  const id = crypto.randomUUID()
  const at = new Date().toISOString()
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const envelope = await wrapDekDevice(ctx.dek, jwk)
  // The console's long-term tier pairs the browser as a read-only device: it may
  // pull ciphertext, never push. CLI pairing keeps the historical write default.
  await env.VAULT_DB.prepare('INSERT INTO devices (id, name, public_jwk, token_hash, created_at, can_write, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, label, JSON.stringify(jwk), await sha256Base64(token), at, canWrite ? 1 : 0, ctx.account || null)
    .run()
  await env.VAULT_DB.prepare('INSERT INTO keyrings (id, kind, envelope, device_id, account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('device:' + id, 'device', envelope, id, ctx.account || null, at, at)
    .run()
  return { id, name: label, token, envelope, account: ctx.account || null, createdAt: at, canWrite: Boolean(canWrite), fingerprint: await dekFingerprint(ctx.dek) }
}

// Devices are listed per account. A device paired before accounts existed has no
// owner: it stays visible and manageable for every account (legacy rule) so an
// operator can still revoke it, and its `account` field is null so the console
// can tell it apart. A device owned by another account never appears here, and
// the write routes below refuse it.
export async function vault2Devices(env, options = {}) {
  const account = accountOf(options.account)
  const rows = account
    ? await env.VAULT_DB.prepare('SELECT id, name, account_id, created_at, last_seen_at, revoked_at, can_write FROM devices WHERE account_id = ? OR account_id IS NULL ORDER BY created_at DESC').bind(account).all()
    : await env.VAULT_DB.prepare('SELECT id, name, account_id, created_at, last_seen_at, revoked_at, can_write FROM devices ORDER BY created_at DESC').all()
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    account: row.account_id ?? null,
    legacy: !row.account_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? null,
    revokedAt: row.revoked_at ?? null,
    canWrite: Number(row.can_write) === 1,
  }))
}

// Revoking stops future pulls. It cannot un-learn a key the device already has:
// only a rekey (re-encrypt every row under a new DEK) does that.
export async function vault2RevokeDevice(env, id, options = {}) {
  const row = await env.VAULT_DB.prepare('SELECT id, account_id FROM devices WHERE id = ?').bind(id).first()
  if (!row) return null
  if (deviceIsForeign(row, options)) return null
  const at = new Date().toISOString()
  await env.VAULT_DB.prepare('UPDATE devices SET revoked_at = ?, token_hash = NULL WHERE id = ?').bind(at, id).run()
  await env.VAULT_DB.prepare('UPDATE keyrings SET revoked_at = ? WHERE device_id = ?').bind(at, id).run()
  return { id, revokedAt: at }
}

// A device that belongs to another account is answered exactly like a missing id:
// the caller must not be able to probe which device ids exist elsewhere. A row
// with no owner is the legacy case and remains operable.
function deviceIsForeign(row, options) {
  const account = accountOf(options.account)
  const owner = accountOf(row?.account_id)
  return Boolean(account && owner && owner !== account)
}

// Write permission is a per-device switch, not a re-pair: flipping it off leaves
// the key envelope alone, so turning it back on needs no browser approval.
export async function vault2SetDeviceWrite(env, id, canWrite, options = {}) {
  const row = await env.VAULT_DB.prepare('SELECT id, revoked_at, account_id FROM devices WHERE id = ?').bind(id).first()
  if (!row) return null
  if (deviceIsForeign(row, options)) return null
  if (row.revoked_at) return { id, error: 'device is revoked' }
  await env.VAULT_DB.prepare('UPDATE devices SET can_write = ? WHERE id = ?').bind(canWrite ? 1 : 0, id).run()
  return { id, canWrite: Boolean(canWrite) }
}

// Only a revoked device can be purged: deleting a live one would silently strip
// its key envelope while its token still works. Purge is irreversible.
export async function vault2PurgeDevice(env, id, options = {}) {
  const row = await env.VAULT_DB.prepare('SELECT id, revoked_at, account_id FROM devices WHERE id = ?').bind(id).first()
  if (!row) return null
  if (deviceIsForeign(row, options)) return null
  if (!row.revoked_at) return { id, error: 'revoke the device first' }
  await env.VAULT_DB.prepare('DELETE FROM keyrings WHERE device_id = ?').bind(id).run()
  await env.VAULT_DB.prepare('DELETE FROM devices WHERE id = ?').bind(id).run()
  return { id, purged: true }
}

export async function vault2DeviceByToken(env, token) {
  const value = String(token ?? '')
  if (value.length < 20) return null
  const hash = await sha256Base64(value)
  const row = await env.VAULT_DB.prepare('SELECT id, name, token_hash, can_write, account_id FROM devices WHERE token_hash IS NOT NULL AND revoked_at IS NULL').all()
  const hit = (row.results ?? []).find((candidate) => constantTimeEqual(candidate.token_hash, hash))
  if (!hit) return null
  await env.VAULT_DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), hit.id).run()
  return { id: hit.id, name: hit.name, canWrite: Number(hit.can_write ?? 0) === 1, account: hit.account_id ?? '' }
}

// Rows arrive already sealed by the caller: this side never sees plaintext, and
// a row that does not decrypt on the other end is that device's mistake, not
// something this database could detect. The device's account is stamped on the
// rows it writes, so a device paired to one account cannot relabel them.
export async function vault2Push(env, rows, options = {}) {
  const list = Array.isArray(rows) ? rows.slice(0, 500) : []
  if (!list.length) return { written: 0, revision: await currentRevision(env) }
  const account = accountOf(options.account)
  let written = 0
  for (const row of list) {
    const id = String(row?.id ?? '')
    const ciphertext = String(row?.ciphertext ?? '')
    const deletedAt = row?.deletedAt ? String(row.deletedAt) : null
    // A tombstone is a row with no body: it must still be written, or a delete
    // made on the device would never reach the other machines.
    if (!id || (!ciphertext && !deletedAt)) continue
    const kind = row.kind === 'web' ? 'web' : 'api'
    const revision = await nextRevision(env)
    const at = new Date().toISOString()
    await env.VAULT_DB.prepare(
      'INSERT INTO vault_items (id, kind, ciphertext, account_id, revision, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, ciphertext = excluded.ciphertext, account_id = COALESCE(excluded.account_id, vault_items.account_id), revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at',
    ).bind(id, kind, ciphertext, account || null, revision, at, at, deletedAt).run()
    written += 1
  }
  if (written) await env.VAULT_DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('source', 'v2')").run()
  return { written, revision: await currentRevision(env) }
}

async function currentRevision(env) {
  const row = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'revision'").first()
  return Number(row?.value ?? 0)
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
//
// With an account, the rotation is scoped to that account: rows owned by another
// account are not touched, its keyring keeps its own key, and only devices that
// belong to this account (or predate accounts) are re-wrapped.
export async function vault2Rekey(env, key, password) {
  const ctx = keyContext(key)
  const account = ctx.account
  const ringId = accountKeyring(account)
  const stagingId = account ? 'rekey-staging:' + account : 'rekey-staging'
  const markerKey = account ? 'rekey:' + account : 'rekey'
  const ring = await env.VAULT_DB.prepare('SELECT envelope FROM keyrings WHERE id = ? AND revoked_at IS NULL').bind(ringId).first()
  if (!ring) throw new Error(account ? 'this account has no password keyring' : 'vault has no password keyring')
  // Prove the password opens the current ring: rekeying under a password we cannot
  // verify would mint a key its owner could not unlock.
  let proven = null
  try {
    proven = await unwrapDekPassword(ring.envelope, password)
  } catch {
    throw new Error('wrong password: this does not open the vault')
  }
  if (await dekFingerprint(proven) !== await dekFingerprint(ctx.dek)) throw new Error('this password does not open the key that is currently in use')

  const now = () => new Date().toISOString()
  const marker = await env.VAULT_DB.prepare('SELECT value FROM meta WHERE key = ?').bind(markerKey).first()
  let plan = marker?.value ? JSON.parse(marker.value) : null
  let dekNew
  if (!plan) {
    dekNew = await newDek()
    const meta = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'revision'").first()
    plan = { account: account || null, from: await dekFingerprint(ctx.dek), to: await dekFingerprint(dekNew), startRevision: Number(meta?.value ?? 0), startedAt: now() }
    // Two statements only matter together: park the new key, then declare the job.
    await env.VAULT_DB.batch([
      env.VAULT_DB.prepare('INSERT OR REPLACE INTO keyrings (id, kind, envelope, account_id, created_at, updated_at) VALUES (?, \'password\', ?, ?, ?, ?)')
        .bind(stagingId, await wrapDekPassword(dekNew, password), account || null, now(), now()),
      env.VAULT_DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(markerKey, JSON.stringify(plan)),
    ])
  } else {
    const staging = await env.VAULT_DB.prepare('SELECT envelope FROM keyrings WHERE id = ?').bind(stagingId).first()
    if (!staging) throw new Error('the rekey was interrupted and its staging key is gone; the old key still opens the vault')
    dekNew = await unwrapDekPassword(staging.envelope, password)
    if (await dekFingerprint(dekNew) !== plan.to) throw new Error('the staging key does not match the interrupted rekey')
  }

  let converted = 0
  let wiped = 0
  let lastId = ''
  for (let round = 0; round < 500; round += 1) {
    const rows = account
      ? await env.VAULT_DB.prepare('SELECT id, ciphertext, deleted_at, account_id FROM vault_items WHERE id > ? AND (account_id IS NULL OR account_id = ?) ORDER BY id ASC LIMIT 40').bind(lastId, account).all()
      : await env.VAULT_DB.prepare('SELECT id, ciphertext, deleted_at, account_id FROM vault_items WHERE id > ? ORDER BY id ASC LIMIT 40').bind(lastId).all()
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
      const rowDek = dekForRow(row, ctx)
      if (!rowDek) continue
      // A tombstone must not keep a copy of the secret the old key can still read.
      const payload = deleted ? {} : await openItem(rowDek, row.id, row.ciphertext)
      if (deleted) wiped += 1
      else converted += 1
      statements.push(env.VAULT_DB.prepare('UPDATE vault_items SET ciphertext = ?, account_id = ?, revision = ?, updated_at = ? WHERE id = ?')
        .bind(await sealItem(dekNew, row.id, payload), account ? accountOf(row.account_id) || account : null, revision, now(), row.id))
    }
    if (statements.length) await env.VAULT_DB.batch(statements)
  }

  const devices = account
    ? await env.VAULT_DB.prepare('SELECT id, public_jwk FROM devices WHERE revoked_at IS NULL AND public_jwk IS NOT NULL AND (account_id IS NULL OR account_id = ?)').bind(account).all()
    : await env.VAULT_DB.prepare('SELECT id, public_jwk FROM devices WHERE revoked_at IS NULL AND public_jwk IS NOT NULL').all()
  const closing = []
  let rewrapped = 0
  for (const device of devices.results ?? []) {
    let jwk = null
    try { jwk = JSON.parse(device.public_jwk) } catch { jwk = null }
    if (!jwk) continue
    closing.push(env.VAULT_DB.prepare('UPDATE keyrings SET envelope = ?, account_id = ?, updated_at = ? WHERE device_id = ? AND revoked_at IS NULL')
      .bind(await wrapDekDevice(dekNew, jwk), account || null, now(), device.id))
    rewrapped += 1
  }
  closing.push(env.VAULT_DB.prepare('UPDATE keyrings SET envelope = ?, updated_at = ? WHERE id = ?').bind(await wrapDekPassword(dekNew, password), now(), ringId))
  closing.push(env.VAULT_DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('keygen', ?)").bind(plan.to))
  closing.push(env.VAULT_DB.prepare('DELETE FROM keyrings WHERE id = ?').bind(stagingId))
  closing.push(env.VAULT_DB.prepare('DELETE FROM meta WHERE key = ?').bind(markerKey))
  await env.VAULT_DB.batch(closing)
  return { dek: dekNew, legacyDek: ctx.legacyDek, fingerprint: plan.to, converted, wiped, devices: rewrapped, startedAt: plan.startedAt }
}

export async function vault2RekeyPending(env, options = {}) {
  const account = accountOf(options.account)
  const row = await env.VAULT_DB.prepare('SELECT value FROM meta WHERE key = ?').bind(account ? 'rekey:' + account : 'rekey').first()
  if (!row?.value && account) {
    // An account that has not started its own rotation is still blocked by a
    // rotation started before accounts existed.
    const legacy = await env.VAULT_DB.prepare("SELECT value FROM meta WHERE key = 'rekey'").first()
    return legacy?.value ? JSON.parse(legacy.value) : null
  }
  return row?.value ? JSON.parse(row.value) : null
}

// Rows with no owner (`account_id IS NULL`) are claimed by the FIRST account that
// runs this migration: every one of them that the legacy key opens is re-sealed
// under that account's key and stamped with its id. There is no way to know
// afterwards which account a pre-account row "belonged" to, so the response says
// so explicitly (`legacyClaim: 'first-account'`, `claimed`) and the operators'
// runbook repeats it. A single-account deployment is the normal case; a
// deployment that switches account before migrating must not expect the second
// account to inherit those rows.
//
// One-shot, resumable conversion of the rows that predate accounts.
//
// The legacy key stays in place, so nothing is deleted and an interrupt costs
// nothing: rows already sealed with the account key are recognised by decrypting
// them with it and are only tagged, and rows still on the legacy key are re-sealed
// and tagged in a single UPDATE. Re-running therefore converges instead of
// double-encrypting. The account's keyring is minted here when it does not exist
// yet, which is why the password is required.
export async function vault2MigrateAccount(env, key, password) {
  const ctx = keyContext(key)
  const account = ctx.account
  if (!account) throw new Error('an account is required to migrate')
  const legacy = await env.VAULT_DB.prepare('SELECT envelope FROM keyrings WHERE id = ? AND revoked_at IS NULL').bind(PASSWORD_KEYRING).first()
  let legacyDek = ctx.legacyDek
  if (legacy) {
    try {
      legacyDek = await unwrapDekPassword(legacy.envelope, password)
    } catch {
      throw new Error('wrong password: this does not open the legacy keys')
    }
  }
  let ring = await env.VAULT_DB.prepare('SELECT envelope FROM keyrings WHERE id = ? AND revoked_at IS NULL').bind(accountKeyring(account)).first()
  let dek = ctx.dek
  let minted = false
  if (ring) {
    try {
      dek = await unwrapDekPassword(ring.envelope, password)
    } catch {
      throw new Error('wrong password: this does not open the account keys')
    }
  } else {
    dek = await newDek()
    const at = new Date().toISOString()
    await env.VAULT_DB.prepare('INSERT INTO keyrings (id, kind, envelope, account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(accountKeyring(account), PASSWORD_KEYRING, await wrapDekPassword(dek, password), account, at, at)
      .run()
    ring = { envelope: null }
    minted = true
  }
  // A run in progress blocks item routes just like a rekey, so readers never see
  // a half-converted vault. The marker is scoped to this account.
  const markerKey = 'migrate:' + account
  await env.VAULT_DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    .bind(markerKey, JSON.stringify({ account, startedAt: new Date().toISOString() }))
    .run()
  let converted = 0
  let tagged = 0
  let skipped = 0
  let lastId = ''
  try {
    for (let round = 0; round < 500; round += 1) {
      const rows = await env.VAULT_DB.prepare('SELECT id, ciphertext, account_id FROM vault_items WHERE id > ? AND (account_id IS NULL OR account_id = ?) ORDER BY id ASC LIMIT 40')
        .bind(lastId, account)
        .all()
      const batch = rows.results ?? []
      if (!batch.length) break
      lastId = batch[batch.length - 1].id
      const statements = []
      for (const row of batch) {
        if (accountOf(row.account_id) === account) { skipped += 1; continue }
        // Already under this account's key (an interrupted run updated the row but
        // not its tag), so only the tag is missing.
        if (await openItem(dek, row.id, row.ciphertext).then(() => true, () => false)) {
          statements.push(env.VAULT_DB.prepare('UPDATE vault_items SET account_id = ?, revision = ?, updated_at = ? WHERE id = ?')
            .bind(account, await nextRevision(env), new Date().toISOString(), row.id))
          tagged += 1
          continue
        }
        // A row that neither key opens belongs to another account and is left for
        // that account's own migration.
        const payload = legacyDek ? await openItem(legacyDek, row.id, row.ciphertext).catch(() => null) : null
        if (!payload) { skipped += 1; continue }
        statements.push(env.VAULT_DB.prepare('UPDATE vault_items SET ciphertext = ?, account_id = ?, revision = ?, updated_at = ? WHERE id = ?')
          .bind(await sealItem(dek, row.id, payload), account, await nextRevision(env), new Date().toISOString(), row.id))
        converted += 1
      }
      if (statements.length) await env.VAULT_DB.batch(statements)
    }
  } finally {
    // Even a failed chunk clears the marker, or the vault would stay read-only.
    await env.VAULT_DB.prepare('DELETE FROM meta WHERE key = ?').bind(markerKey).run()
  }
  const remaining = await env.VAULT_DB.prepare('SELECT COUNT(*) AS left FROM vault_items WHERE account_id IS NULL').first()
  return { dek, legacyDek, account, fingerprint: await dekFingerprint(dek), minted, converted, tagged, skipped, remaining: Number(remaining?.left ?? 0), legacyClaim: 'first-account', claimed: converted + tagged }
}

export async function vault2MigratePending(env, options = {}) {
  const account = accountOf(options.account)
  if (!account) return null
  const row = await env.VAULT_DB.prepare('SELECT value FROM meta WHERE key = ?').bind('migrate:' + account).first()
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

