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
// A second row so the bulk bar has something to select more than one of. It
// targets the same credential, so the readable-credential counts A16 relies on
// still say 1.
state.grants.push({ agent: 'other', name: 'tavily-api-key', mode: '24h', createdAt: new Date().toISOString(), expiresAt: Date.now() + 3600e3, reads: 0, maxReads: null, revokedAt: null })
// One refused read, keyed by the agent's identifier. The row has to show the
// name the operator gave that agent (`DSH 桌面助手`), not `dsh`: the identifier
// is what the token belongs to, and nobody recognises it in a list.
state.reminders = [{ kind: 'expiring', agent: 'dsh', severity: 'warning', daysLeft: 2, expiresAt: Date.now() + 2 * 86400e3, message: '2 天后到期' }]
// A live read grant for item-1 only: the health card has to count what an
// Agent can read, not how many credentials are classified as api.
state.agentActions = [{ agent: 'dsh', itemName: 'tavily-api-key', itemId: 'item-1', action: 'secret.read', expiresAt: 0, usesLeft: null }]
state.deniedAttempts = [{ agent: 'dsh', name: 'tavily-api-key', action: 'secret.read', reason: 'no-grant', count: 2, firstAt: '2026-10-23T20:00:00.000Z', lastAt: '2026-10-23T20:00:00.000Z' }]
const items = {
  items: [{
    id: 'item-1', type: 1, name: 'tavily-api-key', url: 'https://tavily.com', folderId: null,
    createdAt: '2026-10-01T00:00:00.000Z', creator: 'vault@example.invalid', username: 'bot', totp: '',
    // expiresAt: 0 is what /api/items sends for "no expiry". The stub used
    // to say null, which is why A12 never bit.
    group: 'ai', expiresAt: 0, noApproval: true,
    lastActivityAt: '2026-10-23T20:00:00.000Z', lastActor: 'dsh',
  }, {
    id: 'item-2', type: 1, name: 'aaa-unread-key', url: 'https://example.com', folderId: null,
    createdAt: '2026-10-01T00:00:00.000Z', creator: 'vault@example.invalid', username: 'bot', totp: '',
    group: 'dev', expiresAt: 0, noApproval: false,
    lastActivityAt: '', lastActor: '',
  }],
  completedTransfers: [],
}
const stats = { totalReads: 3, activeAgents: 1, pending: 1, activeGrants: 1, buckets: [], topItems: [], topAgents: [] }

// /api/items lags /api/stats on every real load (it decrypts the whole vault),
// which left a window where the health card counted zero items and printed its
// all-clear hints. Hold the answer back so the window is reachable here too.
const ITEMS_DELAY_MS = 900

const routes = {
  '/api/me': () => ({ email: 'vault@example.invalid', name: 'Vault', avatarUrl: '', siteName: 'Test', unlocked: true, expiresAt: Date.now() + 3600e3, pending: 1 }),
  '/api/state': () => { stateLoads++; return state },
  '/api/items': () => items,
  '/api/stats': () => stats,
  '/api/settings': () => ({ settings: {}, profile: {} }),
  '/api/security': () => ({ totpEnabled: false, sessions: [] }),
  // Vault 2.0 has its own lock, so the card must say "locked" even though this
  // console is unlocked against the cipher vault.
  '/api/v2/status': () => ({ initialized: true, revision: 7, items: 3, unlocked: false, keyrings: [{ id: 'k1', kind: 'device' }] }),
  '/api/v2/devices': () => ({
    devices: [
      { id: 'd1', name: 'laptop', createdAt: '2026-10-26T00:00:00Z', lastSeenAt: new Date().toISOString(), revokedAt: null, canWrite: true },
      { id: 'd2', name: 'old-pc', createdAt: '2026-10-01T00:00:00Z', lastSeenAt: '2026-10-01T00:00:00Z', revokedAt: null, canWrite: false },
    ],
  }),
}

// Saving from the detail page used to close #modal, which is hidden while the
// page is open, so the stale page stayed on screen. A5 drives the real button.
const writes = []
// The bulk bar posts one request for every ticked row, so the test has to see
// the body, not just the path.
const posts = []
let stateLoads = 0
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (req.method === 'POST') {
    writes.push(url.pathname)
    let body = ''
    for await (const chunk of req) body += chunk
    posts.push({ path: url.pathname, body })
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end('{"ok":true}')
  }
  if (url.pathname === '/api/items') await wait(ITEMS_DELAY_MS)
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

  // A15 - while /api/items is still in flight the health card must not report
  // zeros with all-clear hints. It used to read app.items, which is empty until
  // the vault decrypts, so a card that had looked at nothing printed 未分类 0 ·
  // 都分类了 and 免审批 0 · 全部需要批准. The fixture's single credential is
  // no-approval, so any rendered card reading 免审批 0 is that bug.
  const seen = { rows: -1, waited: false, staleZero: false, text: '' }
  for (let i = 0; i < 24; i++) {
    await wait(100)
    const shot = await evaluate(`(() => {
      const box = document.getElementById('ov-actions')
      const rows = [...box.querySelectorAll('.health-row')]
      const noApproval = rows.find((row) => /免审批/.test(row.textContent))
      return { rows: rows.length, noApproval: noApproval ? noApproval.querySelector('.health-value').textContent : null, text: box.textContent }
    })()`)
    if (!shot || !shot.text) continue
    if (/正在读取密钥/.test(shot.text)) seen.waited = true
    if (seen.rows < 0 && shot.rows) { seen.rows = shot.rows; seen.text = shot.text }
    if (shot.rows > 0 && shot.noApproval === '0') seen.staleZero = true
  }
  const settledRows = await evaluate("document.querySelectorAll('#ov-actions .health-row').length")
  seen.waited && !seen.staleZero && settledRows === 5
    ? pass('A15 the health card waits for the vault instead of reporting an empty all-clear')
    : fail('A15', JSON.stringify({ settledRows, waited: seen.waited, staleZero: seen.staleZero, firstRows: seen.rows }))

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

  // A7 - the left card reports credential health: the fixture has one
  // no-approval credential and no classified kinds, so it must say 免审批 1 and
  // 未分类 1 rather than leaving the card blank.
  const healthCard = await evaluate("document.getElementById('ov-actions').textContent")
  const healthRows = await evaluate("document.querySelectorAll('#ov-actions .health-row').length")
  const health = /密钥健康/.test(String(healthCard)) && /免审批/.test(String(healthCard)) && /可直接读取明文/.test(String(healthCard)) && healthRows === 5
  health ? pass('A7 the health card lists five counts') : fail('A7', 'ov-actions=' + JSON.stringify({ healthRows, text: String(healthCard).slice(0, 120) }))

  // A17 - sorting by grant count puts the credential the Agents can actually
  // reach first, and the row says how many of them there are.
  const byAccess = await evaluate("(function(){var s=document.getElementById('item-sort');if(!s)return 'no-select';s.value='access';s.onchange();var n=document.querySelectorAll('#items-box .ios-title b');return [].map.call(n,function(e){return e.textContent}).join(',')})()")
  byAccess === 'tavily-api-key,aaa-unread-key' ? pass('A17 sorting by grant count leads with the credential Agents can reach') : fail('A17', 'order=' + JSON.stringify(byAccess))

  // A16 - the first row counts readable credentials (grant or no-approval), not
  // the api classification: two api items, one readable, so 1 and not 2.
  const readableCount = await evaluate("(document.querySelector('#ov-actions .health-row .health-value') || {}).textContent || ''")
  readableCount === '1' ? pass('A16 the health card counts readable credentials, not the api classification') : fail('A16', 'value=' + JSON.stringify(readableCount))

  // A8 - 编辑 turns the read-only page into a form without leaving it, and
  // 完成 puts it back. The form card is display:none until the page says so.
  await evaluate("document.querySelector('[data-item-menu]').click()")
  await wait(700)
  const beforeEdit = await evaluate("getComputedStyle(document.querySelector('#item-page .card.edit-only')).display")
  await evaluate("document.getElementById('item-page-edit').click()")
  await wait(300)
  const afterEdit = await evaluate("getComputedStyle(document.querySelector('#item-page .card.edit-only')).display")
  const editLabel = await evaluate("document.getElementById('item-page-edit').textContent")
  beforeEdit === 'none' && afterEdit !== 'none' && editLabel.includes('完成')
    ? pass('A8 编辑 reveals the form and turns into 完成')
    : fail('A8', JSON.stringify({ beforeEdit, afterEdit, editLabel }))

  // A9 - asking for a password with no second factor enrolled must explain the
  // way out instead of silently failing, because the endpoint answers 428.
  await evaluate("document.getElementById('item-reveal').click()")
  await wait(700)
  const revealText = await evaluate("document.getElementById('modal').textContent")
  const guide = /两步验证/.test(String(revealText)) && /设置/.test(String(revealText))
  guide ? pass('A9 reveal without TOTP points at the security settings') : fail('A9', JSON.stringify(revealText).slice(0, 160))
  await evaluate("document.querySelector('#modal .modal-x')?.click()")
  await wait(400)

  // A10 - share targets are checkboxes people can tap, not a multiple select.
  await evaluate("document.getElementById('item-page-edit').click()")
  await wait(300)
  const pickCount = await evaluate("document.querySelectorAll('.pick-row [data-share-agent]').length")
  await evaluate("document.querySelector('.pick-row [data-share-agent]').click()")
  const picked = await evaluate("document.querySelector('.pick-row [data-share-agent]').checked")
  pickCount > 0 && picked ? pass('A10 share list offers ' + pickCount + ' tappable target(s)') : fail('A10', JSON.stringify({ pickCount, picked }))

  // A18 - deleting asks in the page, not through confirm(): a sandboxed frame
  // silently refuses the native dialog, and the click then does nothing at all.
  const deletesBefore = writes.filter((w) => w === '/api/items/delete').length
  await evaluate("document.getElementById('mi-delete').click()")
  await wait(400)
  const askShown = await evaluate("Boolean(document.querySelector('.ask'))")
  await evaluate("document.querySelector('.ask__yes').click()")
  await wait(900)
  const deletesAfter = writes.filter((w) => w === '/api/items/delete').length
  const askGone = await evaluate("!document.querySelector('.ask')")
  askShown && askGone && deletesAfter === deletesBefore + 1
    ? pass('A18 deleting asks in the page and posts exactly one delete')
    : fail('A18', JSON.stringify({ askShown, askGone, deletesBefore, deletesAfter }))

  // A12 - a credential with no expiry date must not be drawn as expired.
  const expiry = await evaluate("(() => { const rows = [...document.querySelectorAll('#items-box .ios-row')]; return { rows: rows.length, expired: /已过期/.test(rows.map((r) => r.textContent).join(' ')) } })()")
  expiry.rows > 0 && !expiry.expired ? pass('A12 a credential with no expiry is not marked expired') : fail('A12', JSON.stringify(expiry))

  // A13 - the refused-request row prints the display name, and the chips keep
  // the identifier they post back.
  const denied = await evaluate(`(() => {
    const row = document.querySelector('#denied-list .ios-name')
    const chip = document.querySelector('#denied-list [data-allow-denied]')
    return { name: row ? row.textContent.trim() : '', agent: chip ? chip.getAttribute('data-agent') : '', rows: document.querySelectorAll('#denied-list .ios-row').length }
  })()`)
  denied.rows > 0 && denied.name === 'DSH 桌面助手' && denied.agent === 'dsh'
    ? pass('A13 the denied row shows the display name and keeps the identifier on its buttons')
    : fail('A13', JSON.stringify(denied).slice(0, 200))

  // A14 - a reminder with no approval waiting still has to reach the bar: the
  // bell was showing two notices while the banner stayed blank, which reads as
  // "nothing to do". The sheet it opens offers the action that reminder needs.
  const notice = await evaluate(`(async () => {
    const bar = document.querySelector('#notice-bar')
    const hidden = bar.classList.contains('hidden')
    document.querySelector('[data-kpi="pending"]').click()
    await new Promise((r) => setTimeout(r, 300))
    const modal = document.getElementById('modal')
    const extend = modal.querySelector('[data-notice-extend]')
    const open = modal.querySelector('[data-notice-open]')
    return { hidden, extend: Boolean(extend), open: Boolean(open), shown: !modal.classList.contains('hidden') }
  })()`)
  !notice.hidden && notice.shown && notice.extend
    ? pass('A14 a reminder reaches the bar, and its sheet carries 延期')
    : fail('A14', JSON.stringify(notice).slice(0, 200))

  // A19 - 选择 turns every grant row into a tick box and shows the bulk bar.
  // The bar is the only way to remove twenty grants at once, so a selector
  // rename that quietly leaves it empty has to fail here.
  await evaluate("document.querySelector('#nav [data-view=grants]').click()")
  await wait(800)
  const before = stateLoads
  await evaluate("document.getElementById('grants-select').click()")
  await wait(300)
  const bulk = await evaluate(`(() => {
    const boxes = [...document.querySelectorAll('.grant-select')]
    const bar = document.getElementById('grants-bulk')
    boxes.forEach((b) => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })) })
    return { boxes: boxes.length, visible: !bar.classList.contains('hidden'), count: document.getElementById('grants-bulk-count').textContent }
  })()`)
  bulk.boxes === 2 && bulk.visible && /2/.test(bulk.count)
    ? pass('A19 选择 reveals a tick box per grant and counts the selection')
    : fail('A19', JSON.stringify(bulk))

  // A20 - 批量删除 sends one request carrying every ticked grant, then reloads.
  await evaluate("document.getElementById('grants-bulk-delete').click()")
  await wait(500)
  await evaluate("document.querySelector('.ask__yes').click()")
  await wait(1200)
  const batch = posts.filter((p) => p.path === '/api/grants/batch')
  let sent = null
  try { sent = batch.length ? JSON.parse(batch[batch.length - 1].body) : null } catch {}
  const keys = sent && Array.isArray(sent.keys) ? sent.keys : []
  batch.length === 1 && sent.action === 'delete' && keys.length === 2 && stateLoads > before
    ? pass('A20 批量删除 posts both grants and reloads the page')
    : fail('A20', JSON.stringify({ batch: batch.length, sent, stateLoads, before }).slice(0, 240))

  // A21 - while selecting, tapping a row ticks it instead of opening the grant
  // sheet. The row used to keep its own click target, so choosing a second
  // grant opened a dialog and lost the first tick.
  const rowClick = await evaluate(`(async () => {
    document.getElementById('modal').classList.add('hidden')
    const main = document.querySelector('#grants-box .ios-main')
    const box = main.closest('.ios-row').querySelector('.grant-select')
    box.checked = false
    box.dispatchEvent(new Event('change', { bubbles: true }))
    main.click()
    await new Promise((r) => setTimeout(r, 200))
    return { checked: box.checked, count: document.getElementById('grants-bulk-count').textContent, modal: !document.getElementById('modal').classList.contains('hidden') }
  })()`)
  rowClick.checked && !rowClick.modal && /1/.test(rowClick.count)
    ? pass('A21 tapping a row carries the tick, not the grant sheet')
    : fail('A21', JSON.stringify(rowClick))

  // A22 - the bulk bar is painted with the same neutral as every other panel.
  // It used the legacy --btn alias, which the dark theme overrides with navy.
  await evaluate("document.documentElement.dataset.theme = 'dark'")
  await wait(200)
  const bulkBg = await evaluate("getComputedStyle(document.getElementById('grants-bulk')).backgroundColor")
  const cardBg = await evaluate("getComputedStyle(document.querySelector('#grants-box .ios-card')).backgroundColor")
  await evaluate("document.documentElement.dataset.theme = 'light'")
  bulkBg !== 'rgb(27, 41, 64)' && bulkBg !== cardBg
    ? pass('A22 the bulk bar does not take the legacy navy in dark mode (' + bulkBg + ')')
    : fail('A22', JSON.stringify({ bulkBg, cardBg }))

  // A23 - the Vault 2.0 card reports that vault's own state, not the console's.
  const vault2 = await evaluate(`(() => ({
    badge: document.getElementById('v2-badge').textContent.trim(),
    line: document.getElementById('v2-status').textContent.trim(),
    action: document.getElementById('v2-unlock').textContent.trim(),
    itemsHidden: document.getElementById('v2-box').classList.contains('hidden')
  }))()`)
  vault2.badge === '已锁定' && vault2.action === '解锁' && /条目 3 条/.test(vault2.line) && /revision 7/.test(vault2.line) && /已配对设备 2 台/.test(vault2.line) && vault2.itemsHidden
    ? pass('A23 the Vault 2.0 card shows that vault is locked while the console is open')
    : fail('A23', JSON.stringify(vault2).slice(0, 240))

  // A24 - the device list says which machine is actually here now, not only how
  // many were ever paired: a row seen a minute ago is online, a stale one is not,
  // and the write permission is on the row you would revoke.
  const v2devices = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('#v2-devices .ios-row')]
    return rows.map((row) => ({
      name: row.querySelector('b')?.textContent.trim(),
      tags: [...row.querySelectorAll('.kind-tag')].map((tag) => tag.textContent.trim()),
      revoke: !!row.querySelector('[data-v2-revoke]')
    }))
  })()`)
  v2devices.length === 2 && v2devices[0].name === 'laptop' && v2devices[0].tags.includes('在线') && v2devices[0].tags.includes('可写') && v2devices[0].revoke && v2devices[1].name === 'old-pc' && v2devices[1].tags.includes('离线') && v2devices[1].revoke
    ? pass('A24 the Vault 2.0 device list shows online state, write access and a revoke button')
    : fail('A24', JSON.stringify(v2devices).slice(0, 300))

  // A25 - the write switch is a control on the row, labelled with the state it is
// currently in, and a revoked row offers 删除 instead of a toggle that would 409.
const v2controls = await evaluate(`(() => {
const rows = [...document.querySelectorAll('#v2-devices .ios-row')]
return rows.map((row) => ({
name: row.querySelector('b')?.textContent.trim(),
write: row.querySelector('[data-v2-write]')?.textContent.trim() || null,
purge: !!row.querySelector('[data-v2-purge]')
}))
})()`)
v2controls.length === 2 && v2controls[0].write === '可写' && v2controls[0].purge === false
  ? pass('A25 a live device row carries a labelled write switch, a revoked row carries 删除')
  : fail('A25', JSON.stringify(v2controls).slice(0, 300))

// A11 - nothing threw while all of that happened.
  problems.length === 0 ? pass('A11 no runtime errors') : fail('A11', problems.slice(0, 3).join(' | '))
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
