// dsh-secrets-broker — host half.
// Same-origin routes that proxy pending approvals to the Secrets Broker.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'ui-secrets-broker'
export const inject = ['webServer']

const PREFIX = '/api/secrets-broker'
const BROKER_URL = (process.env.SECRETS_BROKER_URL || 'https://sb.otscup.com').replace(/\/$/, '')

function pluginToken() {
  if (process.env.SECRETS_BROKER_PLUGIN_TOKEN) return process.env.SECRETS_BROKER_PLUGIN_TOKEN.trim()
  const candidates = [
    join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'secrets-broker', 'dsh-plugin-token.txt'),
    join(homedir(), 'secrets-broker', 'dsh-plugin-token.txt'),
    'E:\\dsh-home\\secrets-broker\\dsh-plugin-token.txt',
  ]
  for (const file of candidates) {
    try { const value = readFileSync(file, 'utf8').trim(); if (value) return value } catch {}
  }
  return ''
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

async function broker(path, options = {}) {
  const token = pluginToken()
  if (!token) return { ok: false, status: 503, body: { error: 'plugin token not configured' } }
  const response = await fetch(BROKER_URL + path, {
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
  } catch (error) { console.error('[ui-secrets-broker] route registration failed:', error) }
}
