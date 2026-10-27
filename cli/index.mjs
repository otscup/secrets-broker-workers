#!/usr/bin/env node
/**
 * Secrets Broker local bridge.
 *
 *   node cli/index.mjs                    speak MCP over stdio (for stdio-only clients)
 *   node cli/index.mjs login              log in now
 *   node cli/index.mjs status             where is the token kept, is it valid
 *   node cli/index.mjs logout              forget the token
 *   node cli/index.mjs materialize <item> --path <file> --key NAME
 *                                        write an approved credential into a file
 *   node cli/index.mjs agents connect     point local agents at this broker
 *
 * The package is still private, so there is no published name to npx yet. Run it
 * from a checkout (`node cli/index.mjs`) until it is published.
 *
 * Environment:
 *   BROKER_URL          broker base URL (default https://sb.otscup.com)
 *   BROKER_TOKEN        static agent token; skips login and storage
 *   BROKER_TOKEN_FILE   file fallback for the token cache
 *   BROKER_TOKEN_STORE  file | keychain
 *   BROKER_NO_BROWSER=1 do not open windows, print URLs instead
 */
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { log, handleApprovals, openBrowser } from './approval.mjs'
import { createBridge } from './bridge.mjs'
import { login } from './oauth.mjs'
import { runMaterialize } from './materialize.mjs'
import { runSync } from './sync.mjs'
import { pair, pairRequest, pairWait, pairDeepLink, unlock, count, loadDevice, pull, push } from './vault.mjs'
import { createLocalServer } from './vaulttools.mjs'
import { buildEnv, runExec } from './exec.mjs'
import { scan, defaultTargets, formatFindings, mask, suggestName } from './scan.mjs'
import { cacheStatus, clearCache } from './cache.mjs'
import { installHook, findCommittedSecrets, valuesFrom, formatGuard } from './guard.mjs'
import { makeDaemon } from './daemon.mjs'
import { detect, adapters, plan, planLocal, applyPlan, entryFor, tomlBlock, ENTRY_NAME } from './agents.mjs'
import { KeyExistsError } from './write.mjs'
import { clearRecord, describe, loadRecord, loadToken } from './store.mjs'

const DEFAULT_URL = 'https://sb.otscup.com'

export const brokerUrl = () => (process.env.BROKER_URL || DEFAULT_URL).replace(/\/+$/, '')

// Options that take a value. Their value must be removed before positional
// lookup, or `materialize --path .env name` reads `.env` as the secret name.
const VALUE_OPTIONS = new Set(['--id', '--remote', '--remote-token', '--path', '-p', '--key', '-k'])
function positionals(argv) {
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    if (VALUE_OPTIONS.has(argv[i])) i += 1
    else if (!argv[i].startsWith('-')) rest.push(argv[i])
  }
  return rest
}

const help = `secrets-broker - local bridge to a Secrets Broker deployment

Usage
  secrets-broker                 speak MCP over stdio (put this in your client config)
  secrets-broker login           log in through the browser now
  secrets-broker status          show the broker, the token store and its expiry
  secrets-broker logout          forget the stored token
  secrets-broker materialize <item> --path <file> --key NAME
                                 ask, then write an approved credential into a file
  secrets-broker sync --remote URL
                                 compare this broker with another one, read-only
  secrets-broker pair --url URL [--cookie C]
                                 pair this machine with a v2 vault, keep the key locally
                                 (no cookie: prints a device code to approve in a browser)
  secrets-broker serve --vault   answer MCP from the vault this machine holds
  secrets-broker exec --env KEY=item -- <command>
                                 run a command with the value in its environment,
                                 so no .env file has to hold it
  secrets-broker up [--port 4319] [--every 15]
                                 keep the vault decrypted in memory and answer
                                 MCP on 127.0.0.1, so each agent start is instant
  secrets-broker unlock          check the stored key against the vault fingerprint
  secrets-broker pull [--since N] [--to FILE] [--offline]
                                 open the vault here; --offline answers from the local copy
                                 decrypt the vault into a file (mode 0600)
  secrets-broker push --from FILE
                                 seal that file again and upload it
  secrets-broker rekey --password P --cookie C
                                 re-encrypt the vault under a new key (revokes what an old key could read)
  secrets-broker cache [--clear]
                                 show (or drop) the local ciphertext copy the daemon falls back to
  secrets-broker scan [--path FILE] [--json]
secrets-broker guard [--install] [--repo DIR]   block a commit that carries a vault value
                                 list the credentials still sitting in plain files
  secrets-broker put <name> [--stdin]
                                 store one in the vault (still needs approval)
  secrets-broker agents detect   list the MCP clients on this machine
  secrets-broker agents connect [--id codex] [--local] [--apply]
                                 add this broker, or the local sidecar, to their config
                                 (dry run by default)

Environment
  BROKER_URL          broker base URL (default ${DEFAULT_URL})
  BROKER_TOKEN        static agent token; skips login and token storage
  BROKER_TOKEN_FILE   file fallback for the token cache
  BROKER_TOKEN_STORE  file | keychain
  BROKER_NO_BROWSER=1 print URLs instead of opening a browser
  BROKER_REMOTE_URL   the other broker for sync
  BROKER_REMOTE_TOKEN its token (the local one is BROKER_TOKEN or the stored login)

Example client config (Claude Desktop, Codex, any stdio MCP client)
  {
    "mcpServers": {
      "secrets-broker": {
        "command": "node",
        "args": ["<checkout>/cli/index.mjs"],
        "env": { "BROKER_URL": "${DEFAULT_URL}" }
      }
    }
  }
  (or just run: node cli/index.mjs agents connect --apply)
`

function age(iso) {
  if (!iso) return 'never'
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (!Number.isFinite(seconds)) return 'unknown'
  if (seconds < 90) return `${seconds}s ago`
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

async function status() {
  const url = brokerUrl()
  const store = describe()
  const record = loadRecord()
  const token = loadToken()
  const cached = cacheStatus()
  const lines = [
    `broker: ${url}`,
    `token store: ${store.store}${store.store === 'keychain' ? ` (${store.detail})` : ''}`,
    store.store === 'file' ? `token file: ${store.file}` : null,
    process.env.BROKER_TOKEN ? 'token source: BROKER_TOKEN (static)' : null,
    record?.expiresAt ? `expires: ${new Date(record.expiresAt).toISOString()}${token ? '' : ' (expired)'}` : 'expires: unknown',
    token ? 'status: logged in' : 'status: not logged in',
    cached.rows
      ? `local copy: ${cached.rows} items at revision ${cached.revision}, saved ${age(cached.savedAt)}`
      : 'local copy: none (run `secrets-broker pull` while online)',
  ].filter(Boolean)
  process.stdout.write(lines.join('\n') + '\n')
  return token ? 0 : 1
}

async function main() {
  const argv = process.argv.slice(2)
  const args = positionals(argv)
  const command = args[0] || 'serve'

  if (argv.includes('--help') || argv.includes('-h') || command === 'help') {
    process.stdout.write(help)
    return 0
  }
  if (argv.includes('--version') || command === 'version') {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    process.stdout.write('secrets-broker ' + pkg.version + '\n')
    return 0
  }

  if (command === 'cache') {
    if (argv.includes('--clear')) {
      clearCache()
      process.stdout.write('local copy cleared\n')
      return 0
    }
    const status = cacheStatus()
    process.stdout.write([
      'file: ' + status.file,
      'rows: ' + status.rows,
      'revision: ' + status.revision,
      'saved: ' + (status.savedAt ?? 'never'),
      'from: ' + (status.url || 'unknown'),
    ].join('\n') + '\n')
    return 0
  }

  if (command === 'scan') {
    const paths = []
    for (let index = 0; index < argv.length; index += 1) {
      if (argv[index] === '--path') { paths.push(String(argv[index + 1] ?? '')); index += 1 }
    }
    const targets = paths.length ? paths : defaultTargets()
    const findings = scan({ targets })
    if (argv.includes('--json')) {
      process.stdout.write(JSON.stringify({ findings: findings.map((hit) => ({ ...hit, value: mask(hit.value), name: suggestName(hit.key) })) }, null, 2) + '\n')
      return 0
    }
    process.stdout.write(formatFindings(findings))
    return 0
  }

  if (command === 'guard') {
    const flag = (name) => {
      const index = argv.indexOf(name)
      return index >= 0 ? String(argv[index + 1] ?? '') : ''
    }
    const repo = flag('--repo') || process.cwd()
    try {
      if (argv.includes('--install')) {
        const installed = installHook({ cwd: repo, cliPath: path.resolve(process.argv[1] || 'cli/index.mjs'), force: argv.includes('--force') })
        process.stdout.write(`pre-commit installed: ${installed.file}\n`)
        return 0
      }
      let values = []
      try {
        const pulled = await pull({ offline: true })
        values = valuesFrom(pulled.items)
      } catch (error) {
        // No local copy means nothing to compare against; say so instead of
        // pretending the commit was checked.
        process.stdout.write('no local vault copy yet, so no value could be compared (' + String(error?.message ?? error).slice(0, 140) + ')\n')
        return 0
      }
      const findings = findCommittedSecrets({ cwd: repo, values })
      if (!findings.length) return 0
      process.stderr.write(formatGuard(findings))
      return 1
    } catch (error) {
      process.stderr.write(String(error.message ?? error) + '\n')
      return 1
    }
  }

  if (command === 'put') {
    const name = positionals(argv.filter((item) => item !== '--stdin'))[0]
    if (!name) {
      process.stderr.write('usage: secrets-broker put <name> [--stdin] [--value V]\n')
      return 2
    }
    const at = argv.indexOf('--value')
    let value = at >= 0 ? String(argv[at + 1] ?? '') : ''
    if (!value) {
      // stdin by default: a value on the command line lands in shell history.
      const chunks = []
      for await (const chunk of process.stdin) chunks.push(chunk)
      value = Buffer.concat(chunks).toString('utf8').trim()
    }
    if (!value) {
      process.stderr.write('no value given (pipe one in, or pass --value)\n')
      return 2
    }
    const bridge = createBridge({ brokerUrl: brokerUrl() })
    const raw = await bridge.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'put_secret', arguments: { name, value } },
    })
    let answer = raw
    try { answer = (JSON.parse(raw).result?.content ?? []).map((part) => part.text ?? '').join('\n') || raw } catch {}
    process.stdout.write(answer + '\n')
    return 0
  }

  if (command === 'exec') {
    const raw = process.argv.slice(3)
    const specs = []
    let start = -1
    for (let index = 0; index < raw.length; index += 1) {
      if (raw[index] === '--') { start = index + 1; break }
      if (raw[index] === '--env') { specs.push(String(raw[index + 1] ?? '')); index += 1; continue }
      if (raw[index].startsWith('--env=')) specs.push(raw[index].slice(6))
    }
    const child = start > 0 ? raw.slice(start) : []
    if (!specs.length) {
      log('exec needs at least one --env KEY=item')
      return 2
    }
    let pulled
    try {
      pulled = await pull({ since: 0 })
    } catch (error) {
      process.stderr.write('cannot read the vault: ' + String(error?.message ?? error) + '\n')
      return 1
    }
    let env = {}
    let missing = []
    try {
      ({ env, missing } = buildEnv(pulled.items, specs))
    } catch (error) {
      process.stderr.write(String(error?.message ?? error) + '\n')
      return 2
    }
    if (missing.length) {
      for (const item of missing) process.stderr.write(`no item named "${item.name}" for ${item.key}${item.guess ? '; did you mean "' + item.guess + '"?' : ''}\n`)
      return 1
    }
    try {
      const result = await runExec({ command: child, env })
      return result.code
    } catch (error) {
      process.stderr.write(String(error?.message ?? error) + '\n')
      return 1
    }
  }

  if (command === 'up') {
    const flag = (name, fallback) => {
      const at = argv.indexOf('--' + name)
      return at >= 0 ? String(argv[at + 1] ?? '') : fallback
    }
    const port = Number(flag('port', '4319'))
    const every = Number(flag('every', '15'))
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      log('--port must be a port number')
      return 2
    }
    if (!Number.isFinite(every) || every < 0) {
      log('--every must be minutes, or 0 to never refresh')
      return 2
    }
    const daemon = makeDaemon({ pull, everyMs: every * 60 * 1000, log })
    const first = await daemon.refresh()
    if (first.stale) {
      process.stderr.write('cannot read the vault: ' + first.error + '\n')
      return 1
    }
    if (!first.vault.length) log('warning: the vault came back empty')
    const { origin } = await daemon.listen({ port })
    log('vault daemon on ' + origin)
    log('  ' + first.vault.length + ' item(s), refreshing every ' + (every ? every + ' min' : 'never'))
    log('  MCP: ' + origin + '/mcp     health: ' + origin + '/healthz')
    await new Promise((resolve) => {
      const stop = () => { daemon.close().then(resolve, resolve) }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    return 0
  }

  if (command === 'agents') {
    const sub = args[1] || 'detect'
    const flag = (name) => {
      const index = argv.indexOf(name)
      return index >= 0 ? argv[index + 1] : ''
    }
    const only = flag('--id')
    const write = argv.includes('--apply')
    const local = argv.includes('--local')
    if (sub === 'detect') {
      const found = detect().filter((row) => !only || row.id === only)
      if (!found.length) {
        process.stdout.write('no known MCP clients found in this user profile\n')
        return 0
      }
      const rows = found.map((row) => [
        row.configured ? 'configured' : row.present ? 'found' : 'no file',
        row.id.padEnd(15, ' '),
        row.name.padEnd(16, ' '),
        row.file,
        row.error ? '(' + row.error + ')' : '',
      ].join('  '))
      process.stdout.write(rows.join('\n') + '\n')
      return 0
    }
    if (sub === 'connect') {
      const url = brokerUrl()
      const targets = adapters().filter((adapter) => !only || adapter.id === only)
      if (!targets.length) {
        process.stderr.write('no client matches --id ' + only + '\n')
        return 2
      }
      let changed = 0
      for (const adapter of targets) {
        const planned = local ? planLocal(adapter) : plan(adapter, url)
        if (planned.action === 'skip') {
          if (planned.configured) process.stdout.write(planned.name + ' already points at a broker\n')
          continue
        }
        if (!write) {
          process.stdout.write('# ' + planned.name + ' (' + planned.file + ') would get:\n')
          const preview = planned.kind === 'toml'
            ? tomlBlock(url)
            : JSON.stringify({ [ENTRY_NAME]: entryFor(url) }, null, 2)
          process.stdout.write(preview + '\n')
          continue
        }
        applyPlan(planned)
        changed += 1
        process.stdout.write('updated ' + planned.name + ' (' + planned.file + '), backup alongside as .secrets-broker.bak\n')
      }
      if (!write) process.stdout.write('\nnothing was written. Add --apply to make these changes.\n')
      else process.stdout.write(changed ? '\n' + changed + ' client(s) updated; restart them to pick up the server.\n' : '\nnothing to change.\n')
      return 0
    }
    process.stderr.write('usage: secrets-broker agents <detect|connect> [--id codex] [--local] [--apply]\n')
    return 2
  }

  if (command === 'status') return status()

  if (command === 'logout') {
    clearRecord()
    log('stored token removed')
    return 0
  }

  if (command === 'login') {
    const result = await login(brokerUrl())
    log(`logged in; token kept in ${result.store}`)
    return 0
  }

  if (command === 'pair') {
    const flag = (flagName) => {
      const index = argv.indexOf(flagName)
      return index >= 0 ? argv[index + 1] : ''
    }
    const name = flag('--name') || 'this computer'
    const url = flag('--url') || brokerUrl()
    const cookie = flag('--cookie') || process.env.BROKER_ADMIN_COOKIE || ''
    try {
      // A cookie is the one-step path; a machine with no browser session gets the
      // device code and an approval in whatever browser the admin already has.
      if (cookie) {
        const paired = await pair({ url, cookie, name })
        process.stdout.write(`paired ${paired.name} (${paired.id})\nvault key: ${paired.fingerprint}\nstored in ${paired.file}\n`)
        return 0
      }
      const request = await pairRequest({ url, name })
      process.stdout.write(`open this page and approve the device:\n  ${request.url}\n\ncode: ${request.code}\nkey fingerprint: ${request.fingerprint}\n\nthe fingerprint above must match the one on that page. waiting for approval…\n`)
      // Open the approval page in the normal browser, then bring the desktop app
      // forward. The app is told not to open a second tab.
      openBrowser(request.url)
      openBrowser(pairDeepLink(request))
      const paired = await pairWait({ base: request.base, pollToken: request.pollToken, keypair: request.keypair, name })
      process.stdout.write(`paired ${paired.name} (${paired.id})\nvault key fingerprint: ${paired.fingerprint} (not the master password; already stored on this machine)\nstored in ${paired.file}\n`)
      return 0
    } catch (error) {
      process.stderr.write(String(error.message ?? error) + '\n')
      return 1
    }
  }

  if (command === 'rekey') {
    const flag = (flagName) => {
      const index = argv.indexOf(flagName)
      return index >= 0 ? argv[index + 1] : ''
    }
    const cookie = flag('--cookie') || process.env.BROKER_ADMIN_COOKIE || ''
    const password = flag('--password') || process.env.BROKER_VAULT_PASSWORD || ''
    if (!cookie) {
      process.stderr.write('rekey needs an admin session: pass --cookie or BROKER_ADMIN_COOKIE\n')
      return 2
    }
    if (!password) {
      process.stderr.write('rekey needs the vault master password: pass --password or BROKER_VAULT_PASSWORD\n')
      return 2
    }
    try {
      const endpoint = String(flag('--url') || brokerUrl()).replace(/\/+$/, '') + '/api/v2/rekey'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ password }),
      })
      const text = await response.text()
      if (!response.ok) {
        process.stderr.write('rekey failed (' + response.status + '): ' + text.slice(0, 300) + '\n')
        return 1
      }
      const body = JSON.parse(text)
      process.stdout.write(`rekeyed: ${body.converted} item(s) re-encrypted, ${body.wiped} tombstone(s) scrubbed, ${body.devices} device(s) re-signed\nnew vault key: ${body.fingerprint}\n`)
      // This machine is a device as well: fetch its re-signed envelope so the next
      // pull does not fail against rows sealed with the new key.
      if (loadDevice()) {
        try {
          await unlock()
          process.stdout.write('this machine picked up the new key\n')
        } catch (error) {
          process.stderr.write('this machine could not pick up the new key: ' + String(error.message ?? error) + '\n')
        }
      }
      return 0
    } catch (error) {
      process.stderr.write(String(error.message ?? error) + '\n')
      return 1
    }
  }

  if (command === 'unlock') {
    try {
      const opened = await unlock()
      const device = loadDevice()
      const pulled = await count(device)
      process.stdout.write(`vault key: ${opened.fingerprint} (matches the paired vault)\n`)
      if (pulled.error) process.stdout.write(`ciphertext pull: ${pulled.error}\n`)
      else process.stdout.write(`ciphertext pull: ${pulled.items} rows at revision ${pulled.revision}\n`)
      return 0
    } catch (error) {
      process.stderr.write(String(error.message ?? error) + '\n')
      return 1
    }
  }

  if (command === 'pull') {
    const flag = (flagName) => {
      const index = argv.indexOf(flagName)
      return index >= 0 ? argv[index + 1] : ''
    }
    try {
      const pulled = await pull({ since: Number(flag('--since') || 0), offline: argv.includes('--offline') })
      const live = pulled.items.filter((item) => !item.deleted)
      const broken = live.filter((item) => !item.payload)
      const to = flag('--to') || ''
      if (to) writeFileSync(to, JSON.stringify({ url: pulled.url, revision: pulled.revision, items: pulled.items }, null, 2), { mode: 0o600 })
      process.stdout.write(`${live.length} items at revision ${pulled.revision}${to ? ', written to ' + to : ''}\n`)
      if (pulled.stale) process.stdout.write(`from the local copy, saved ${age(pulled.stale.savedAt)} (${pulled.stale.reason})\n`)
      if (broken.length) process.stdout.write(`${broken.length} rows did not open with this key (they belong to another vault key)\n`)
      return 0
    } catch (error) {
      process.stderr.write(String(error.message ?? error) + '\n')
      return 1
    }
  }

  if (command === 'push') {
    const flag = (flagName) => {
      const index = argv.indexOf(flagName)
      return index >= 0 ? argv[index + 1] : ''
    }
    try {
      const from = flag('--from')
      if (!from) throw new Error('push needs --from <file written by `secrets-broker pull --to`>')
      const document = JSON.parse(readFileSync(from, 'utf8'))
      const result = await push({ items: document.items ?? [] })
      process.stdout.write(`pushed ${result.written} rows, vault now at revision ${result.revision}\n`)
      return 0
    } catch (error) {
      process.stderr.write(String(error.message ?? error) + '\n')
      return 1
    }
  }

  if (command === 'sync') {
    const flag = (flagName) => {
      const index = argv.indexOf(flagName)
      return index >= 0 ? argv[index + 1] : ''
    }
    // Stage 1 is a preview. Refusing --apply outright is better than accepting
    // it and quietly doing nothing, which would look like a successful merge.
    if (argv.includes('--apply') || argv.includes('--write')) {
      process.stderr.write('sync is read-only for now: drop --apply, look at the diff, then we can agree on the merge rules\n')
      return 2
    }
    const remoteUrl = (flag('--remote') || process.env.BROKER_REMOTE_URL || '').replace(/\/+$/, '')
    if (!remoteUrl) {
      process.stderr.write('usage: secrets-broker sync --remote https://broker.example [--json] [--verbose]\n')
      return 2
    }
    try {
      const result = await runSync({
        localUrl: brokerUrl(),
        localToken: process.env.BROKER_TOKEN || loadToken() || '',
        remoteUrl,
        remoteToken: flag('--remote-token') || process.env.BROKER_REMOTE_TOKEN || '',
        verbose: argv.includes('--verbose'),
      })
      if (argv.includes('--json')) {
        const summary = {
          local: result.local.count,
          remote: result.remote.count,
          push: result.diff.push.length,
          pull: result.diff.pull.length,
          delete: result.diff.delete.length,
          equal: result.diff.equal,
          conflict: result.diff.conflict.length,
        }
        process.stdout.write(JSON.stringify(summary) + '\n')
        return 0
      }
      process.stdout.write(result.text + '\n')
      return 0
    } catch (error) {
      process.stderr.write(String(error?.message ?? error) + '\n')
      return 1
    }
  }

  if (command === 'materialize') {
    const name = args[1] || ''
    const flag = (flagName) => {
      const index = argv.indexOf(flagName)
      return index >= 0 ? argv[index + 1] : ''
    }
    const targetPath = flag('--path') || flag('-p')
    const key = flag('--key') || flag('-k')
    if (!name || !targetPath || !key) {
      process.stderr.write('usage: secrets-broker materialize <item> --path <file> --key NAME\n')
      return 2
    }
    const bridge = createBridge({ brokerUrl: brokerUrl(), staticToken: process.env.BROKER_TOKEN || '' })
    try {
      const result = await runMaterialize({ bridge, name, path: targetPath, key })
      process.stdout.write(`${result.created ? 'created' : 'appended'} ${result.key} in ${result.path}\n`)
      return 0
    } catch (error) {
      if (error instanceof KeyExistsError) {
        process.stderr.write(`${error.message}\n`)
        process.stderr.write('remove the line yourself, or pass a different --key; overwriting is not automatic\n')
        return 3
      }
      process.stderr.write(String(error?.message ?? error) + '\n')
      return 1
    }
  }

  if (command !== 'serve') {
    process.stderr.write(`unknown command: ${command}\n\n${help}`)
    return 2
  }

  return serve()
}

// Answer from the vault this machine already holds: one pull at startup, no
// server round-trip per call. The pull is where the key is used, so a broker
// that is down or locked cannot stop it.
async function serveLocalVault() {
  let pulled
  try {
    pulled = await pull({ since: 0 })
  } catch (error) {
    log('cannot use the local vault:', String(error?.message ?? error))
    return 1
  }
  const server = createLocalServer({ vault: pulled.items, revision: pulled.revision })
  log('local vault:', server.items.length, 'items, revision =', pulled.revision)

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let chain = Promise.resolve()
  rl.on('line', (line) => {
    if (!line.trim()) return
    chain = chain.then(() => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        log('client sent invalid JSON')
        return
      }
      const response = server.handle(message)
      if (response.body) process.stdout.write(response.body + '\n')
    }).catch((error) => log('line error:', String(error?.message ?? error)))
  })
  rl.on('close', () => chain.finally(() => process.exit(0)))
  return new Promise(() => {})
}

function serve() {
  if (process.argv.includes('--vault')) return serveLocalVault()
  const url = brokerUrl()
  const bridge = createBridge({ brokerUrl: url, staticToken: process.env.BROKER_TOKEN || '' })
  log('bridge ready; broker =', url, '; token store =', describe().store)

  const write = (value) => process.stdout.write(JSON.stringify(value) + '\n')

  const handleLine = async (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      log('client sent invalid JSON')
      return
    }
    if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return
    if (message.method === 'ping') {
      if (message.id !== undefined) write({ jsonrpc: '2.0', id: message.id, result: {} })
      return
    }
    try {
      const text = await bridge.request(message)
      if (!text) {
        if (message.id !== undefined) write({ jsonrpc: '2.0', id: message.id, result: {} })
        return
      }
      // The remote response normally carries the client's id. A transport-level
      // refusal (401, 429, a plain error body) does not, and forwarding it
      // verbatim leaves the client waiting for an id that never arrives.
      let body = null
      try { body = JSON.parse(text) } catch {}
      if (body && body.jsonrpc && body.id !== undefined) {
        process.stdout.write(text.endsWith('\n') ? text : text + '\n')
        return
      }
      if (message.id !== undefined) {
        const error = body?.error && typeof body.error === 'object'
          ? { code: Number(body.error.code) || -32000, message: String(body.error.message ?? 'broker refused the request') }
          : { code: -32000, message: String(body?.error ?? text).slice(0, 200) }
        write({ jsonrpc: '2.0', id: message.id, error })
      }
    } catch (error) {
      const detail = String(error?.message ?? error)
      log('request failed:', detail)
      if (message.id !== undefined) write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: detail } })
    }
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let chain = Promise.resolve()
  rl.on('line', (line) => {
    if (!line.trim()) return
    chain = chain.then(() => handleLine(line)).catch((error) => log('line error:', String(error?.message ?? error)))
  })
  rl.on('close', () => {
    chain.finally(() => process.exit(0))
  })
  return new Promise(() => {})
}

// npm link / pnpm use a junction, so argv[1] and import.meta.url name the same
// file through different paths; compare the resolved files instead.
const invokedDirectly = process.argv[1] && (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
})()
if (invokedDirectly) {
  main()
    .then((code) => {
      // A one-shot command returns here; serve() never resolves. Exiting
      // explicitly matters because the login listener can still be holding
      // the socket it just answered (browsers keep it alive), which
      // otherwise leaves the process running after it printed "logged in".
      process.exit(typeof code === 'number' ? code : 0)
    })
    .catch((error) => {
      log('error:', String(error?.message ?? error))
      process.exit(1)
    })
}

export { main, serve, handleApprovals, status, positionals }
