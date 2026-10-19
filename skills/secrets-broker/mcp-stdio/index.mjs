#!/usr/bin/env node
/**
 * Secrets Broker stdio MCP bridge.
 *
 * Gives stdio-only MCP clients (Codex, older Hermes, custom agents) access to the
 * remote Secrets Broker MCP endpoint, including browser OAuth 2.1 login.
 *
 * Usage:
 *   BROKER_URL=https://sb.otscup.com node mcp-stdio/index.mjs
 *
 * Optional:
 *   BROKER_TOKEN=<static agent token>   skip OAuth
 *   BROKER_TOKEN_FILE=<path>            token cache (default ~/.secrets-broker/oauth.json)
 *   BROKER_NO_BROWSER=1                 print the URL without opening a browser
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const BROKER_URL = (process.env.BROKER_URL || 'https://sb.otscup.com').replace(/\/$/, '')
const TOKEN_FILE = process.env.BROKER_TOKEN_FILE || path.join(os.homedir(), '.secrets-broker', 'oauth.json')
const STATIC_TOKEN = process.env.BROKER_TOKEN || ''
const NO_BROWSER = process.env.BROKER_NO_BROWSER === '1'

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const log = (...args) => process.stderr.write('[secrets-broker] ' + args.join(' ') + '\n')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function loadToken() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
    if (parsed.access_token && (!parsed.expiresAt || parsed.expiresAt > Date.now() + 60_000)) return parsed.access_token
  } catch {}
  return ''
}

function saveToken(token, expiresIn) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: token, expiresAt: Date.now() + (Number(expiresIn) || 86400) * 1000, broker: BROKER_URL }, null, 2), { mode: 0o600 })
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch {}
  return { response, data, text }
}

function openBrowser(url) {
  if (NO_BROWSER) return
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  } catch (error) { log('could not open browser:', String(error.message ?? error)) }
}

async function oauthLogin() {
  const discovery = await jsonFetch(`${BROKER_URL}/.well-known/oauth-authorization-server`)
  if (!discovery.response.ok || !discovery.data?.authorization_endpoint) throw new Error('OAuth discovery failed')
  const authServer = discovery.data

  let resolveCode
  let rejectCode
  const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname !== '/oauth/callback') { res.writeHead(404); res.end('not found'); return }
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<meta charset="utf-8"><h2>Secrets Broker</h2><p>' + (error ? '授权失败：' + error : '授权完成，可以关闭此页面，回到 Agent。') + '</p>')
    if (error) rejectCode(new Error(error))
    else if (code) resolveCode(code)
    else rejectCode(new Error('missing authorization code'))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`

  try {
    const registration = await jsonFetch(`${BROKER_URL}/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Secrets Broker stdio bridge', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], scope: 'secrets.read' }),
    })
    if (!registration.response.ok || !registration.data?.client_id) throw new Error('OAuth client registration failed')
    const clientId = registration.data.client_id
    const state = b64url(crypto.randomBytes(24))
    const verifier = b64url(crypto.randomBytes(32))
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
    const authUrl = new URL(authServer.authorization_endpoint)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'secrets.read')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('code_challenge', challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    log('OAuth login required. Open this URL:')
    log(authUrl.toString())
    openBrowser(authUrl.toString())

    const timeout = sleep(5 * 60 * 1000).then(() => { throw new Error('OAuth login timed out') })
    const code = await Promise.race([codePromise, timeout])
    const token = await jsonFetch(authServer.token_endpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }),
    })
    if (!token.response.ok || !token.data?.access_token) throw new Error(token.data?.error_description || 'OAuth token exchange failed')
    saveToken(token.data.access_token, token.data.expires_in)
    log('OAuth token saved to', TOKEN_FILE)
    return token.data.access_token
  } finally {
    server.close()
  }
}

let tokenPromise = null
async function getToken() {
  if (STATIC_TOKEN) return STATIC_TOKEN
  const cached = loadToken()
  if (cached) return cached
  if (!tokenPromise) tokenPromise = oauthLogin().catch((error) => { tokenPromise = null; throw error })
  return tokenPromise
}

async function callRemote(message) {
  const token = await getToken()
  const response = await fetch(`${BROKER_URL}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(message),
  })
  const text = await response.text()
  if (response.status === 401) {
    try { fs.unlinkSync(TOKEN_FILE) } catch {}
    tokenPromise = null
    const fresh = await getToken()
    const retry = await fetch(`${BROKER_URL}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${fresh}` },
      body: JSON.stringify(message),
    })
    return { status: retry.status, text: await retry.text() }
  }
  return { status: response.status, text }
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value) + '\n')
}

async function handleLine(line) {
  let message
  try { message = JSON.parse(line) } catch { log('invalid JSON from client'); return }
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return
  if (message.method === 'ping') { if (message.id !== undefined) writeJson({ jsonrpc: '2.0', id: message.id, result: {} }); return }
  try {
    const result = await callRemote(message)
    if (!result.text) { if (message.id !== undefined) writeJson({ jsonrpc: '2.0', id: message.id, result: {} }); return }
    // Forward remote JSON unchanged; it already has the client's id.
    process.stdout.write(result.text.endsWith('\n') ? result.text : result.text + '\n')
  } catch (error) {
    log('remote request failed:', String(error.message ?? error))
    if (message.id !== undefined) writeJson({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(error.message ?? error) } })
  }
}

log('stdio bridge ready; broker =', BROKER_URL)
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
let chain = Promise.resolve()
rl.on('line', (line) => { if (line.trim()) chain = chain.then(() => handleLine(line)).catch((error) => log('line error:', String(error.message ?? error))) })
rl.on('close', () => { chain.finally(() => process.exit(0)) })
