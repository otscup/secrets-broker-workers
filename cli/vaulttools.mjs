/**
 * MCP tools answered from the vault this machine already holds.
 *
 * The remote broker curates what an agent may reach, item by item. A paired
 * device holds the whole key instead, so nothing here can be curated by the
 * server — the honest answer is to serve reads only and send writes back to the
 * remote, where a human approves them.
 */
import { scrubSecret } from '../src/redact.js'

const PROTOCOL_VERSION = '2025-06-18'

const TOOLS = [
  {
    name: 'list_secrets',
    title: 'List credentials',
    description: 'Names this vault holds, without any value. Use it before asking for one.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_secret',
    title: 'Read a secret',
    description: 'The secret value for one exact name. Names are case-sensitive.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    annotations: { readOnlyHint: true, openWorldHint: false, sensitiveOutput: true },
  },
  {
    name: 'get_credential',
    title: 'Read a login',
    description: 'Username, password, url and totp of one exact name.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    annotations: { readOnlyHint: true, openWorldHint: false, sensitiveOutput: true },
  },
  {
    name: 'http_request',
    title: 'Call an API with a secret',
    description: 'Send an HTTPS request to the host stored on an API item and inject its secret header. The value is never returned. The target is limited to that host and path.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        url: { type: 'string' },
        method: { type: 'string' },
        headers: { type: 'object' },
        body: { type: 'string' },
        headerName: { type: 'string' },
        authPrefix: { type: 'string' },
      },
      required: ['name', 'url'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'put_secret',
    title: 'Store a credential',
    description: 'Not available on a paired device: the remote broker approves writes.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name'] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
]

const reply = (id, result) => JSON.stringify({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) })

function present(item) {
  return { name: item.name, kind: item.kind, hasTotp: Boolean(item.payload?.totp), url: item.payload?.url ?? '' }
}

// "openai prod" should find "openai-prod": an agent that mistypes should get the
// near miss back instead of "not found".
function closest(wanted, names) {
  const loose = String(wanted).toLowerCase().replace(/[\s_\-.]+/g, '')
  return names.find((name) => name.toLowerCase().replace(/[\s_\-.]+/g, '') === loose) ?? ''
}

const PROXY_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
const PROXY_HEADERS = { authorization: 'Authorization', 'x-api-key': 'X-Api-Key', 'api-key': 'Api-Key', 'x-auth-token': 'X-Auth-Token' }
const BLOCKED_HEADERS = new Set(['host', 'content-length', 'connection', 'cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'proxy-authenticate', 'x-api-key', 'api-key', 'x-auth-token', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'keep-alive', 'expect'])

function privateHost(host) {
  const value = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return value === 'localhost' || value.endsWith('.local') || value === '::1' || value === '::' ||
    /^\d{1,3}(\.\d{1,3}){0,3}$/.test(value) || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value) ||
    value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')
}

// The item's own URL is the target policy: no second allowlist to drift. A web
// login has no API host, so it is deliberately not usable here.
function proxyPolicy(item) {
  if (!item || item.kind !== 'api') return null
  let url
  try { url = new URL(String(item.payload?.url ?? '')) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return { host: url.hostname.toLowerCase().replace(/\.$/, ''), port: url.port || '443', pathname: url.pathname || '/' }
}

function proxyTarget(item, args, policy) {
  let url
  try { url = new URL(String(args.url ?? '')) } catch { return { error: 'invalid url' } }
  if (url.protocol !== 'https:') return { error: 'only https targets are allowed' }
  if (url.username || url.password) return { error: 'userinfo in target url is not allowed' }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (privateHost(host)) return { error: 'private/local targets are not allowed' }
  if (host !== policy.host || (url.port || '443') !== policy.port) return { error: 'target host is not the url stored on this item' }
  const pathname = url.pathname || '/'
  if (!(pathname === policy.pathname || pathname.startsWith(policy.pathname.endsWith('/') ? policy.pathname : policy.pathname + '/'))) {
    return { error: 'target path is outside the url stored on this item' }
  }
  return { url, host, pathname }
}

async function httpRequest(item, args, { fetchImpl, audit = () => {}, agent = '' } = {}) {
  const policy = proxyPolicy(item)
  if (!policy) return text('http_request needs an API item with an https url', true)
  const method = String(args.method ?? 'GET').trim().toUpperCase()
  if (!PROXY_METHODS.has(method)) return text('method is not allowed', true)
  const target = proxyTarget(item, args, policy)
  if (target.error) return text(target.error, true)
  const rawHeaderName = String(args.headerName ?? 'Authorization').trim()
  const headerName = PROXY_HEADERS[rawHeaderName.toLowerCase()]
  if (!headerName) return text('headerName is not allowed (use Authorization, X-Api-Key, Api-Key or X-Auth-Token)', true)
  const authPrefix = String(args.authPrefix ?? 'Bearer ')
  if (authPrefix.length > 32 || /[\r\n]/.test(authPrefix)) return text('invalid authPrefix (max 32 chars, no CR/LF)', true)
  const rawHeaders = args.headers && typeof args.headers === 'object' ? args.headers : {}
  if (Object.keys(rawHeaders).length > 20) return text('too many headers (max 20)', true)
  const headers = Object.create(null)
  for (const [rawKey, rawValue] of Object.entries(rawHeaders)) {
    const key = String(rawKey)
    if (!/^[A-Za-z0-9-]+$/.test(key)) return text('invalid header name: ' + key.slice(0, 64), true)
    if (BLOCKED_HEADERS.has(key.toLowerCase())) continue
    const value = String(rawValue ?? '')
    if (value.length > 4096) return text('header value too long (max 4KB): ' + key.slice(0, 64), true)
    headers[key] = value
  }
  let body = null
  if (args.body != null) {
    body = String(args.body)
    if (body.length > 65536) return text('body too large (max 64KB)', true)
    if (method === 'GET' || method === 'HEAD') return text('GET/HEAD must not include a body', true)
  }
  const secret = String(item.payload?.secret ?? '')
  if (!secret) return text('item has no secret value', true)
  headers[headerName] = authPrefix + secret
  const init = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) }
  if (body != null) init.body = body
  let response
  try {
    response = await fetchImpl(target.url.toString(), init)
  } catch (error) {
    audit({ agent, tool: 'http_request', item: item.name, host: target.host, path: target.pathname.slice(0, 200), result: 'fetch_failed' })
    return text(error?.name === 'TimeoutError' ? 'upstream request timed out (15s)' : 'upstream fetch failed: ' + String(error?.message ?? error).slice(0, 200), true)
  }
  const raw = (await response.text()).slice(0, 8000)
  const bodyOut = scrubSecret(raw, secret, authPrefix)
  audit({ agent, tool: 'http_request', item: item.name, host: target.host, path: target.pathname.slice(0, 200), status: response.status, result: 'completed' })
  return text(JSON.stringify({ status: response.status, ok: response.ok, body: bodyOut }))
}

export function createLocalServer({ vault, revision = 0, fetchImpl = globalThis.fetch, audit = () => {} } = {}) {
  const items = (vault ?? [])
    .filter((item) => item && item.payload && typeof item.payload.name === 'string')
    .map((item) => ({ kind: item.kind === 'web' ? 'web' : 'api', name: item.payload.name, payload: item.payload }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const byName = (name) => items.find((item) => item.name === name) ?? null

  const call = async (name, args = {}, meta = {}) => {
    if (name === 'list_secrets') {
      return text({ revision, count: items.length, items: items.map(present) })
    }
    if (name === 'get_secret' || name === 'get_credential') {
      const wanted = String(args.name ?? '').trim()
      if (!wanted) return text('name is required', true)
      const item = byName(wanted)
      if (!item) {
        const guess = closest(wanted, items.map((entry) => entry.name))
        return text(guess ? `no item named "${wanted}"; did you mean "${guess}"?` : `no item named "${wanted}"; run list_secrets for the names`, true)
      }
      if (name === 'get_secret') return text({ name: item.name, kind: item.kind, value: item.payload.secret ?? '', url: item.payload.url ?? '' })
      return text({ name: item.name, username: item.payload.username ?? '', password: item.payload.secret ?? item.payload.password ?? '', url: item.payload.url ?? '', totp: item.payload.totp ?? '' })
    }
    if (name === 'http_request') {
      const wanted = String(args.name ?? '').trim()
      if (!wanted) return text('name is required', true)
      const item = byName(wanted)
      if (!item) {
        const guess = closest(wanted, items.map((entry) => entry.name))
        return text(guess ? `no item named "${wanted}"; did you mean "${guess}"?` : `no item named "${wanted}"; run list_secrets for the names`, true)
      }
      if (item.kind !== 'api') return text('http_request only works with API items', true)
      return httpRequest(item, args, { fetchImpl, audit, agent: meta.agent })
    }
    if (name === 'put_secret') {
      return text('a paired device reads; writes go through the remote broker, where a human approves them', true)
    }
    return text('unknown tool: ' + name, true)
  }

  return {
    items,
    async handle(message, meta = {}) {
      const id = message?.id ?? null
      const method = String(message?.method ?? '')
      if (method === 'initialize') {
        return { status: 200, body: reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'secrets-broker-local', version: '2.0.0' } }) }
      }
      if (method === 'tools/list') return { status: 200, body: reply(id, { tools: TOOLS }) }
      if (method === 'tools/call') {
        const params = message.params ?? {}
        const result = await call(String(params.name ?? ''), params.arguments ?? {}, meta)
        return { status: 200, body: reply(id, result) }
      }
      if (method.startsWith('notifications/')) return { status: 202, body: '' }
      if (!id) return { status: 202, body: '' }
      return { status: 200, body: rpcError(id, -32601, 'method not found: ' + method) }
    },
  }
}
