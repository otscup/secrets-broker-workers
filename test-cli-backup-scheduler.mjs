import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lastBackup, run } from './cli/backup-scheduler.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-backup-scheduler-'))
const home = path.join(root, 'state')
const backups = path.join(root, 'backups')
try {
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(home, 'device.json'), '{"sealed":"x"}')

  const dates = [
    new Date('2026-01-01T03:30:00Z'),
    new Date('2026-01-02T03:30:00Z'),
    new Date('2026-01-03T03:30:00Z'),
  ]
  for (const date of dates) run({ home, root: backups, keep: 2, now: () => date })

  const snapshots = fs.readdirSync(backups, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  assert.equal(snapshots.length, 2, 'retention keeps two snapshots')
  assert.ok(!snapshots.includes('2026-01-01T03-30-00-000Z'), 'oldest snapshot pruned')
  assert.equal(
    fs.readFileSync(path.join(backups, snapshots[1], 'device.json'), 'utf8'),
    '{"sealed":"x"}',
    'backup contains the encrypted state',
  )
  assert.ok(fs.existsSync(path.join(backups, snapshots[1], 'backup.json')), 'sentinel present')
  assert.equal(lastBackup(backups)?.ok, true, 'status records a successful backup')
  assert.equal(lastBackup(backups).target, path.join(backups, snapshots[1]), 'status points at newest snapshot')
  console.log('backup scheduler: retention, content, and status ok')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
