/**
 * Where the local bridge keeps its OAuth token.
 *
 * The token is an access token for the whole vault, so it should not sit in a
 * world-readable file when the operating system offers somewhere better:
 *
 *   macOS    security (Keychain)
 *   Linux    secret-tool (libsecret / GNOME keyring, KWallet)
 *   Windows  DPAPI, encrypted per Windows user account
 *
 * When none of those work we fall back to a 0600 file next to the old
 * location, and say so on stderr rather than pretending it is protected.
 *
 * BROKER_TOKEN       static agent token; skips storage entirely
 * BROKER_TOKEN_FILE  file fallback path (default ~/.secrets-broker/oauth.json)
 * BROKER_TOKEN_STORE file | keychain  force a backend
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const SERVICE = 'secrets-broker'
const account = () => process.env.BROKER_KEYCHAIN_ACCOUNT || os.userInfo().username

export function tokenFile() {
  return process.env.BROKER_TOKEN_FILE || path.join(os.homedir(), '.secrets-broker', 'oauth.json')
}

function dpapiFile() {
  return path.join(path.dirname(tokenFile()), 'oauth.dpapi')
}

function forced() {
  return String(process.env.BROKER_TOKEN_STORE || '').toLowerCase()
}

function run(cmd, args, input) {
  return execFileSync(cmd, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }).trim()
}

function has(cmd) {
  try {
    run(process.platform === 'win32' ? 'where' : 'which', [cmd])
    return true
  } catch {
    return false
  }
}

const dpapi = (mode, payload) => {
  const script =
    mode === 'protect'
      ? "$s=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($s); $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'); [Console]::Out.Write([Convert]::ToBase64String($p))"
      : "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))"
  return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], payload)
}

/** Which backend would be used right now, without touching any secret. */
export function describe() {
  const choice = forced()
  const file = tokenFile()
  if (process.env.BROKER_TOKEN) return { store: 'env', detail: 'BROKER_TOKEN', file }
  if (choice === 'file') return { store: 'file', detail: file, file }
  if (choice === 'keychain') return { store: keychainName(), detail: keychainName(), file }
  const name = keychainName()
  if (name) return { store: 'keychain', detail: name, file }
  return { store: 'file', detail: file, file }
}

function keychainName() {
  if (process.platform === 'darwin') return has('security') ? 'keychain' : ''
  if (process.platform === 'linux') return has('secret-tool') ? 'keychain' : ''
  if (process.platform === 'win32') return has('powershell') ? 'dpapi' : ''
  return ''
}

function keychainGet(name) {
  try {
    if (name === 'keychain' && process.platform === 'darwin') return run('security', ['find-generic-password', '-s', SERVICE, '-a', account(), '-w'])
    if (name === 'keychain' && process.platform === 'linux') return run('secret-tool', ['lookup', 'service', SERVICE, 'account', account()])
    if (name === 'dpapi') return dpapi('unprotect', fs.readFileSync(dpapiFile(), 'utf8'))
  } catch {}
  return ''
}

function keychainSet(name, value) {
  if (name === 'keychain' && process.platform === 'darwin') {
    run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account(), '-w', value])
    return true
  }
  if (name === 'keychain' && process.platform === 'linux') {
    run('secret-tool', ['store', '--label=Secrets Broker token', 'service', SERVICE, 'account', account()], value)
    return true
  }
  if (name === 'dpapi') {
    fs.mkdirSync(path.dirname(dpapiFile()), { recursive: true })
    fs.writeFileSync(dpapiFile(), dpapi('protect', value), { mode: 0o600 })
    return true
  }
  return false
}

function keychainDelete(name) {
  try {
    if (name === 'keychain' && process.platform === 'darwin') run('security', ['delete-generic-password', '-s', SERVICE, '-a', account()])
    else if (name === 'keychain' && process.platform === 'linux') run('secret-tool', ['clear', 'service', SERVICE, 'account', account()])
    else if (name === 'dpapi') fs.rmSync(dpapiFile(), { force: true })
  } catch {}
}

/**
 * @returns {{access_token: string, expiresAt?: number, broker?: string}|null}
 */
export function loadRecord() {
  const { store } = describe()
  if (store === 'env') return { access_token: process.env.BROKER_TOKEN, broker: 'env' }

  if (store === 'keychain') {
    const raw = keychainGet(keychainName() || 'keychain')
    if (raw) {
      try {
        return JSON.parse(raw)
      } catch {}
    }
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(tokenFile(), 'utf8'))
    if (parsed?.access_token) return parsed
  } catch {}
  return null
}

/** A token that is still good for at least another minute, else ''. */
export function loadToken() {
  const record = loadRecord()
  if (!record?.access_token) return ''
  if (record.expiresAt && record.expiresAt <= Date.now() + 60_000) return ''
  return record.access_token
}

export function saveRecord(record) {
  const { store } = describe()
  const value = JSON.stringify(record)

  if (store === 'env') return { store, persisted: false }
  if (store === 'keychain') {
    try {
      if (keychainSet(keychainName() || 'keychain', value)) return { store, persisted: true }
    } catch {}
  }

  fs.mkdirSync(path.dirname(tokenFile()), { recursive: true })
  fs.writeFileSync(tokenFile(), JSON.stringify(record, null, 2), { mode: 0o600 })
  try {
    fs.chmodSync(tokenFile(), 0o600)
  } catch {}
  return { store: 'file', persisted: true }
}

export function saveToken(token, expiresIn, broker) {
  return saveRecord({
    access_token: token,
    expiresAt: Date.now() + (Number(expiresIn) || 86400) * 1000,
    broker,
  })
}

export function clearRecord() {
  const { store } = describe()
  if (store === 'keychain') keychainDelete(keychainName() || 'keychain')
  try {
    fs.rmSync(tokenFile(), { force: true })
  } catch {}
  try {
    fs.rmSync(dpapiFile(), { force: true })
  } catch {}
}
