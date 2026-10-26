/**
 * A local daemon: pull the vault once, keep it in memory, and answer MCP over
 * HTTP on 127.0.0.1. Agents connect to this instead of each spawning a stdio
 * process that decrypts the vault again on every start.
 *
 * Only loopback may talk to it, and any request carrying an Origin is refused —
 * that is what stops a web page from using your browser to read the daemon.
 */
import { createServer } from 'node:http'
import { createLocalServer } from './vaulttools.mjs'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])
const BODY_LIMIT = 1024 * 1024

export function hostnameOf(hostHeader) {
  const text = String(hostHeader ?? '').trim().toLowerCase()
  if (text.startsWith('[')) return text.slice(1, text.indexOf(']'))
  return text.split(':')[0]
}

export function makeDaemon({ pull, everyMs = 15 * 60 * 1000, now = () => Date.now(), log = () => {} } = {}) {
  if (typeof pull !== 'function') throw new Error('makeDaemon needs a pull function')
  let state = { vault: [], revision: 0, pulledAt: 0, stale: false, error: '' }
  let server = null
  let timer = null

  async function refresh() {
    try {
      const pulled = await pull({ since: state.revision })
      // A pull that came out of the local copy is not fresh, even though it did
      // not throw: say so, or /healthz would claim the vault is current.
      const stale = Boolean(pulled?.stale)
      state = { vault: pulled?.items ?? [], revision: pulled?.revision ?? state.revision, pulledAt: now(), stale, error: stale ? 'local copy from ' + (pulled.stale.savedAt ?? 'unknown') + ': ' + (pulled.stale.reason ?? '') : '' }
    } catch (error) {
      // Keep answering with what we already decrypted; say that it may be old.
      state = { ...state, stale: true, error: String(error?.message ?? error) }
    }
    return state
  }

  // Loopback only, and no browser: a page must not be able to reach this.
  function refuse(request) {
    if (request.headers.origin) return 'cross-origin request refused'
    if (!LOOPBACK.has(hostnameOf(request.headers.host))) return 'not a loopback address'
    return ''
  }

  function send(response, status, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(text)
  }

  async function readBody(request) {
    let size = 0
    const chunks = []
    for await (const chunk of request) {
      size += chunk.length
      if (size > BODY_LIMIT) throw new Error('request body too large')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  async function handle(request, response) {
    const refused = refuse(request)
    if (refused) return send(response, 403, { error: refused })
    if (request.method === 'OPTIONS') return send(response, 403, { error: 'no preflight' })
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return send(response, 200, { ok: true, items: state.vault.length, revision: state.revision, pulledAt: state.pulledAt, stale: state.stale, error: state.error })
    }
    if (request.method === 'POST' && url.pathname === '/mcp') {
      let message
      try {
        message = JSON.parse(await readBody(request))
      } catch (error) {
        return send(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: String(error?.message ?? error) } })
      }
      const answered = createLocalServer({ vault: state.vault, revision: state.revision }).handle(message)
      return send(response, answered.status ?? 200, answered.body ?? '')
    }
    return send(response, 404, { error: 'not found' })
  }

  function listen({ port = 4319, host = '127.0.0.1' } = {}) {
    server = createServer((request, response) => {
      handle(request, response).catch((error) => send(response, 500, { error: String(error?.message ?? error) }))
    })
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.removeListener('error', reject)
        const address = server.address()
        const origin = 'http://' + host + ':' + address.port
        if (everyMs > 0) {
          timer = setInterval(() => { refresh().catch((error) => log('refresh failed: ' + String(error?.message ?? error))) }, everyMs)
          timer.unref?.()
        }
        resolve({ origin, port: address.port })
      })
    })
  }

  function close() {
    if (timer) clearInterval(timer)
    timer = null
    if (!server) return Promise.resolve()
    return new Promise((resolve) => server.close(() => resolve()))
  }

  return { refresh, handle, listen, close, get state() { return state } }
}
