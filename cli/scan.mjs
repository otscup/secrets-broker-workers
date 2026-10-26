// Find the credentials that still live in plain files, so they can be moved into
// the vault instead. Read-only: it reports a masked value and the exact command
// that would store it; nothing is ever written or uploaded from here.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { adapters } from './agents.mjs'

const SECRET_NAME = /(api[_-]?key|access[_-]?key|secret|token|password|passwd|pwd|credential|private[_-]?key|database[_-]?url|conn(ection)?[_-]?string|dsn)/i
// Things that look like a secret name but hold a placeholder, a path or a flag.
const NOT_A_VALUE = /^(|x{3,}|\*{3,}|\.{3}|<.*>|\$\{.*\}|\$[A-Z_]+|change[-_ ]?me|your[-_ ].*|todo|tbd|none|null|undefined|true|false|\d+|\[.*\]|\{.*\})$/i

function isSecretName(name) {
  return SECRET_NAME.test(String(name ?? ''))
}

function looksReal(value) {
  const text = String(value ?? '').trim()
  if (NOT_A_VALUE.test(text)) return false
  if (text.length < 8) return false
  // A path or a URL without credentials is not a secret we can move.
  if (/^([a-z]:\\|\/|\.\/|\.\.\/)/i.test(text)) return false
  if (/^(?:https?|wss?):\/\/[^:@/]+$/i.test(text)) return false
  return true
}

// sk-live-abcdef -> sk-l…ef: enough to recognise the credential, useless to
// anyone reading the report over a shoulder.
export function mask(value) {
  const text = String(value ?? '')
  if (text.length <= 8) return '*'.repeat(text.length)
  return text.slice(0, 4) + '…' + text.slice(-2)
}

export function scanEnvText(text, file = '') {
  const found = []
  for (const [index, line] of String(text ?? '').split(/\r?\n/).entries()) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf('=')
    if (at < 1) continue
    const key = trimmed.slice(0, at).replace(/^export\s+/, '').trim()
    let value = trimmed.slice(at + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!isSecretName(key) || !looksReal(value)) continue
    found.push({ file, line: index + 1, key, value, source: 'env' })
  }
  return found
}

// An MCP client config keeps tokens under "env", sometimes under "headers".
export function scanJsonText(text, file = '') {
  let parsed
  try { parsed = JSON.parse(text) } catch { return [] }
  const found = []
  const walk = (node, trail) => {
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      const here = trail ? trail + '.' + key : key
      if (typeof value === 'string') {
        if (isSecretName(key) && looksReal(value)) found.push({ file, line: 0, key: here, value, source: 'json' })
      } else if (Array.isArray(value)) {
        for (const item of value) walk(item, here)
      } else {
        walk(value, here)
      }
    }
  }
  walk(parsed, '')
  return found
}

export function scanFile(file, { readFile = readFileSync } = {}) {
  let text
  try { text = readFile(file, 'utf8') } catch { return [] }
  if (file.toLowerCase().endsWith('.json')) return scanJsonText(text, file)
  return scanEnvText(text, file)
}

// Files worth looking at without being told: the env files in the working
// directory and whatever the detected MCP clients keep on this machine.
export function defaultTargets({ cwd = process.cwd(), home = process.env.HOME || process.env.USERPROFILE, appData = process.env.APPDATA || path.join(home || '', 'AppData', 'Roaming') } = {}) {
  const targets = [path.join(cwd, '.env'), path.join(cwd, '.env.local')]
  for (const adapter of adapters({ home, appData })) targets.push(adapter.file)
  return targets
}

export function scan({ targets = [], readFile = readFileSync, exists = existsSync } = {}) {
  const found = []
  const seen = new Set()
  for (const file of targets) {
    const absolute = path.resolve(file)
    if (seen.has(absolute) || !exists(absolute)) continue
    seen.add(absolute)
    for (const hit of scanFile(absolute, { readFile })) found.push(hit)
  }
  return found
}

// Nothing is uploaded here: the command it prints is what the user (or an agent)
// runs, and that path still needs approval inside the broker.
export function formatFindings(findings, { limit = 50 } = {}) {
  if (!findings.length) return 'no plaintext credentials found in the files checked.\n'
  const lines = findings.slice(0, limit).map((hit) => `${hit.key} = ${mask(hit.value)}  (${hit.file}${hit.line ? ':' + hit.line : ''})`)
  const hint = findings.slice(0, limit).map((hit) => `  secrets-broker put ${suggestName(hit.key)} --stdin   # ${hit.key} from ${path.basename(hit.file)}`)
  return [lines.join('\n'), '', 'to move one into the vault (still needs approval in the panel):', ...hint, '', `${findings.length} found.`].join('\n') + '\n'
}

export function suggestName(key) {
  return String(key ?? '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'credential'
}
