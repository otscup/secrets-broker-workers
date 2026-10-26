// Guard: a commit must not carry a value the vault already holds.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { findCommittedSecrets, installHook, valuesFrom, formatGuard } from './cli/guard.mjs'

const repo = mkdtempSync(path.join(os.tmpdir(), 'sb-guard-'))
const cli = path.resolve('cli/index.mjs')
let failures = 0
const pass = (text) => process.stdout.write('PASS ' + text + '\n')
const fail = (id, detail) => { failures += 1; process.stdout.write('FAIL ' + id + ' :: ' + detail + '\n') }

const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

try {
  git(['init', '-q'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'test'])
  const secret = 'sk-live-9f8e7d6c5b4a3210'
  mkdirSync(path.join(repo, 'src'), { recursive: true })
  writeFileSync(path.join(repo, 'src', 'config.js'), `module.exports = { key: '${secret}' }\n`)
  writeFileSync(path.join(repo, 'README.md'), '# demo\n')
  git(['add', '-A'])

  // G1: the staged file that carries a vault value is named, the clean one is not.
  const hit = findCommittedSecrets({ cwd: repo, values: [secret] })
  const names = hit.map((item) => item.file).sort()
  if (names.length === 1 && names[0] === 'src/config.js' && hit[0].value.startsWith('sk-l') && !hit[0].value.includes('8e7d')) {
    pass('G1 the staged file carrying a vault value is reported, masked')
  } else fail('G1', JSON.stringify(hit))

  // G2: a vault whose values are not in the diff blocks nothing.
  const clean = findCommittedSecrets({ cwd: repo, values: ['a-different-value-entirely'] })
  if (clean.length === 0) pass('G2 an unrelated value blocks nothing')
  else fail('G2', JSON.stringify(clean))

  // G3: only value/password fields of real length count, so short flags do not.
  const values = valuesFrom([{ payload: { value: secret, password: 'short', username: 'me' } }])
  if (values.length === 1 && values[0] === secret) pass('G3 only long value/password fields are compared')
  else fail('G3', JSON.stringify(values))

  // G4: the message tells the reader how to fix it and how to bypass it.
  const message = formatGuard(hit)
  if (message.includes('src/config.js') && message.includes('secrets-broker exec --env') && message.includes('--no-verify')) {
    pass('G4 the block explains the fix and the bypass')
  } else fail('G4', message)

  // G5: install writes an executable hook that names this CLI, and refuses to
  // overwrite an existing one unless forced.
  const installed = installHook({ cwd: repo, cliPath: cli })
  const script = readFileSync(installed.file, 'utf8')
  let refused = false
  try { installHook({ cwd: repo, cliPath: cli }) } catch { refused = true }
  const forced = installHook({ cwd: repo, cliPath: cli, force: true })
  if (existsSync(installed.file) && script.includes(cli.replace(/\\/g, '/')) && script.startsWith('#!/bin/sh') && refused && existsSync(forced.file)) {
    pass('G5 install writes the hook, refuses to clobber it, and --force replaces it')
  } else fail('G5', script + ' refused=' + refused)

  // G6: the real commit runs that hook. With no local vault copy (BROKER_HOME
  // points at an empty directory) there is nothing to compare, so it must say so
  // and let the commit through.
  const blank = mkdtempSync(path.join(os.tmpdir(), 'sb-guard-home-'))
  // Git hands a hook's output to its own stderr, so capture both streams.
  const ran = spawnSync('git', ['commit', '-m', 'carry a secret'], { cwd: repo, encoding: 'utf8', env: { ...process.env, BROKER_HOME: blank, USERPROFILE: blank, HOME: blank } })
  const out = String(ran.stdout ?? '') + String(ran.stderr ?? '')
  try { rmSync(blank, { recursive: true, force: true }) } catch {}
  if (ran.status === 0 && out.includes('no local vault copy')) pass('G6 a real commit runs the hook and is told there is nothing to compare')
  else if (ran.status !== 0) fail('G6', 'the commit was blocked with no vault copy: ' + out.slice(0, 300))
  else fail('G6', 'hook did not run or said nothing: ' + out.slice(0, 300))
} finally {
  try { rmSync(repo, { recursive: true, force: true }) } catch {}
}

process.stdout.write(`==== commit guard ${failures ? 'FAILED' : 'passed'} ====\n`)
process.exit(failures ? 1 : 0)
