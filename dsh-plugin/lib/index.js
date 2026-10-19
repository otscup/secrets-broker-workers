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

export function apply(ctx) {
  try {
    ctx.effect(() => {
      const dispose = ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/pending`,
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
          try {
            const result = await broker('/api/plugin/pending')
            json(res, result.status, result.body ?? { ok: false })
          } catch (error) { json(res, 502, { ok: false, error: String(error.message ?? error) }) }
        },
      })
      return () => dispose()
    }, 'ui-secrets-broker: pending route')
    ctx.effect(() => {
      const dispose = ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/credential-requests`,
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
          try {
            const result = await broker('/api/plugin/credential-requests')
            json(res, result.status, result.body ?? { ok: false })
          } catch (error) { json(res, 502, { ok: false, error: String(error.message ?? error) }) }
        },
      })
      return () => dispose()
    }, 'ui-secrets-broker: credential route')
    ctx.effect(() => {
      const dispose = ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/decide`,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
          try {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '') || '{}')
            const result = await broker('/api/plugin/decide', { method: 'POST', body: JSON.stringify(body) })
            json(res, result.status, result.body ?? { ok: false })
          } catch (error) { json(res, 502, { ok: false, error: String(error.message ?? error) }) }
        },
      })
      return () => dispose()
    }, 'ui-secrets-broker: decide route')
  } catch (error) { console.error('[ui-secrets-broker] route registration failed:', error) }
}
