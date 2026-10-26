// The v2 vault, on its own D1: ciphertext rows plus the keyrings that can open
// them. Nothing in here knows what a Bitwarden cipher row looks like.
//
// The data key lives only in the caller's memory for the length of a session.
// This module never logs it, never writes it to D1, and never returns it.
import { sealItem, openItem, wrapDekPassword, unwrapDekPassword, newDek, dekFingerprint } from './envelope.js'

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
  const envelope = await wrapDekPassword(dek, password)
  const at = new Date().toISOString()
  await env.VAULT_DB.prepare('INSERT INTO keyrings (id, kind, envelope, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(PASSWORD_KEYRING, PASSWORD_KEYRING, envelope, at, at)
    .run()
  return { dek, fingerprint: await dekFingerprint(dek) }
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
  return { items: results, revision: Number(meta?.value ?? 0) }
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
