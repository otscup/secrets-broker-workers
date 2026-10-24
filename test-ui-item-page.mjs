// Detail-page guard: the item detail used to be the shared #modal dialog, and
// openItemMenu wired #mi-save / #mi-share / #mi-delete into it. Moving that
// form onto the pushed #item-page is exactly the kind of change that leaves the
// ids in place but stops the page from opening, so this drives the real UI in a
// real browser: stub API in, clicks out, assertions on the DOM.
//
// It needs Chrome but no network and no credentials. When Chrome is missing the
// suite reports itself as skipped instead of failing a machine that has none.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { uiHtml } from './src/ui.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const state = {
  agents: [{ name: 'dsh', alias: 'DSH 桌面助手', note: '', allowAll: true, expiresAt: null }],
  policies: {}, grants: [], pending: [], itemGroups: {}, requireClassification: true,
  deniedAttempts: {}, oauthClients: {}, legacyUnbound: [],
  // One grant expiring inside 24h: the 需要你处理 card must surface it. The
  // check read grant.expiresAt with Date.parse, which is NaN on a number, so
  // the row could never appear.
}
state.grants = [{ agent: 'dsh', name: 'tavily-api-key', mode: '24h', createdAt: new Date().toISOString(), expiresAt: Date.now() + 3600e3, reads: 0, maxReads: null, revokedAt: null }]
const items = {
  items: [{
    id: 'item-1', type: 1, name: 'tavily-api-key', url: 'https://tavily.com', folderId: null,
    createdAt: '2026-10-01T00:00:00.000Z', creator: 'vault@example.invalid', username: 'bot', totp: '',
    group: 'ai', expiresAt: null, noApproval: true,
    lastActivityAt: '2026-10-23T20:00:00.000Z', lastActor: 'dsh',
  }],
  completedTransfers: [],
}
const stats = { totalReads: 3, activeAgents: 1, pending: 1, activeGrants: 1, buckets: [], topItems: [], topAgents: [] }

const routes = {
  '/api/me': () => ({ email: 'vault@example.invalid', name: 'Vault', avatarUrl: '', siteName: 'Test', unlocked: true, expiresAt: Date.now() + 3600e3, pending: 1 }),
  '/api/state': () => state,
  '/api/items': () => items,
  '/api/stats': () => stats,
  '/api/settings': () => ({ settings: {}, profile: {} }),
}

// Saving from the detail page used to close #modal, which is hidden while the
// page is open, so the stale page stayed on screen. A5 drives the real button.
const writes = []
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (req.method === 'POST') {
    writes.push(url.pathname)
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end('{"ok":true}')
  }
  const route = routes[url.pathname]
  if (route) {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(route()))
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(uiHtml)
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{}')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port

function findChrome() {
  const candidate = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  return candidate.find((p) => p && fs.existsSync(p))
}

const chrome = findChrome()
if (!chrome) {
  console.log('SKIP  ui item page (no Chrome found; set CHROME_BIN to run it)')
  server.close()
  process.exit(0)
}

const port = 9333 + Math.floor(Math.random() * 200)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ui-profile-'))
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })

let ws
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch {}
    await wait(200)
  }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })

  let nextId = 1
  const pending = new Map()
  const problems = []
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
    if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push(message.params.args.map((a) => a.value ?? a.description).join(' '))
  })
  const send = (method, params = {}) => { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return new Promise((r) => pending.set(id, r)) }
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.result?.exceptionDetails) return undefined
    return result.result?.result?.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: base + '/' })
  await wait(2200)

  // A1 - the list renders rows from /api/items, not an empty shell.
  const rows = await evaluate("document.querySelectorAll('#items-box .ios-row').length")
  rows > 0 ? pass('A1 credentials list renders ' + rows + ' row(s)') : fail('A1', 'rows=' + rows)

  // A2 - clicking a row pushes the detail page and the edit form comes with it.
  await evaluate("document.querySelector('[data-item-menu]').click()")
  await wait(900)
  const opened = await evaluate("document.getElementById('item-page').classList.contains('in')")
  const hasSave = await evaluate("!document.getElementById('item-page').hidden && !!document.getElementById('mi-save')")
  const title = await evaluate("document.getElementById('item-page-title').textContent")
  opened && hasSave ? pass('A2 item page opens with the save form (' + title + ')') : fail('A2', JSON.stringify({ opened, hasSave, title }))

  // A3 - back pops it and hides the page again.
  await evaluate("document.getElementById('item-page-back').click()")
  await wait(700)
  const closed = await evaluate("document.getElementById('item-page').classList.contains('hidden')")
  closed ? pass('A3 back returns to the list') : fail('A3', 'hidden=' + closed)

  // A4 - the agent dialog still opens from the agents view. The row menu was
  // removed because it duplicated 编辑配置 inside the detail sheet, so the test
  // walks the path a person now walks: row -> detail -> 编辑配置.
  await evaluate("document.querySelector('#nav [data-view=agents]').click()")
  await wait(700)
  await evaluate("document.querySelector('[data-agent-open]').click()")
  await wait(700)
  await evaluate("document.getElementById('ad-edit').click()")
  await wait(700)
  const modal = await evaluate("!document.getElementById('modal').classList.contains('hidden')")
  const copy = await evaluate("!!document.getElementById('ma-copy')")
  const rotate = await evaluate("!!document.getElementById('ma-rotate')")
  modal && copy && rotate ? pass('A4 agent dialog opens with token actions') : fail('A4', JSON.stringify({ modal, copy, rotate }))

  // A5 - saving closes the pushed page instead of the (already hidden) modal.
  await evaluate("document.querySelector('[data-item-menu]').click()")
  await wait(700)
  await evaluate("document.getElementById('item-page-edit').click()")
  await wait(300)
  await evaluate("document.getElementById('mi-save').click()")
  await wait(900)
  const saved = writes.includes('/api/items/update')
  const pageGone = await evaluate("document.getElementById('item-page').classList.contains('in')")
  saved && !pageGone ? pass('A5 save posts and closes the detail page') : fail('A5', JSON.stringify({ saved, pageGone, writes }))

  // A6 - the work queue surfaces a grant that expires inside 24h.
  const workCard = await evaluate("document.getElementById('ov-actions').textContent")
  const expiringRow = /条授权 24 小时内到期/.test(String(workCard))
  expiringRow ? pass('A6 work queue shows the expiring grant') : fail('A6', 'ov-actions=' + JSON.stringify(workCard))

  // A7 - nothing threw while all of that happened.
  problems.length === 0 ? pass('A7 no runtime errors') : fail('A7', problems.slice(0, 3).join(' | '))
} finally {
  try { ws?.close() } catch {}
  child.kill()
  server.close()
  // Chrome keeps a handle on the profile for a moment after the kill; a
  // leftover temp directory is not worth failing an otherwise green run.
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
}

const passed = results.filter((r) => r.ok).length
console.log('\n==== ui item page ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
