/**
 * The one-time browser login: OAuth 2.1 authorization code with PKCE, loopback
 * redirect. The browser lands on a page on this machine's loopback port, so the
 * code never travels through anything the agent can read.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { log, openBrowser } from './approval.mjs'
import { saveToken } from './store.mjs'

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {}
  return { response, data, text }
}

export async function discover(brokerUrl) {
  const discovery = await jsonFetch(`${brokerUrl}/.well-known/oauth-authorization-server`)
  if (!discovery.response.ok || !discovery.data?.authorization_endpoint) {
    throw new Error(`OAuth discovery failed (${discovery.response.status}) at ${brokerUrl}`)
  }
  if (!discovery.data.token_endpoint) throw new Error('OAuth discovery has no token_endpoint')
  return discovery.data
}

/**
 * Run the login and store the token.
 * @param {string} brokerUrl
 * @param {{timeoutMs?: number, open?: (url: string) => void}} [options]
 * @returns {Promise<{token: string, store: string}>}
 */
export async function login(brokerUrl, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000
  const opener = options.open ?? openBrowser
  const server = await discover(brokerUrl)
  /** @type {{resolve: (code: string) => void, reject: (error: Error) => void}} */
  let settle = { resolve: () => {}, reject: () => {} }

  const codePromise = new Promise((resolve, reject) => {
    settle = { resolve, reject }
  })

  const listener = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname !== '/oauth/callback') {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(
      '<meta charset="utf-8"><title>Secrets Broker</title><h2>Secrets Broker</h2><p>' +
        (error ? '授权失败：' + error : '授权完成，可以关闭此页面，回到 Agent。') +
        '</p>',
    )
    if (error) settle.reject(new Error(error))
    else if (code) settle.resolve(code)
    else settle.reject(new Error('missing authorization code'))
  })

  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolve)
  })
  const port = listener.address().port
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`

  try {
    const registration = await jsonFetch(`${brokerUrl}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Secrets Broker local bridge',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: 'secrets.read',
      }),
    })
    if (!registration.response.ok || !registration.data?.client_id) {
      throw new Error(registration.data?.error_description || `client registration failed (${registration.response.status})`)
    }

    const clientId = registration.data.client_id
    const verifier = b64url(crypto.randomBytes(32))
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
    const authUrl = new URL(server.authorization_endpoint)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'secrets.read')
    authUrl.searchParams.set('state', b64url(crypto.randomBytes(24)))
    authUrl.searchParams.set('code_challenge', challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')

    log('login required; open this URL if no window appeared:')
    log(authUrl.toString())
    opener(authUrl.toString())

    const timeout = sleep(timeoutMs).then(() => {
      throw new Error('login timed out')
    })
    const code = await Promise.race([codePromise, timeout])

    const token = await jsonFetch(server.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }),
    })
    if (!token.response.ok || !token.data?.access_token) {
      throw new Error(token.data?.error_description || `token exchange failed (${token.response.status})`)
    }
    const saved = saveToken(token.data.access_token, token.data.expires_in, brokerUrl)
    return { token: token.data.access_token, store: saved.store }
  } finally {
    try {
      listener.close()
      // close() stops new connections but leaves the one the browser just
      // used open, which keeps this process alive until the tab closes.
      listener.closeAllConnections?.()
    } catch {}
  }
}
