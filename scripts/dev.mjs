#!/usr/bin/env node
// Start a local broker with a stable SESSION_KEK, so a restart does not log
// every browser out and does not orphan the wrapped tokens in Durable Object
// state. The key is generated once and kept in .dev-keys.json (gitignored).
//
//   node scripts/dev.mjs                 # http://127.0.0.1:8787
//   node scripts/dev.mjs --port 8792     # another port, another vault
//
// Then, once, to give the empty vault a user (and optionally three demo items):
//
//   node scripts/seed.mjs --password local-master --demo
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback
}

const port = flag('port', '8787')
const persist = flag('persist', '.wrangler-dev')
const keyFile = flag('keys', '.dev-keys.json')
const password = flag('password', 'local-dev')

function keys() {
  if (fs.existsSync(keyFile)) {
    const loaded = JSON.parse(fs.readFileSync(keyFile, 'utf8'))
    if (loaded.sessionKek && loaded.adminPassword) return loaded
  }
  const fresh = { sessionKek: randomBytes(32).toString('base64'), adminPassword: password }
  fs.writeFileSync(keyFile, JSON.stringify(fresh, null, 2) + '\n', { mode: 0o600 })
  return fresh
}

const { sessionKek, adminPassword } = keys()
const args = [
  'wrangler', 'dev',
  '--port', port,
  '--persist-to', persist,
  '--var', 'SESSION_KEK:' + sessionKek,
  '--var', 'ADMIN_PASSWORD:' + adminPassword,
  '--var', 'SYNC_ENABLED:1',
]

console.log('[dev] http://127.0.0.1:' + port)
console.log('[dev] panel password: ' + adminPassword + '   (in ' + keyFile + ')')
console.log('[dev] vault state:   ' + path.resolve(persist))
console.log('[dev] a fresh vault needs a user row once: node scripts/seed.mjs --password <master> --demo')
console.log('[dev] the browser half of a credential is decrypted here, so nothing leaves this machine')

const child = spawn('npx', args, { stdio: 'inherit', shell: true, env: process.env })
child.on('exit', (code) => process.exit(typeof code === 'number' ? code : 0))
