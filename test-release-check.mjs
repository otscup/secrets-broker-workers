import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkRelease } from './scripts/check-release.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-release-check-'))
try {
  const tauri = path.join(root, 'desktop/src-tauri')
  fs.mkdirSync(path.join(tauri, 'target/release/bundle/msi'), { recursive: true })
  fs.writeFileSync(path.join(tauri, 'tauri.conf.json'), JSON.stringify({ version: '9.9.9' }))
  fs.writeFileSync(path.join(tauri, 'Cargo.toml'), '[package]\nversion = "9.9.9"\n')
  fs.writeFileSync(path.join(tauri, 'target/release/bundle/msi/Secrets Broker_9.9.9_x64_en-US.msi'), 'x')
  fs.writeFileSync(path.join(tauri, 'target/release/secrets-broker-desktop.exe'), 'x')
  assert.equal(checkRelease(root).version, '9.9.9')

  fs.writeFileSync(path.join(tauri, 'Cargo.toml'), '[package]\nversion = "9.9.8"\n')
  assert.throws(() => checkRelease(root), /version mismatch/)
  console.log('release check: ok')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
