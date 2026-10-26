// Stop a commit that carries a value this vault already holds. Matching the
// real secret is the point: a generic "looks like a key" rule cries wolf, and a
// rule nobody trusts gets skipped with --no-verify.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const MIN_LENGTH = 8

function git(args, { cwd, allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
  } catch (error) {
    if (allowFail) return null
    throw error
  }
}

function stagedPaths({ cwd }) {
  const out = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACM'], { cwd, allowFail: true })
  return String(out ?? '').split('\0').filter(Boolean)
}

function stagedText({ cwd }, file) {
  const text = git(['show', ':' + file], { cwd, allowFail: true })
  if (text == null) return ''
  return String(text).includes('\0') ? '' : String(text)
}

// Only what a person would call a secret: the vault's own values, long enough
// that a stray match cannot block an honest commit.
export function valuesFrom(items = []) {
  const out = []
  for (const item of items) {
    const payload = item?.payload ?? item ?? {}
    for (const key of ['value', 'password']) {
      const value = payload[key]
      if (typeof value === 'string' && value.length >= MIN_LENGTH) out.push(value)
    }
  }
  return out
}

export function findCommittedSecrets({ cwd = process.cwd(), values = [], files } = {}) {
  const names = files ?? stagedPaths({ cwd })
  const found = []
  for (const file of names) {
    const text = stagedText({ cwd }, file)
    if (!text) continue
    for (const value of values) {
      if (!text.includes(value)) continue
      found.push({ file, value: value.slice(0, 4) + '...' + value.slice(-2) })
      break
    }
  }
  return found
}

export function formatGuard(findings) {
  if (!findings.length) return ''
  const lines = findings.map((hit) => `  ${hit.file} contains ${hit.value}`)
  return ['commit blocked: a staged file carries a value this vault already holds.', ...lines, '',
    'move it into the vault and read it at runtime instead:',
    '  secrets-broker put <name> --stdin        # still needs approval in the panel',
    '  secrets-broker exec --env KEY=<name> -- <command>',
    '', 'to commit anyway: git commit --no-verify', ''].join('\n')
}

export function installHook({ cwd = process.cwd(), cliPath = path.resolve('cli', 'index.mjs'), force = false } = {}) {
  const dir = git(['rev-parse', '--git-dir'], { cwd, allowFail: true })
  if (!dir) throw new Error('not a git repository: ' + cwd)
  const hooks = path.resolve(cwd, String(dir).trim(), 'hooks')
  const file = path.join(hooks, 'pre-commit')
  if (existsSync(file) && !force) throw new Error('a pre-commit hook already exists: ' + file + ' (use --force to replace it)')
  const script = ['#!/bin/sh', '# Written by `secrets-broker guard --install`.', `exec node "${cliPath.replace(/\\/g, '/')}" guard`, ''].join('\n')
  mkdirSync(hooks, { recursive: true })
  writeFileSync(file, script, { mode: 0o755 })
  try { chmodSync(file, 0o755) } catch {}
  return { file, cliPath }
}
