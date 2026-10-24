/**
 * Writing a materialised credential to disk.
 *
 * Deliberately narrow: one `KEY=value` line, 0600, and - until someone asks
 * for more - it refuses to replace an existing key. Overwriting is the only
 * way this feature can quietly swap a credential that something else is
 * already using, so it does not happen by accident.
 */
import fs from 'node:fs'
import path from 'node:path'

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

export class KeyExistsError extends Error {
  constructor(key, file) {
    super(`refusing to overwrite ${key} in ${file}`)
    this.name = 'KeyExistsError'
    this.code = 'key-exists'
    this.key = key
    this.file = file
  }
}

/** Quote only when the value would otherwise break the file. */
export function encodeValue(value) {
  const text = String(value ?? '')
  if (!/[\s#'"\\]/.test(text)) return text
  return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

export function hasKey(content, key) {
  return String(content)
    .split('\n')
    .some((line) => KEY_LINE.exec(line)?.[1] === key)
}

/**
 * @param {{path: string, key: string, value: string, allowOverwrite?: boolean}} options
 * @returns {{path: string, created: boolean, written: number}}
 */
export function writeSecretToFile({ path: filePath, key, value, allowOverwrite = false }) {
  const resolved = path.resolve(filePath)
  let existing = ''
  let created = true
  let mode = 0o600
  try {
    existing = fs.readFileSync(resolved, 'utf8')
    created = false
    const stat = fs.statSync(resolved)
    mode = stat.mode & 0o777
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  if (!created && hasKey(existing, key) && !allowOverwrite) throw new KeyExistsError(key, resolved)

  let next
  if (created || existing === '') {
    next = `${key}=${encodeValue(value)}\n`
  } else if (hasKey(existing, key)) {
    // Only reachable with allowOverwrite.
    next = existing
      .split('\n')
      .map((line) => (KEY_LINE.exec(line)?.[1] === key ? `${key}=${encodeValue(value)}` : line))
      .join('\n')
  } else {
    const trimmed = existing.endsWith('\n') ? existing : existing + '\n'
    next = `${trimmed}${key}=${encodeValue(value)}\n`
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, next, { mode })
  try {
    fs.chmodSync(resolved, mode === 0 ? 0o600 : mode)
  } catch {}
  return { path: resolved, created, written: next.length }
}
