#!/usr/bin/env node
/**
 * Secrets Broker local bridge.
 *
 *   npx @otscup/secrets-broker            speak MCP over stdio (for stdio-only clients)
 *   npx @otscup/secrets-broker login      log in now
 *   npx @otscup/secrets-broker status     where is the token kept, is it valid
 *   npx @otscup/secrets-broker logout     forget the token
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
import { log, handleApprovals } from './approval.mjs'
import { createBridge } from './bridge.mjs'
import { login } from './oauth.mjs'
import { clearRecord, describe, loadRecord, loadToken } from './store.mjs'

const DEFAULT_URL = 'https://sb.otscup.com'

export const brokerUrl = () => (process.env.BROKER_URL || DEFAULT_URL).replace(/\/+$/, '')

const help = `secrets-broker - local bridge to a Secrets Broker deployment

Usage
  secrets-broker                 speak MCP over stdio (put this in your client config)
  secrets-broker login           log in through the browser now
  secrets-broker status          show the broker, the token store and its expiry
  secrets-broker logout          forget the stored token

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
    process.stdout.write('secrets-broker local bridge\n')
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
      // The remote response already carries the client's id.
      process.stdout.write(text.endsWith('\n') ? text : text + '\n')
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
      if (typeof code === 'number' && code !== 0) process.exit(code)
    })
    .catch((error) => {
      log('error:', String(error?.message ?? error))
      process.exit(1)
    })
}

export { main, serve, handleApprovals, status }
