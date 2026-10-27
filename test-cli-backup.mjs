// Local backup/restore: the encrypted state directory round-trips, and a
// restore refuses to overwrite existing state unless asked.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backup, restore } from './cli/backup.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-backup-test-'))
try {
  const home = path.join(root, 'home')
  fs.mkdirSync(path.join(home, 'tmp'), { recursive: true })
  fs.writeFileSync(path.join(home, 'device.json'), '{"sealed":"device"}')
  fs.writeFileSync(path.join(home, 'vault.db'), 'ciphertext')
  fs.writeFileSync(path.join(home, 'local-agents.dpapi'), 'dpapi')
  fs.writeFileSync(path.join(home, 'tmp', 'scratch.txt'), 'do not copy')

  const out = path.join(root, 'backup')
  const made = backup({ out, home, now: () => new Date('2026-10-28T00:00:00Z') })
  assert.equal(made.target, out)
  assert.equal(fs.readFileSync(path.join(out, 'device.json'), 'utf8'), '{"sealed":"device"}')
  assert.equal(fs.existsSync(path.join(out, 'tmp')), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'backup.json'), 'utf8')).format, 'secrets-broker-local-backup-v1')

  fs.writeFileSync(path.join(home, 'device.json'), 'changed')
  assert.throws(() => restore({ from: out, home }), /already exists/)
  restore({ from: out, home, force: true })
  assert.equal(fs.readFileSync(path.join(home, 'device.json'), 'utf8'), '{"sealed":"device"}')
  assert.equal(fs.existsSync(path.join(home, 'backup.json')), false)
  assert.throws(() => backup({ out: path.join(home, 'inside'), home }), /outside/)
  console.log('backup/restore ok')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
