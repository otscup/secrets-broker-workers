/**
 * Run a command with credentials in its environment, so a key never has to be
 * written into a .env file that an agent can read.
 *
 *   secrets-broker exec --env OPENAI_API_KEY=openai-prod -- npm run dev
 *
 * The value exists only in the child's environment for as long as it runs. The
 * broker's own log never sees it.
 */
import { spawn } from 'node:child_process'

const FIELDS = new Set(['secret', 'password', 'username', 'url', 'totp'])

// "openai-prod@password" means that field, not the secret.
export function parseSpec(spec) {
  const text = String(spec ?? '')
  const at = text.lastIndexOf('@')
  const name = at > 0 ? text.slice(0, at) : text
  const field = at > 0 ? text.slice(at + 1) : 'secret'
  if (!name) throw new Error('--env needs a name, like --env OPENAI_API_KEY=openai-prod')
  if (!FIELDS.has(field)) throw new Error('unknown field "' + field + '"; use one of ' + [...FIELDS].join(', '))
  return { name, field }
}

function valueOf(entry, field) {
  const payload = entry?.payload ?? {}
  if (field === 'password') return payload.password ?? payload.secret ?? ''
  if (field === 'secret') return payload.secret ?? payload.password ?? ''
  return payload[field] ?? ''
}

const loose = (text) => String(text).toLowerCase().replace(/[\s_\-.]+/g, '')

/**
 * @param {Array} entries rows from pull()
 * @param {string[]} specs "KEY=item" or "KEY=item@field"
 * @returns {{env: object, missing: Array<{key: string, name: string, guess: string}>}}
 */
export function buildEnv(entries, specs) {
  const live = (entries ?? []).filter((entry) => entry && entry.payload && typeof entry.payload.name === 'string')
  const env = {}
  const missing = []
  for (const spec of specs ?? []) {
    const [key, rawName = ''] = String(spec).split('=')
    if (!key || !rawName) throw new Error('--env takes KEY=item, got "' + spec + '"')
    const { name, field } = parseSpec(rawName)
    const entry = live.find((candidate) => candidate.payload.name === name)
    if (!entry) {
      const guess = live.find((candidate) => loose(candidate.payload.name) === loose(name))?.payload.name ?? ''
      missing.push({ key, name, guess })
      continue
    }
    const value = valueOf(entry, field)
    if (!value) throw new Error('item "' + name + '" has no ' + field + ' to give')
    env[key] = value
  }
  return { env, missing }
}

export async function runExec({ command, env, cwd = process.cwd(), spawnImpl = spawn }) {
  if (!command?.length) throw new Error('nothing to run: put the command after --')
  const child = spawnImpl(command[0], command.slice(1), {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    windowsHide: false,
  })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), signal: signal ?? '' }))
  })
}
