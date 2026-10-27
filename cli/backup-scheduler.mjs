// Daily local backup with a small retention window. The actual backup is the
// same encrypted directory copy as `secrets-broker backup`; this file only
// chooses a timestamped destination and prunes old snapshots.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { backup, brokerHome } from './backup.mjs'

const SENTINEL = 'backup.json'

export function prune(root, keep) {
  if (!fs.existsSync(root)) return []
  const snapshots = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, SENTINEL)))
    .map((entry) => entry.name)
    .sort()
  const stale = snapshots.slice(0, Math.max(0, snapshots.length - keep))
  for (const name of stale) fs.rmSync(path.join(root, name), { recursive: true, force: true })
  return stale
}

export function run({
  home = brokerHome(),
  root = process.env.BROKER_BACKUP_DIR || path.join(os.homedir(), 'secrets-broker-backups'),
  keep = Number(process.env.BROKER_BACKUP_KEEP || 14),
  now = () => new Date(),
} = {}) {
  if (!fs.existsSync(home)) return { skipped: 'no broker state', home }
  fs.mkdirSync(root, { recursive: true })
  const stamp = now().toISOString().replace(/[:.]/g, '-')
  const target = path.join(root, stamp)
  const result = backup({ home, out: target, now })
  const removed = prune(root, keep)
  return { target: result.target, removed }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(run(), null, 2))
  } catch (error) {
    console.error('[secrets-broker] backup failed: ' + error.message)
    process.exitCode = 1
  }
}
