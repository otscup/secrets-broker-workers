// A local copy of the vault, so the daemon can answer while the network is down.
// Only ciphertext is stored: the rows are exactly what the server handed over,
// and the key that opens them lives in the device record, not in this file.
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function cacheFile() {
  if (process.env.BROKER_CACHE_FILE) return process.env.BROKER_CACHE_FILE
  const home = process.env.BROKER_HOME || path.join(os.homedir(), '.secrets-broker')
  return path.join(home, 'vault.db')
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'api',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  deleted_at TEXT,
  ciphertext TEXT NOT NULL DEFAULT ''
);
`

export function openCache({ file = cacheFile() } = {}) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  let db
  try {
    db = new DatabaseSync(file)
    db.exec(SCHEMA)
    return db
  } catch (error) {
    try { db?.close() } catch {}
    // A power loss can leave a zero-filled page. It is only a ciphertext copy,
    // so keep it aside and start clean; the next pull rebuilds it.
    if (error?.code !== 'ERR_SQLITE_ERROR' || !/not a database/i.test(error?.message ?? '')) throw error
    if (file !== ':memory:' && existsSync(file)) renameSync(file, file + '.corrupt-' + Date.now())
    db = new DatabaseSync(file)
    db.exec(SCHEMA)
    return db
  }
}

// Replace the cached rows with what the server just sent. Anything it no longer
// returns is gone from here too, or the cache would resurrect deleted items.
export function savePull({ url = '', revision = 0, rows = [], since = 0 } = {}, { file = cacheFile() } = {}) {
  const db = openCache({ file })
  try {
    db.exec('BEGIN')
    // A pull with a cursor is a delta; deleting the full copy here would make
    // the offline cache contain only the newest rows.
    if (!Number(since)) db.exec('DELETE FROM items')
    const insert = db.prepare('INSERT INTO items (id, kind, revision, updated_at, deleted_at, ciphertext) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, ciphertext = excluded.ciphertext')
    for (const row of rows) {
      insert.run(String(row.id), row.kind === 'web' ? 'web' : 'api', Number(row.revision ?? 0), row.updatedAt ?? null, row.deletedAt ?? null, String(row.ciphertext ?? ''))
    }
    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    meta.run('url', String(url))
    meta.run('revision', String(Number(revision ?? 0)))
    meta.run('saved_at', new Date().toISOString())
    db.exec('COMMIT')
    return { rows: rows.length, revision: Number(revision ?? 0) }
  } finally { db.close() }
}

export function loadPull({ since = 0 } = {}, { file = cacheFile() } = {}) {
  let db
  try { db = openCache({ file }) } catch { return { rows: [], revision: 0, savedAt: null, url: '' } }
  try {
    const rows = db.prepare('SELECT id, kind, revision, updated_at, deleted_at, ciphertext FROM items WHERE revision > ? ORDER BY revision').all(Number(since ?? 0))
    const read = (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null
    return {
      rows: rows.map((row) => ({ id: row.id, kind: row.kind, revision: Number(row.revision), updatedAt: row.updated_at ?? undefined, deletedAt: row.deleted_at ?? undefined, ciphertext: row.ciphertext })),
      revision: Number(read('revision') ?? 0),
      savedAt: read('saved_at'),
      url: read('url') ?? '',
    }
  } catch { return { rows: [], revision: 0, savedAt: null, url: '' } } finally { db.close() }
}

export function cacheStatus({ file = cacheFile() } = {}) {
  const loaded = loadPull({ since: 0 }, { file })
  return { file, rows: loaded.rows.length, revision: loaded.revision, savedAt: loaded.savedAt, url: loaded.url }
}

export function clearCache({ file = cacheFile() } = {}) {
  const db = openCache({ file })
  try {
    db.exec('DELETE FROM items')
    db.exec("DELETE FROM meta WHERE key IN ('revision', 'saved_at')")
  } finally { db.close() }
}
