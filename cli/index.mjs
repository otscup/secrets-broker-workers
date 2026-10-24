#!/usr/bin/env node
/**
 * Secrets Broker local bridge.
 *
 *   npx @otscup/secrets-broker            speak MCP over stdio (for stdio-only clients)
 *   npx @otscup/secrets-broker login      log in now
 *   npx @otscup/secrets-broker status     where is the token kept, is it valid
 *   npx @otscup/secrets-broker logout     forget the token
 *   npx @otscup/secrets-broker materialize <item> --path <file> --key NAME
 *                                        write an approved credential into a file
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
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { log, handleApprovals, openBrowser } from './approval.mjs'
import { createBridge } from './bridge.mjs'
import { login } from './oauth.mjs'
import { runMaterialize } from './materialize.mjs'
import { KeyExistsError } from './write.mjs'
import { clearRecord, describe, loadRecord, loadToken } from './store.mjs'

const DEFAULT_URL = 'https://sb.otscup.com'

export const brokerUrl = () => (process.env.BROKER_URL || DEFAULT_URL).replace(/\/+$/, '')

const help = `secrets-broker - local bridge to a Secrets Broker deployment

Usage
  secrets-broker                 speak MCP over stdio (put this in your client config)
  secrets-broker login           log in through the browser now
  secrets-broker status          show the broker, the token store and its expiry
  secrets-broker logout          forget the stored token
  secrets-broker materialize <item> --path <file> --key NAME
                                 ask, then write an approved credential into a file

Environment
  BROKER_URL          broker base URL (default ${DEFAULT_URL})
  BROKER_TOKEN        static agent token; skips login and token storage
  BROKER_TOKEN_FILE   file fallback for the token cache
  BROKER_TOKEN_STORE  file | keychain
  BROKER_NO_BROWSER=1 print URLs instead of opening a browser

Example client config (Claude Desktop, Codex, any stdio MCP client)
  {
    "mcpServers": {
      "secrets-broker": {
        "command": "npx",
        "args": ["-y", "@otscup/secrets-broker"],
        "env": { "BROKER_URL": "${DEFAULT_URL}" }
      }
    }
  }
`

async function status() {
  const url = brokerUrl()
  const store = describe()
  const record = loadRecord()
  const token = loadToken()
  const lines = [
    `broker: ${url}`,
    `token store: ${store.store}${store.store === 'keychain' ? ` (${store.detail})` : ''}`,
    store.store === 'file' ? `token file: ${store.file}` : null,
    process.env.BROKER_TOKEN ? 'token source: BROKER_TOKEN (static)' : null,
    record?.expiresAt ? `expires: ${new Date(record.expiresAt).toISOString()}${token ? '' : ' (expired)'}` : 'expires: unknown',
    token ? 'status: logged in' : 'status: not logged in',
  ].filter(Boolean)
  process.stdout.write(lines.join('\n') + '\n')
  return token ? 0 : 1
}

async function main() {
  const argv = process.argv.slice(2)
  const command = argv.find((arg) => !arg.startsWith('-')) || 'serve'

  if (argv.includes('--help') || argv.includes('-h') || command === 'help') {
    process.stdout.write(help)
    return 0
  }
  if (argv.includes('--version') || command === 'version') {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    process.stdout.write('secrets-broker ' + pkg.version + '\n')
    return 0
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

  if (command === 'materialize') {
    const name = argv[1] && !argv[1].startsWith('-') ? argv[1] : (argv[2] && !argv[2].startsWith('-') ? argv[2] : '')
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

function serve() {
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

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
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

export { main, serve, handleApprovals, status }
