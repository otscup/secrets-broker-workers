// Local discovery: does the CLI find the MCP clients on this machine, and when
// it writes, does it write only the one entry it promised?
//
// Every case runs against a throwaway HOME/APPDATA tree, so nothing here can
// read or touch the real config files of whoever runs the suite.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { adapters, detect, plan, applyPlan, parseLoose, entryFor, CLI_ENTRY } from './cli/agents.mjs'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-agents-'))
const home = path.join(root, 'home')
const appData = path.join(root, 'appdata')
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}
const read = (file) => fs.readFileSync(file, 'utf8')
const opts = { home, appData }
const byId = (id) => adapters(opts).find((adapter) => adapter.id === id)
const BROKER = 'https://broker.example'

try {
  // A1 - a file that exists but says nothing about us is "found", not
  // "configured", and its neighbour is "no file". The difference decides
  // whether the next command offers to write.
  write(path.join(home, '.codex', 'config.toml'), '[mcp_servers.other]\ncommand = "other-server"\n')
  {
    const rows = detect(opts)
    const codex = rows.find((row) => row.id === 'codex')
    const cursor = rows.find((row) => row.id === 'cursor')
    codex.present && !codex.configured && cursor.present === false
      ? pass('A1 detect tells an unrelated config apart from a missing one')
      : fail('A1', JSON.stringify({ codex, cursor }))
  }

  // A2 - dry run plans the change and writes nothing.
  {
    const before = read(path.join(home, '.codex', 'config.toml'))
    const planned = plan(byId('codex'), BROKER)
    const after = read(path.join(home, '.codex', 'config.toml'))
    planned.action === 'update' && /^# >>> secrets-broker/m.test(planned.content.split('\n').slice(-11).join('\n')) && before === after
      ? pass('A2 planning a TOML change touches no file')
      : fail('A2', JSON.stringify({ action: planned.action, same: before === after }))
  }

  // A3 - applying appends a marked block the sync can be repeated over, keeps
  // the old table, and leaves a backup.
  {
    const file = path.join(home, '.codex', 'config.toml')
    applyPlan(plan(byId('codex'), BROKER))
    const text = read(file)
    const hasOld = text.includes('[mcp_servers.other]')
    const hasBlock = text.includes('# >>> secrets-broker\n[mcp_servers.secrets-broker]\ncommand = ')
      && text.includes('args = [' + JSON.stringify(CLI_ENTRY) + ']')
    const hasUrl = text.includes('BROKER_URL = "' + BROKER + '"')
    const backup = fs.existsSync(file + '.secrets-broker.bak')
    hasOld && hasBlock && hasUrl && backup
      ? pass('A3 applying to TOML keeps the old table and appends one marked block')
      : fail('A3', JSON.stringify({ hasOld, hasBlock, hasUrl, backup }))
  }

  // A4 - running it again is a no-op: no second block, no duplicate key.
  {
    const planned = plan(byId('codex'), BROKER)
    const text = read(path.join(home, '.codex', 'config.toml'))
    const blocks = (text.match(/# >>> secrets-broker/g) ?? []).length
    planned.action === 'skip' && blocks === 1
      ? pass('A4 a second run is a no-op')
      : fail('A4', JSON.stringify({ action: planned.action, blocks }))
  }

  // A5 - JSON: an empty config gets the server, and the result still parses.
  {
    const file = path.join(appData, 'Claude', 'claude_desktop_config.json')
    write(file, '{}\n')
    applyPlan(plan(byId('claude-desktop'), BROKER))
    const parsed = JSON.parse(read(file))
    const server = parsed.mcpServers?.['secrets-broker']
    // The command has to exist on this machine. `npx -y secrets-broker-workers`
    // did not: the package is private, so npm answers 404 and the client cannot
    // start. Pointing at the CLI's own file is checkable right here.
    server?.command === process.execPath && server?.args?.[0] === CLI_ENTRY && server?.env?.BROKER_URL === BROKER && fs.existsSync(CLI_ENTRY)
      ? pass('A5 JSON clients get the entry, and the command actually exists')
      : fail('A5', read(file).slice(0, 200))
  }

  // A6 - JSONC: comments and an existing server survive, because the writer
  // splices text instead of re-serialising the object.
  {
    const file = path.join(appData, 'Code', 'User', 'mcp.json')
    write(file, '{\n  // vscode allows comments here\n  "servers": {\n    "other": { "command": "other" }\n  }\n}\n')
    const inspected = detect(opts).find((row) => row.id === 'vscode')
    applyPlan(plan(byId('vscode'), BROKER))
    const text = read(file)
    const keptComment = text.includes('// vscode allows comments here')
    const keptOther = text.includes('"other"')
    const added = text.includes('"secrets-broker"')
    const parses = Boolean(parseLoose(text).servers['secrets-broker'])
    inspected.present && !inspected.configured && !inspected.error && keptComment && keptOther && added && parses
      ? pass('A6 a JSONC file keeps its comments and gains one entry')
      : fail('A6', JSON.stringify({ inspected, keptComment, keptOther, added, parses }))
  }

  // A7 - an agent that already talks to a broker is reported as configured and
  // left alone, even when the entry has a different name.
  {
    const file = path.join(home, '.claude.json')
    write(file, JSON.stringify({ mcpServers: { 'my-broker': { command: 'npx', args: ['-y', 'secrets-broker-workers'] } } }, null, 2))
    const inspected = detect(opts).find((row) => row.id === 'claude-code')
    const planned = plan(byId('claude-code'), BROKER)
    inspected.configured && inspected.entry === 'my-broker' && planned.action === 'skip'
      ? pass('A7 an existing entry with another name still counts as configured')
      : fail('A7', JSON.stringify({ inspected, action: planned.action }))
  }

  // A8 - a file we cannot parse is never "add a second entry to it".
  {
    const file = path.join(home, '.gemini', 'settings.json')
    write(file, '{ this is not json ')
    const planned = plan(byId('gemini'), BROKER)
    planned.action === 'skip' && /parse/.test(String(planned.reason))
      ? pass('A8 an unparsable config is refused, not appended to')
      : fail('A8', JSON.stringify({ action: planned.action, reason: planned.reason }))
  }

  // A9 - the CLI shape itself: detect lists ids, connect defaults to a dry run.
  {
    const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: appData }
    const cursorFile = path.join(appData, 'Cursor', 'User', 'mcp.json')
    write(cursorFile, JSON.stringify({ mcpServers: {} }, null, 2) + '\n')
    const detected = spawnSync(process.execPath, ['cli/index.mjs', 'agents', 'detect'], { encoding: 'utf8', env })
    const dry = spawnSync(process.execPath, ['cli/index.mjs', 'agents', 'connect', '--id', 'cursor'], { encoding: 'utf8', env })
    const listed = /codex/.test(detected.stdout) && /configured/.test(detected.stdout)
    const dryRun = /would get/.test(dry.stdout) && /nothing was written/.test(dry.stdout)
    const untouched = !read(cursorFile).includes('secrets-broker')
    listed && dryRun && untouched
      ? pass('A9 the command line lists clients and defaults to a dry run')
      : fail('A9', JSON.stringify({ detected: detected.stdout.slice(0, 120), dry: dry.stdout.slice(0, 160), untouched }))
  }

  // A10 - the entry carries no credential: the bridge logs in on its own.
  {
    const blob = JSON.stringify(entryFor(BROKER))
    const clean = !/"(token|apiKey|api_key|password|authorization)"/i.test(blob) && !/Bearer/.test(blob)
    clean ? pass('A10 the entry written into an agent config holds no token') : fail('A10', blob)
  }

  // A12 - an empty "mcpServers": {} is the most common starting point for a
  // JSON client, and a comma after the only member makes the file invalid.
  // Clients that parse strictly then refuse to start, which is worse than not
  // being configured at all.
  {
    const file = path.join(appData, 'Cursor', 'User', 'mcp.json')
    write(file, '{\n  "mcpServers": {}\n}\n')
    applyPlan(plan(byId('cursor'), BROKER))
    let parsed = null
    let error = ''
    try { parsed = JSON.parse(read(file)) } catch (e) { error = e.message }
    parsed?.mcpServers?.['secrets-broker']?.env?.BROKER_URL === BROKER && !error
      ? pass('A12 an empty mcpServers object stays strict JSON after the write')
      : fail('A12', error || read(file).slice(0, 200))
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

// A11 - the package has to be installable on its own: every relative import in
// cli/ must be covered by package.json "files", or the published tarball throws
// ERR_MODULE_NOT_FOUND on a user's machine (found exactly that way).
{
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const covered = (spec) => {
    const target = path.normalize(spec).replace(/^\.\//, '').replace(/\\/g, '/')
    return (pkg.files ?? []).some((entry) => {
      const base = String(entry).replace(/\/$/, '')
      if (base.includes('.')) return target === base.replace(/\\/g, '/')
      return target === base || target.startsWith(base + '/')
    })
  }
  const missing = []
  const seen = new Set()
  const walk = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      const spec = match[1]
      const resolved = path.normalize(path.join(path.dirname(file), spec)).replace(/\\/g, '/')
      if (!covered(resolved)) missing.push(resolved)
      else if (fs.existsSync(resolved)) walk(resolved)
    }
  }
  for (const file of fs.readdirSync('cli').filter((name) => name.endsWith('.mjs'))) walk(path.join('cli', file))
  if (fs.existsSync(path.join('mcp-stdio', 'index.mjs'))) walk('mcp-stdio/index.mjs')
  missing.length === 0
    ? pass('A11 every import the CLI needs is in the published file list')
    : fail('A11', 'not shipped: ' + missing.join(', '))
}

const failed = results.filter((row) => !row.ok)
console.log('==== agents detect ' + (results.length - failed.length) + '/' + results.length + ' passed ====')
if (failed.length) process.exitCode = 1

