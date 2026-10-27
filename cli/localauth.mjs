/**
 * Per-agent access to the local daemon.
 *
 * Each agent gets its own random token and its own policy. The token rides in
 * the URL because every MCP client accepts a URL, while header syntax varies.
 * A policy is one of:
 *   ask      every read waits for the approval page
 *   allow    the named items (or all, when the list is empty) are read directly
 *   window   every item is allowed until `until`
 *
 * Only loopback uses this file; it is not a substitute for the remote broker's
 * per-item grants.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBrowser } from './approval.mjs'
import { protectSecret, unprotectSecret } from './store.mjs'

const PORT = 4319
const WINDOW_MS = 15 * 60 * 1000
const dir = () => process.env.BROKER_HOME || path.join(os.homedir(), '.secrets-broker')
const legacyFile = () => path.join(dir(), 'local-agents.json')
export function localFile() {
  return path.join(dir(), 'local-agents.dpapi')
}

let cached = null
let cachedMtime = 0

const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null

function readAll() {
  const file = localFile()
  try {
    const stat = fs.statSync(file)
    if (cached && stat.mtimeMs === cachedMtime) return cached
    const value = object(JSON.parse(unprotectSecret(file)))
    if (value) {
      cached = value
      cachedMtime = stat.mtimeMs
      return value
    }
  } catch {}
  // Migrate the 0.2.12 plaintext file once; keep it if DPAPI cannot be used.
  try {
    const stat = fs.statSync(legacyFile())
    if (cached && stat.mtimeMs === cachedMtime) return cached
    const value = object(JSON.parse(fs.readFileSync(legacyFile(), 'utf8')))
    if (!value) return {}
    if (protectSecret(file, JSON.stringify(value, null, 2))) {
      fs.rmSync(legacyFile(), { force: true })
      const saved = fs.statSync(file)
      cached = value
      cachedMtime = saved.mtimeMs
    }
    return value
  } catch {
    return {}
  }
}

function writeAll(all) {
  const text = JSON.stringify(all, null, 2)
  const file = localFile()
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  if (protectSecret(file, text)) {
    fs.rmSync(legacyFile(), { force: true })
    cachedMtime = fs.statSync(file).mtimeMs
  } else {
    fs.rmSync(file, { force: true })
    fs.writeFileSync(legacyFile(), text, { mode: 0o600 })
    cachedMtime = fs.statSync(legacyFile()).mtimeMs
  }
  cached = all
}

export function readAgent(agent) {
  return readAll()[agent]
}

function blank() {
  return { token: crypto.randomBytes(32).toString('hex'), policy: { mode: 'ask', items: [], until: 0 } }
}

export function ensureAgent(agent) {
  const all = readAll()
  if (!all[agent]?.token) {
    all[agent] = blank()
    writeAll(all)
  }
  return all[agent]
}

export function localUrl(agent, { port = PORT } = {}) {
  const { token } = ensureAgent(agent)
  return `http://127.0.0.1:${port}/mcp?agent=${encodeURIComponent(agent)}&token=${encodeURIComponent(token)}`
}

export function authenticate(url) {
  const agent = String(url.searchParams.get('agent') ?? '')
  const token = String(url.searchParams.get('token') ?? '')
  const row = readAll()[agent]
  if (!row?.token || !token) return null
  const a = Buffer.from(row.token)
  const b = Buffer.from(token)
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? agent : null
}

function granted(row, item, now) {
  const policy = row?.policy ?? {}
  if (policy.mode === 'window' && Number(policy.until) > now) return true
  if (policy.mode === 'allow') {
    const items = Array.isArray(policy.items) ? policy.items : []
    return items.length === 0 || items.includes('*') || items.includes(item)
  }
  return false
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}

/**
 * The approval queue lives in the daemon process. A read waits here while the
 * person decides; the agent sees one normal tool result if allowed, or a JSON-RPC
 * error if denied or timed out.
 */
export function makeGate({ origin = `http://127.0.0.1:${PORT}`, open = openBrowser, timeoutMs = 120000, now = () => Date.now() } = {}) {
  const pending = new Map()
  let base = origin

  function page(id) {
    const row = pending.get(id)
    if (!row) return null
    return `<!doctype html>
<meta charset="utf-8">
<title>Secrets Broker approval</title>
<style>
body{font:16px system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 20px;color:#1d2433}
code{background:#eef1f5;padding:2px 5px;border-radius:4px}
button{font:inherit;margin:6px 8px 0 0;padding:8px 12px;border:1px solid #b9c1cc;background:#fff;border-radius:6px;cursor:pointer}
button.primary{background:#1f6feb;color:#fff;border-color:#1f6feb}
</style>
<h2>Secrets Broker approval</h2>
<p><b>${escapeHtml(row.agent)}</b> wants to run <code>${escapeHtml(row.tool)}</code> for <code>${escapeHtml(row.item || '(no item)')}</code>.</p>
<p>This is a local loopback request. Approval applies only to this machine.</p>
<div>
<button class="primary" data-d="once">Allow once</button>
<button data-d="window">Allow 15 minutes</button>
<button data-d="allow">Always allow this item</button>
<button data-d="deny">Deny</button>
</div>
<p id="out"></p>
<script>
for (const button of document.querySelectorAll('button')) {
  button.onclick = async () => {
    const response = await fetch('/approve/${encodeURIComponent(id)}/decision?decision=' + button.dataset.d, { method: 'POST' })
    const body = await response.json()
    document.getElementById('out').textContent = body.ok ? 'Done. You can close this page.' : (body.error || 'Failed')
    for (const other of document.querySelectorAll('button')) other.disabled = true
  }
}
</script>`
  }

  function decide(id, decision) {
    const row = pending.get(id)
    if (!row) return { ok: false, error: 'this request is no longer waiting' }
    if (!['once', 'allow', 'window', 'deny'].includes(decision)) return { ok: false, error: 'unknown decision' }
    if (row.timer) clearTimeout(row.timer)
    pending.delete(id)
    if (decision === 'once') {
      row.resolve({ ok: true })
    } else if (decision === 'deny') {
      row.resolve({ ok: false, reason: 'denied by the user' })
    } else {
      const all = readAll()
      const current = all[row.agent] ?? blank()
      const items = Array.isArray(current.policy?.items) ? current.policy.items : []
      if (decision === 'allow') {
        current.policy = { mode: 'allow', items: items.includes(row.item) ? items : [...items, row.item] }
      } else if (decision === 'window') {
        current.policy = { mode: 'window', items: [], until: now() + WINDOW_MS }
      } else {
        return { ok: false, error: 'unknown decision' }
      }
      all[row.agent] = current
      writeAll(all)
      row.resolve({ ok: true })
    }
    return { ok: true }
  }

  async function check(agent, message) {
    const tool = String(message?.params?.name ?? '')
    const item = String(message?.params?.arguments?.name ?? '')
    if (tool === 'put_secret') return { ok: false, reason: 'a paired device reads; writes go through the remote broker' }
    if (tool !== 'get_secret' && tool !== 'get_credential') return { ok: true }
    const row = readAll()[agent]
    if (granted(row, item, now())) return { ok: true }

    const id = crypto.randomUUID()
    const url = `${base}/approve/${encodeURIComponent(id)}`
    let timer = null
    const answer = await new Promise((resolve) => {
      timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, reason: 'approval timed out', approvalUrl: url })
      }, timeoutMs)
      pending.set(id, { id, agent, tool, item, url, createdAt: now(), resolve, timer })
      try {
        open(url)
      } catch {
        // The pending list still carries the URL for a desktop notification.
      }
    })
    return answer
  }

  return {
    setOrigin(value) { base = value },
    pending: () => [...pending.values()].map(({ id, agent, tool, item, url, createdAt }) => ({ id, agent, tool, item, url, createdAt })),
    page,
    decide,
    check,
  }
}
