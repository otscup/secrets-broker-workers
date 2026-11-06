/**
 * The stdio <-> remote bridge.
 *
 * The remote /mcp endpoint is a single POST of JSON-RPC, so a stdio client can
 * be served by forwarding one line at a time. Nothing is buffered across
 * requests, which keeps cancellation and concurrency honest.
 */
import { log, handleApprovals, openBrowser } from './approval.mjs'
import { loadToken, clearRecord } from './store.mjs'
import { login } from './oauth.mjs'

// The broker asks that one connection attempt waits at most this long per poll;
// the whole approval window is ten minutes and the client loops for the rest.
const STATUS_WAIT_SECONDS = 30
const CONNECTION_WINDOW_MS = 10 * 60 * 1000
const STATUS_TIMEOUT_MS = (STATUS_WAIT_SECONDS + 15) * 1000
const MIN_RETRY_MS = 250
const MAX_RETRY_MS = 5000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A pending connection arrives as a JSON-RPC result whose text payload says so.
 * Item approvals are a different payload and are recognised by
 * pendingApprovalOf below.
 * @param {string} raw response body
 */
export function pendingConnectionOf(raw) {
  const payload = payloadOf(raw)
  if (payload?.status !== 'pending-connection') return null
  return payload
}

/**
 * An item approval (read, write, plaintext, fill) arrives as pending-approval.
 * request_access keeps its historical `pending` / `request_id` shape for old
 * clients, so both spellings are accepted here. It carries the request id the
 * console approves, so the bridge can wait on /api/pending/status and then
 * replay the original tool call.
 * @param {string} raw response body
 */
export function pendingApprovalOf(raw) {
  const payload = payloadOf(raw)
  if (!payload) return null
  // `pending` alone is used by other tools (materialize reports progress that
  // way), so the legacy branch requires request_access' request_id spelling.
  if (payload.status === 'pending-approval') {
    const requestId = String(payload.requestId ?? '')
    return requestId ? { ...payload, requestId } : null
  }
  if (payload.status === 'pending' && payload.request_id) {
    return { ...payload, requestId: String(payload.request_id) }
  }
  return null
}

function payloadOf(raw) {
  if (!raw) return null
  let envelope
  try { envelope = JSON.parse(raw) } catch { return null }
  const content = envelope?.result?.content?.[0]?.text
  if (typeof content !== 'string') return null
  try { return JSON.parse(content) } catch { return null }
}

// Only a link on the configured broker can be opened: the pending payload comes
// from the network, and a crafted body must not send the operator elsewhere.
function safeApprovalUrl(raw, brokerUrl) {
  if (!raw) return ''
  try {
    const target = new URL(String(raw))
    const broker = new URL(brokerUrl)
    if (target.hostname.toLowerCase() !== broker.hostname.toLowerCase() || target.protocol !== broker.protocol) return ''
    return target.toString()
  } catch {
    return ''
  }
}

function connectionError(state, reasonCode, detail = '') {
  const code = reasonCode || 'connection-pending'
  const error = new Error(`connection ${state}: ${code}${detail ? ' — ' + detail : ''}`)
  error.reasonCode = code
  error.connectionState = state
  return error
}

/**
 * @param {string} brokerUrl
 * @param {object} options
 *   waitForApproval: false turns the long poll off (a caller that wants the
 *   pending answer back immediately). Defaults to waiting.
 */
export function createBridge({ brokerUrl, staticToken = '', onApproval = handleApprovals, opener, waitForConnection = true } = {}) {
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
   * Poll until the operator decides. Returns when the connection is approved;
   * throws with the broker's reasonCode when it was denied, expired, or the
   * ten-minute window ran out. Each request hangs at most STATUS_WAIT_SECONDS,
   * so no single Worker request approaches its duration limit.
   */
  const waitForApproval = async (token, pending, windowEndsAt) => {
    const approvalUrl = safeApprovalUrl(pending.approvalUrl, brokerUrl)
    if (approvalUrl) {
      log('connection approval needed:', approvalUrl)
      try { (opener ?? openBrowser)(approvalUrl) } catch {}
    }
    const retryMs = (value) => Math.min(Math.max(Number(value) || 0, MIN_RETRY_MS), MAX_RETRY_MS)
    let delay = 0
    let last = null
    while (Date.now() < windowEndsAt) {
      if (delay > 0) await sleep(Math.min(delay, Math.max(windowEndsAt - Date.now(), 0)))
      if (Date.now() >= windowEndsAt) break
      let response
      try {
        response = await fetch(`${brokerUrl}/api/connection/status?wait=${STATUS_WAIT_SECONDS}`, {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
          // If the broker is slow or black-holed, fail the poll instead of
          // blocking the stdio client forever; the loop asks again.
          signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
        })
      } catch (error) {
        last = { state: 'pending', reasonCode: 'connection-pending', message: String(error?.message ?? error) }
        delay = MAX_RETRY_MS
        continue
      }
      if (response.status === 401) throw new Error('the broker rejected the token while waiting for connection approval; create a new agent token in the panel')
      const body = await response.json().catch(() => null)
      if (!body) { delay = MAX_RETRY_MS; continue }
      last = body
      if (body.state === 'approved') return body
      if (body.state === 'denied' || body.state === 'expired' || body.state === 'none') {
        throw connectionError(body.state, body.reasonCode, body.message)
      }
      // A broker that returns immediately (no long-poll support) tells us how
      // long to wait before asking again.
      delay = retryMs(body.retryAfterMs ?? pending.retryAfterMs)
    }
    throw connectionError('expired', last?.reasonCode || 'not-decided-in-10m', 'the approval window ended without a decision; ask the operator to approve this device and retry')
  }

  /**
   * Wait on an item approval. /api/pending/status answers "pending" with a
   * retry hint until the row is decided; "decided" means the caller should
   * replay the original tool, because only the replay knows whether the answer
   * is a value or a refusal (and its reason). A denied item is therefore not an
   * error here — the replayed tool returns the broker's own explanation.
   */
  const waitForItemApproval = async (token, pending, windowEndsAt) => {
    const approvalUrl = safeApprovalUrl(pending.approvalUrl, brokerUrl)
    if (approvalUrl) {
      log('item approval needed:', approvalUrl)
      try { (opener ?? openBrowser)(approvalUrl) } catch {}
    }
    const retryMs = (value) => Math.min(Math.max(Number(value) || 0, MIN_RETRY_MS), MAX_RETRY_MS)
    let delay = 0
    while (Date.now() < windowEndsAt) {
      if (delay > 0) await sleep(Math.min(delay, Math.max(windowEndsAt - Date.now(), 0)))
      if (Date.now() >= windowEndsAt) break
      let response
      try {
        response = await fetch(`${brokerUrl}/api/pending/status?wait=${STATUS_WAIT_SECONDS}&id=${encodeURIComponent(String(pending.requestId))}`, {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
        })
      } catch {
        delay = MAX_RETRY_MS
        continue
      }
      if (response.status === 401) throw new Error('the broker rejected the token while waiting for item approval; create a new agent token in the panel')
      const body = await response.json().catch(() => null)
      if (!body) { delay = MAX_RETRY_MS; continue }
      if (body.status === 'decided') return body
      delay = retryMs(body.retryAfterMs ?? pending.retryAfterMs)
    }
    throw new Error('the approval window ended without a decision; ask the operator to approve this request and retry')
  }

  const request = async (message) => {
    const token = await getToken()
    let windowEndsAt = 0
    // A replay happens after the operator approves, so the bound is the number
    // of polling rounds; the wall-clock window is enforced below.
    for (let attempt = 0; attempt < 200; attempt++) {
      let result = await post(token, message)

      // The stored token was revoked, expired, or belongs to another broker:
      // drop it and log in again once, rather than failing every call from here on.
      if (result.status === 401) {
        // A static token cannot be refreshed, so say so instead of opening a
        // browser the operator did not ask for and could not finish.
        if (staticToken) throw new Error('BROKER_TOKEN was rejected by the broker; create a new agent token in the panel')
        log('token rejected by the broker; logging in again')
        clearRecord()
        tokenPromise = null
        result = await post(await getToken(), message)
        if (result.status === 401) throw new Error('the broker refused a freshly issued token; check the agent still exists')
      }

      const pending = waitForConnection ? pendingConnectionOf(result.text) : null
      if (pending) {
        // The first 202 fixes the window; later replays must not stretch it.
        if (!windowEndsAt) {
          const declared = Date.parse(String(pending.waitUntil ?? ''))
          windowEndsAt = Number.isFinite(declared) ? declared : Date.now() + CONNECTION_WINDOW_MS
        }
        await waitForApproval(token, pending, windowEndsAt)
        // Approved: send the original call again so the client gets the answer
        // it was originally waiting for rather than a second round trip.
        continue
      }

      // An item approval (read, write, plaintext, fill) follows the same rule:
      // wait for the console's decision, then replay this exact call. Only the
      // replay knows whether the answer is a value or a refusal.
      const itemPending = waitForConnection ? pendingApprovalOf(result.text) : null
      if (itemPending) {
        if (!windowEndsAt) windowEndsAt = Date.now() + CONNECTION_WINDOW_MS
        await waitForItemApproval(token, itemPending, windowEndsAt)
        continue
      }

      if (result.status >= 400 && !result.text) {
        throw new Error(`broker answered ${result.status}`)
      }
      if (result.text) onApproval(result.text, brokerUrl, opener)
      return result.text
    }
    throw new Error('connection approval ended without a usable answer; call the tool again')
  }

  return { request, getToken }
}
