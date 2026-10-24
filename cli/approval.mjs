/**
 * Human-in-the-loop bits of the local bridge.
 *
 * A pending approval reaches the agent as text containing a signed link. The
 * bridge turns that into something a person can act on: it opens the link in
 * their own browser, where they are already logged in to the console, and the
 * page says exactly which agent wants which item.
 *
 * BROKER_NO_BROWSER=1 keeps everything in the terminal instead.
 */
import { spawn } from 'node:child_process'

const NO_BROWSER = () => process.env.BROKER_NO_BROWSER === '1'

export const log = (...args) => process.stderr.write('[secrets-broker] ' + args.join(' ') + '\n')

export function openBrowser(url) {
  // An explicit opener command makes the behaviour testable and lets someone
  // route the page through their own handler (a different browser profile, a
  // notification daemon, a log file).
  const custom = process.env.BROKER_OPEN_CMD
  if (custom) {
    const args = process.env.BROKER_OPEN_ARGS ? [process.env.BROKER_OPEN_ARGS, url] : [url]
    try {
      spawn(custom, args, { detached: true, stdio: 'ignore' }).unref()
      return true
    } catch (error) {
      log('opener failed:', String(error?.message ?? error))
      return false
    }
  }
  if (NO_BROWSER()) return false
  try {
    const options = { detached: true, stdio: 'ignore' }
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], options).unref()
    else if (process.platform === 'darwin') spawn('open', [url], options).unref()
    else spawn('xdg-open', [url], options).unref()
    return true
  } catch (error) {
    log('could not open browser:', String(error?.message ?? error))
    return false
  }
}

/**
 * Approval links inside a tool result.
 *
 * Only links the broker itself signs are candidates: they carry /approve with
 * an id, decision, expiry and signature. Anything else in the text (a URL the
 * agent is filling into, for example) is left alone.
 * @param {string} text
 * @returns {string[]}
 */
export function approvalUrls(text) {
  if (typeof text !== 'string' || !text) return []
  const found = text.match(/https?:\/\/[^\s"'<>)\]]+/g) || []
  const urls = []
  for (const raw of found) {
    let url
    try {
      url = new URL(raw)
    } catch {
      continue
    }
    if (!url.pathname.endsWith('/approve')) continue
    if (!url.searchParams.get('id') || !url.searchParams.get('sig')) continue
    if (!urls.includes(url.toString())) urls.push(url.toString())
  }
  return urls
}

/**
 * Open every approval link in a result, and tell the human what is waiting.
 * @param {string} text
 * @param {(url: string) => boolean} [opener]
 */
export function handleApprovals(text, opener = openBrowser) {
  const urls = approvalUrls(text)
  for (const url of urls) {
    log('approval needed:', url)
    opener(url)
  }
  return urls
}
