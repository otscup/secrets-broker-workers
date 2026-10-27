/**
 * Tests for the local ciphertext copy in cli/cache.mjs.
 *
 * No network: this is the file the daemon falls back to, so what matters is
 * that only ciphertext reaches it and that a filtered load returns the right rows.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { savePull, loadPull, cacheStatus, clearCache } from './cli/cache.mjs'

const CLI = path.join(process.cwd(), 'cli', 'index.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cache-'))
const file = path.join(tmp, 'vault.db')
const results = []

function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log('FAIL ' + name + ' :: ' + (error?.message ?? error))
  }
}

const SECRET = 'sk-live-plaintext-must-not-be-here'
const ROWS = [
  { id: 'i1', kind: 'api', revision: 3, updatedAt: '2026-10-26T10:00:00Z', ciphertext: 'CIPH1' },
  { id: 'i2', kind: 'web', revision: 4, updatedAt: '2026-10-26T11:00:00Z', ciphertext: 'CIPH2' },
]

check('C1 a pull is written and read back unchanged', () => {
  savePull({ url: 'https://sb.example', revision: 4, rows: ROWS }, { file })
  const loaded = loadPull({ since: 0 }, { file })
  assert.equal(loaded.revision, 4)
  assert.equal(loaded.rows.length, 2)
  assert.equal(loaded.rows[1].ciphertext, 'CIPH2')
  assert.equal(loaded.rows[1].kind, 'web')
  assert.equal(loaded.url, 'https://sb.example')
})

check('C2 only ciphertext lands in the file', () => {
  savePull({ url: 'https://sb.example', revision: 5, rows: [{ ...ROWS[0], ciphertext: 'AES-ONLY-BLOB' }] }, { file })
  const bytes = fs.readFileSync(file)
  assert.ok(bytes.includes(Buffer.from('AES-ONLY-BLOB')), 'the ciphertext is stored as-is')
  assert.ok(!bytes.includes(Buffer.from(SECRET)), 'no plaintext may reach the local copy')
})

check('C3 a since filter returns only newer rows', () => {
  savePull({ url: 'https://sb.example', revision: 4, rows: ROWS }, { file })
  const newer = loadPull({ since: 3 }, { file })
  assert.deepEqual(newer.rows.map((row) => row.id), ['i2'])
})

check('C4 a second pull replaces the rows instead of piling them up', () => {
  savePull({ url: 'https://sb.example', revision: 6, rows: [{ id: 'i3', kind: 'api', revision: 6, ciphertext: 'CIPH3' }] }, { file })
  const loaded = loadPull({ since: 0 }, { file })
  assert.deepEqual(loaded.rows.map((row) => row.id), ['i3'])
  assert.equal(cacheStatus({ file }).rows, 1)
})

check('C4b an incremental pull keeps the older rows', () => {
  savePull({ url: 'https://sb.example', revision: 4, rows: ROWS }, { file })
  savePull({ url: 'https://sb.example', revision: 5, rows: [{ id: 'i3', kind: 'api', revision: 5, ciphertext: 'CIPH3' }], since: 4 }, { file })
  assert.deepEqual(loadPull({ since: 0 }, { file }).rows.map((row) => row.id), ['i1', 'i2', 'i3'])
})

check('C5 a deleted row keeps no ciphertext and is carried through', () => {
  savePull({ url: 'https://sb.example', revision: 7, rows: [{ id: 'i4', revision: 7, deletedAt: '2026-10-26T12:00:00Z', ciphertext: '' }] }, { file })
  const row = loadPull({ since: 0 }, { file }).rows[0]
  assert.equal(row.id, 'i4')
  assert.equal(row.ciphertext, '')
  assert.equal(row.deletedAt, '2026-10-26T12:00:00Z')
})

check('C6 a missing file reads as empty instead of throwing', () => {
  const empty = loadPull({ since: 0 }, { file: path.join(tmp, 'nope', 'vault.db') })
  assert.deepEqual(empty.rows, [])
  assert.equal(empty.revision, 0)
})

check('C7 clear drops the rows and the revision', () => {
  savePull({ url: 'https://sb.example', revision: 9, rows: ROWS }, { file })
  clearCache({ file })
  const loaded = loadPull({ since: 0 }, { file })
  assert.equal(loaded.rows.length, 0)
  assert.equal(loaded.revision, 0)
})

check('C8 the command reports the copy and can clear it', () => {
  savePull({ url: 'https://sb.example', revision: 11, rows: ROWS }, { file })
  const env = { ...process.env, BROKER_CACHE_FILE: file }
  const shown = spawnSync(process.execPath, [CLI, 'cache'], { encoding: 'utf8', env })
  assert.equal(shown.status, 0, shown.stderr)
  assert.match(shown.stdout, /rows: 2/)
  assert.match(shown.stdout, /revision: 11/)
  assert.match(shown.stdout, /https:\/\/sb\.example/)
  const cleared = spawnSync(process.execPath, [CLI, 'cache', '--clear'], { encoding: 'utf8', env })
  assert.equal(cleared.status, 0, cleared.stderr)
  assert.equal(loadPull({ since: 0 }, { file }).rows.length, 0)
})

const failed = results.filter((result) => !result.ok)
console.log(`\n==== local ciphertext copy ${results.length - failed.length}/${results.length} passed ====`)
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
if (failed.length) {
  for (const result of failed) console.log(result.error?.stack ?? '')
  process.exit(1)
}
