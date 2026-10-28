// Daily local backup with a small retention window. The actual backup is the
// same encrypted directory copy as `secrets-broker backup`; this file only
// chooses a timestamped destination and prunes old snapshots.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { backup, brokerHome } from './backup.mjs'

const SENTINEL = 'backup.json'
const STATUS = 'last-backup.json'

function statusFile(root) {
  return path.join(root, STATUS)
}

export function lastBackup(root = process.env.BROKER_BACKUP_DIR || path.join(os.homedir(), 'secrets-broker-backups')) {
  try {
    return JSON.parse(fs.readFileSync(statusFile(root), 'utf8'))
  } catch {
    const snapshots = fs.existsSync(root)
      ? fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, SENTINEL)))
        .map((entry) => entry.name)
        .sort()
      : []
    if (!snapshots.length) return null
    const target = path.join(root, snapshots.at(-1))
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(target, SENTINEL), 'utf8'))
      return { at: meta.createdAt, target, ok: true }
    } catch {
      return { at: snapshots.at(-1), target, ok: true }
    }
  }
}

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
  const status = { at: now().toISOString(), ok: true, target: result.target, removed }
  fs.writeFileSync(statusFile(root), JSON.stringify(status), 'utf8')
  return { target: result.target, removed }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(run(), null, 2))
  } catch (error) {
    console.error('[secrets-broker] backup failed: ' + error.message)
    try {
      const root = process.env.BROKER_BACKUP_DIR || path.join(os.homedir(), 'secrets-broker-backups')
      fs.mkdirSync(root, { recursive: true })
      fs.writeFileSync(statusFile(root), JSON.stringify({ at: new Date().toISOString(), ok: false, error: error.message }), 'utf8')
    } catch {}
    process.exitCode = 1
  }
}
