/**
 * The stdio <-> remote bridge.
 *
 * The remote /mcp endpoint is a single POST of JSON-RPC, so a stdio client can
 * be served by forwarding one line at a time. Nothing is buffered across
 * requests, which keeps cancellation and concurrency honest.
 */
import { log, handleApprovals } from './approval.mjs'
import { loadToken, clearRecord } from './store.mjs'
import { login } from './oauth.mjs'

export function createBridge({ brokerUrl, staticToken = '', onApproval = handleApprovals, opener } = {}) {
  let tokenPromise = null

  const getToken = async () => {
    if (staticToken) return staticToken
    const cached = loadToken()
    if (cached) return cached
    if (!tokenPromise) {
      tokenPromise = login(brokerUrl, opener ? { open: opener } : {})
        .then((result) => result.token)
        .catch((error) => {
          tokenPromise = null
          throw error
        })
    }
    return tokenPromise
  }

  const post = async (token, message) => {
    const response = await fetch(`${brokerUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(message),
    })
    return { status: response.status, text: await response.text() }
  }

  /**
   * @param {object} message JSON-RPC message from the client
   * @returns {Promise<string>} raw response body, may be ''
   */
  const request = async (message) => {
    const token = await getToken()
    let result = await post(token, message)

    // The stored token was revoked, expired, or belongs to another broker:
    // drop it and log in again once, rather than failing every call from here on.
    if (result.status === 401) {
      log('token rejected by the broker; logging in again')
      clearRecord()
      tokenPromise = null
      result = await post(await getToken(), message)
    }

    if (result.status >= 400 && !result.text) {
      throw new Error(`broker answered ${result.status}`)
    }
    if (result.text) onApproval(result.text)
    return result.text
  }

  return { request, getToken }
}
