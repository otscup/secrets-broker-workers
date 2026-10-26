// dsh-secrets-broker — host half.
// Same-origin routes that proxy the panel to whichever Secrets Broker this
// install talks to. The backend URL and its plugin token live in a small JSON
// file so the settings page can point the plugin at a different broker without
// editing an environment variable and restarting.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const name = 'ui-secrets-broker'
export const inject = ['webServer']

const PREFIX = '/api/secrets-broker'
const DEFAULT_URL = 'https://sb.otscup.com'
const PRESETS = [
  { id: 'prod', label: '正式', url: 'https://sb.otscup.com' },
  { id: 'demo', label: '演示', url: 'https://demo.otscup.com' },
  { id: 'local', label: '本地', url: 'http://127.0.0.1:8787' },
]

const home = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const configFile = () => join(home(), 'secrets-broker', 'dsh-plugin.json')

function readConfig() {
  try { const value = JSON.parse(readFileSync(configFile(), 'utf8')); return value && typeof value === 'object' ? value : {} } catch { return {} }
}

function writeConfig(next) {
  const file = configFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 })
}

// The token has three homes, most specific first. The file set through the
// settings page wins, so a stale environment variable cannot pin an install to
// the wrong broker.
function pluginToken(config = readConfig()) {
  if (config.token) return String(config.token).trim()
  if (process.env.SECRETS_BROKER_PLUGIN_TOKEN) return process.env.SECRETS_BROKER_PLUGIN_TOKEN.trim()
  const candidates = [
    join(home(), 'secrets-broker', 'dsh-plugin-token.txt'),
    join(homedir(), 'secrets-broker', 'dsh-plugin-token.txt'),
    'E:\\dsh-home\\secrets-broker\\dsh-plugin-token.txt',
  ]
  for (const file of candidates) {
    try { const value = readFileSync(file, 'utf8').trim(); if (value) return value } catch {}
  }
  return ''
}

function brokerUrl(config = readConfig()) {
  return String(config.url || process.env.SECRETS_BROKER_URL || DEFAULT_URL).replace(/\/+$/, '')
}

// Only a URL a browser could reach: no credentials in it, and http only when it
// points at this machine.
function cleanUrl(value) {
  let parsed
  try { parsed = new URL(String(value || '').trim()) } catch { return { error: 'broker url is not a valid URL' } }
  if (parsed.username || parsed.password) return { error: 'broker url must not carry a username or password' }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { error: 'broker url must be http or https' }
  const local = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(parsed.hostname)
  if (parsed.protocol === 'http:' && !local) return { error: 'plain http is only allowed for localhost' }
  return { url: parsed.origin + parsed.pathname.replace(/\/+$/, '') }
}

function tokenHint(token) {
  if (!token) return ''
  return token.length <= 4 ? '****' : '****' + token.slice(-4)
}

async function probe(url, token) {
  const started = Date.now()
  try {
    const response = await fetch(url + '/api/plugin/pending', {
      headers: { 'x-broker-plugin-token': token },
      signal: AbortSignal.timeout(8000),
    })
    const latencyMs = Date.now() - started
    let body = null
    try { body = await response.json() } catch {}
    if (response.status === 401) return { ok: false, status: 401, latencyMs, error: 'the broker rejected this token' }
    if (!response.ok) return { ok: false, status: response.status, latencyMs, error: (body && body.error) || 'HTTP ' + response.status }
    return { ok: true, status: response.status, latencyMs, pending: Number(body?.count ?? 0) }
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: String(error?.message || error) }
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

// The plugin token never leaves this process, so the only thing standing between
// a web page and "approve that request" is where the request came from. These
// routes served any caller: a page on another site could POST /decide and hand
// an agent the secret its human was still looking at.
function crossSite(req) {
  if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') return true
  const origin = String(req.headers.origin || '')
  if (!origin) return false
  try { return new URL(origin).host !== String(req.headers.host || '') } catch { return true }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '') || '{}'
  try { return JSON.parse(text) } catch { return {} }
}

async function broker(path, options = {}) {
  const token = pluginToken()
  if (!token) return { ok: false, status: 503, body: { error: 'plugin token not configured' } }
  const response = await fetch(brokerUrl() + path, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-broker-plugin-token': token, ...(options.headers || {}) },
  })
  let body = null
  try { body = await response.json() } catch {}
  return { ok: response.ok, status: response.status, body }
}

// Every route is the same three lines around a different broker path, so they
// are declared once instead of copied eleven times.
const ROUTES = [
  ['pending', 'GET'],
  ['credential-requests', 'GET'],
  ['credential-requests/cancel', 'POST'],
  ['connect/save', 'POST'],
  ['decide', 'POST'],
  ['usage', 'GET'],
  ['wait', 'GET'],
  ['activity', 'GET'],
  ['items', 'GET'],
  ['items/save', 'POST'],
  ['items/delete', 'POST'],
]

async function configRoute(req, res, name) {
  const config = readConfig()
  if (name === 'config' && req.method === 'GET') {
    const token = pluginToken(config)
    return json(res, 200, {
      ok: true,
      url: brokerUrl(config),
      origin: brokerUrl(config) === DEFAULT_URL ? 'default' : (config.url ? 'file' : 'env'),
      tokenSet: Boolean(token),
      tokenHint: tokenHint(token),
      presets: PRESETS,
    })
  }
  if (name === 'config/test' && req.method === 'POST') {
    const body = await readBody(req)
    const checked = cleanUrl(body.url || brokerUrl(config))
    if (checked.error) return json(res, 400, { ok: false, error: checked.error })
    const token = String(body.token || '').trim() || pluginToken(config)
    if (!token) return json(res, 400, { ok: false, error: 'no plugin token to test with' })
    return json(res, 200, { ok: true, url: checked.url, ...(await probe(checked.url, token)) })
  }
  if (name === 'config/save' && req.method === 'POST') {
    const body = await readBody(req)
    const checked = cleanUrl(body.url || brokerUrl(config))
    if (checked.error) return json(res, 400, { ok: false, error: checked.error })
    const next = { ...config, url: checked.url }
    const supplied = String(body.token || '').trim()
    if (supplied) next.token = supplied
    // A save that has never talked to the broker is the one way to end up with a
    // panel that silently shows nothing, so prove the pair before writing it.
    const result = await probe(checked.url, next.token || pluginToken(config))
    if (!result.ok) return json(res, 400, { ok: false, error: result.error || 'the broker did not answer', url: checked.url, status: result.status ?? null })
    writeConfig(next)
    return json(res, 200, { ok: true, url: next.url, latencyMs: result.latencyMs, tokenHint: tokenHint(pluginToken(next)), pending: result.pending ?? 0 })
  }
  return json(res, 404, { ok: false, error: 'unknown config route' })
}

async function relay(req, res, method) {
  if (crossSite(req)) return json(res, 403, { ok: false, error: 'cross-site request refused' })
  if (req.method !== method) return json(res, 405, { ok: false, error: 'method-not-allowed' })
  const url = String(req.url || '')
  const query = url.includes('?') ? url.slice(url.indexOf('?')) : ''
  const options = { method }
  if (method === 'POST') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    options.body = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '') || '{}'
    // A cross-origin form cannot set this without a preflight, which the browser
    // will not grant, so requiring it blocks the form-POST version of a CSRF.
    options.headers = { 'content-type': 'application/json' }
  }
  // The route name is the path after the prefix; the upstream path is the same
  // name, so there is nothing to map.
  const name = url.slice(PREFIX.length + 1).split('?')[0]
  const result = await broker('/api/plugin/' + name + (method === 'GET' ? query : ''), options)
  json(res, result.status, result.body ?? { ok: false })
}

export function apply(ctx) {
  try {
    for (const [path, method] of ROUTES) {
      ctx.effect(() => {
        const dispose = ctx.webServer.register({
          kind: 'exact',
          path: `${PREFIX}/${path}`,
          handler: async (req, res) => {
            try { await relay(req, res, method) } catch (error) { json(res, 502, { ok: false, error: String(error.message ?? error) }) }
          },
        })
        return () => dispose()
      }, `ui-secrets-broker: ${path} route`)
    }
    for (const [path, methods] of [['config', ['GET']], ['config/save', ['POST']], ['config/test', ['POST']]]) {
      ctx.effect(() => {
        const dispose = ctx.webServer.register({
          kind: 'exact',
          path: `${PREFIX}/${path}`,
          handler: async (req, res) => {
            try {
              if (crossSite(req)) return json(res, 403, { ok: false, error: 'cross-site request refused' })
              if (!methods.includes(req.method)) return json(res, 405, { ok: false, error: 'method-not-allowed' })
              await configRoute(req, res, path)
            } catch (error) { json(res, 500, { ok: false, error: String(error.message ?? error) }) }
          },
        })
        return () => dispose()
      }, `ui-secrets-broker: ${path} route`)
    }
  } catch (error) { console.error('[ui-secrets-broker] route registration failed:', error) }
}
