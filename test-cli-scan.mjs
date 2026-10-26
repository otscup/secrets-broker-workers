/**
 * Tests for the plaintext-credential scan in cli/scan.mjs.
 *
 * No network: the scanner only reads. The fixture .env is written to a temp
 * directory, so nothing here can touch the real workspace files.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { scan, scanEnvText, scanJsonText, mask, formatFindings, suggestName, defaultTargets } from './cli/scan.mjs'

const CLI = path.join(process.cwd(), 'cli', 'index.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-scan-'))
const results = []

function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log('FAIL ' + name + ' :: ' + (error?.message ?? error))
  }
}

const ENV = [
  '# a comment, not a credential',
  'OPENAI_API_KEY=sk-live-abcdef123456',
  'CHANGE_ME_TOKEN=changeme',
  'SHORT_TOKEN=abc',
  'PATH=/usr/local/bin',
  'export DATABASE_URL=postgres://user:pw@db.example/app',
  'EMPTY_SECRET=',
].join('\n')

check('S1 only a real-looking value under a secret name is reported', () => {
  const found = scanEnvText(ENV, '.env')
  const keys = found.map((hit) => hit.key).sort()
  assert.deepEqual(keys, ['DATABASE_URL', 'OPENAI_API_KEY'])
  const openai = found.find((hit) => hit.key === 'OPENAI_API_KEY')
  assert.equal(openai.line, 2)
  assert.equal(openai.value, 'sk-live-abcdef123456')
})

check('S2 the mask keeps 4+2 characters and never the whole value', () => {
  const value = 'sk-live-abcdef123456'
  const masked = mask(value)
  assert.equal(masked, 'sk-l…56')
  assert.ok(!masked.includes(value))
  assert.equal(mask('short'), '*****')
})

check('S3 an MCP client config leaks through its env block', () => {
  const text = JSON.stringify({ mcpServers: { demo: { command: 'npx', env: { ANTHROPIC_API_KEY: 'sk-ant-0123456789', DEBUG: '1' } } } })
  const found = scanJsonText(text, 'claude_desktop_config.json')
  assert.equal(found.length, 1)
  assert.match(found[0].key, /env\.ANTHROPIC_API_KEY$/)
  assert.equal(found[0].source, 'json')
})

check('S4 the report shows the mask, the location and a real command', () => {
  const file = path.join(tmp, '.env')
  fs.writeFileSync(file, ENV)
  const found = scan({ targets: [file, path.join(tmp, 'missing.env')] })
  assert.equal(found.length, 2)
  const report = formatFindings(found)
  assert.ok(report.includes('sk-l…56'), report)
  assert.ok(!report.includes('sk-live-abcdef123456'), 'the raw value must never reach the report')
  assert.ok(report.includes('secrets-broker put openai-api-key'), report)
  assert.ok(report.includes('.env:2'), report)
})

check('S5 no findings is a sentence, not an empty table', () => {
  const empty = path.join(tmp, 'empty.env')
  fs.writeFileSync(empty, 'NOTHING=1\n')
  assert.equal(scan({ targets: [empty] }).length, 0)
  assert.match(formatFindings([]), /no plaintext credentials found/)
})

check('S6 the command lists the scan and exits zero', () => {
  const file = path.join(tmp, '.env')
  const run = spawnSync(process.execPath, [CLI, 'scan', '--path', file], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.ok(run.stdout.includes('sk-l…56'), run.stdout)
  const json = spawnSync(process.execPath, [CLI, 'scan', '--path', file, '--json'], { encoding: 'utf8' })
  const parsed = JSON.parse(json.stdout)
  assert.equal(parsed.findings.length, 2)
  assert.equal(parsed.findings[0].name, 'openai-api-key')
  assert.ok(!json.stdout.includes('sk-live-abcdef123456'))
})

check('S7 the default targets include the working directory env files', () => {
  const targets = defaultTargets({ cwd: 'C:\\work\\app', home: 'C:\\Users\\x', appData: 'C:\\Users\\x\\AppData\\Roaming' })
  assert.ok(targets.some((file) => file.endsWith('.env')))
  assert.ok(targets.length >= 2)
})

check('S8 a name is derived from the key', () => {
  assert.equal(suggestName('OPENAI_API_KEY'), 'openai-api-key')
  assert.equal(suggestName('db.prod.password'), 'db-prod-password')
})

const failed = results.filter((result) => !result.ok)
console.log(`\n==== plaintext scan ${results.length - failed.length}/${results.length} passed ====`)
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
if (failed.length) {
  for (const result of failed) console.log(result.error?.stack ?? '')
  process.exit(1)
}
