#!/usr/bin/env node
// Give a local broker a usable vault: the users row NodeWarden expects, a
// profile key derived from the master password you choose, and (with --demo)
// three credentials so the panel is not empty.
//
//   node scripts/seed.mjs --password local-master --demo
//
// The panel password is the one scripts/dev.mjs prints; the vault password is
// the one you pass here. They are different on purpose: the panel password
// guards the UI, the vault password decrypts the credentials.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { pbkdf2, hkdfExpand, encryptStr } from '../src/crypto.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback
}

const port = flag('port', '8787')
const persist = flag('persist', '.wrangler-dev')
const email = flag('email', 'agent@otscup.com')
const password = flag('password', '')
const demo = argv.includes('--demo')
const base = 'http://127.0.0.1:' + port

if (!password) {
  console.error('usage: node scripts/seed.mjs --password <vault master password> [--demo] [--port 8787]')
  process.exit(2)
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, key TEXT, kdf_type INTEGER, kdf_iterations INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS ciphers (id TEXT PRIMARY KEY, user_id TEXT, type INTEGER, folder_id TEXT, name TEXT, notes TEXT, data TEXT, key TEXT, favorite INTEGER, reprompt INTEGER, created_at TEXT, updated_at TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, created_at TEXT, updated_at TEXT);
INSERT OR IGNORE INTO users (id, email, key, kdf_type, kdf_iterations, created_at) VALUES ('u1', '${email}', 'placeholder', 0, 600000, '${new Date().toISOString()}');
`

const sqlFile = persist + '/seed.sql'
fs.mkdirSync(persist, { recursive: true })
fs.writeFileSync(sqlFile, SCHEMA)

function d1(file) {
  const res = spawnSync('npx', ['wrangler', 'd1', 'execute', 'NODEWARDEN_DB', '--local', '--persist-to', persist, '--file', file], { encoding: 'utf8', shell: true })
  if (res.status !== 0) {
    console.error((res.stderr || res.stdout || '').split('\n').slice(-6).join('\n'))
    throw new Error('d1 execute failed' + (/(locked|SQLITE_BUSY)/.test(res.stderr || '') ? ' (stop scripts/dev.mjs first, then run this again)' : ''))
  }
}

d1(sqlFile)

async function main() {
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: flag('admin', 'local-dev') }) })
  if (!login.ok) throw new Error('panel login failed (' + login.status + '); start scripts/dev.mjs first')
  const cookie = (login.headers.getSetCookie?.()[0] || login.headers.get('set-cookie') || '').split(';')[0]

  const boot1 = await (await fetch(base + '/api/bootstrap', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).json()
  if (!boot1.email) throw new Error('bootstrap failed: ' + JSON.stringify(boot1).slice(0, 200))

  const master = await pbkdf2(password, String(boot1.email).toLowerCase(), Number(boot1.kdfIterations || 600000))
  const enc = await hkdfExpand(master, 'enc', 32)
  const mac = await hkdfExpand(master, 'mac', 32)
  const profileKey = await encryptStr(Buffer.from([...enc, ...mac]), enc, mac)

  const q = (s) => s.split('\u0027').join('\u0027\u0027')
  const update = persist + '/profilekey.sql'
  fs.writeFileSync(update, "UPDATE users SET key = '" + q(profileKey) + "' WHERE lower(email) = lower('" + q(email) + "');\n")

  console.log('[seed] writing the profile key for ' + email + ' (kdf ' + (boot1.kdfIterations || 600000) + ')')
  try {
    d1(update)
  } catch (error) {
    console.log('[seed] the running dev server holds the database; stop it, rerun this, then start it again')
    throw error
  }

  const unlock = await fetch(base + '/api/unlock', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ symEncKey: Buffer.from(enc).toString('base64'), symMacKey: Buffer.from(mac).toString('base64') }),
  })
  if (!unlock.ok) throw new Error('unlock failed: ' + (await unlock.text()).slice(0, 200))
  console.log('[seed] vault unlocked with your master password')

  if (!demo) return
  const items = [
    { name: 'openai-prod', value: 'sk-demo-openai-0001', username: 'agent', kind: 'api', noApproval: true },
    { name: 'github-pat', value: 'ghp_demo_0002', username: 'agent', kind: 'api' },
    { name: 'ots 后台登录', value: 'demo-web-pass-3', username: 'ops', kind: 'web' },
  ]
  for (const item of items) {
    const made = await fetch(base + '/api/items/create', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: item.name, value: item.value, username: item.username }) })
    if (!made.ok) { console.log('[seed] skipped ' + item.name + ': ' + (await made.text()).slice(0, 120)); continue }
    await fetch(base + '/api/fill/policy', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ item: item.name, kind: item.kind, origins: item.kind === 'web' ? ['https://ots.example'] : undefined, actions: item.kind === 'web' ? ['login'] : undefined }) })
    if (item.noApproval) await fetch(base + '/api/policies', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: item.name, noApproval: true }) })
    console.log('[seed] ' + item.name + ' (' + item.kind + ')')
  }
}

await main()
fs.rmSync(sqlFile, { force: true })
fs.rmSync(persist + '/profilekey.sql', { force: true })
console.log('[seed] done. panel: ' + base + '   vault password: the one you just typed')
