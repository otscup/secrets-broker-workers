// The popup's operator actions: a queue card can be cancelled without typing a
// name, a stored key can be deleted by clicking it, and a tab click during a
// load is not swallowed. Fetch is stubbed; nothing reaches the broker.
import fs from 'node:fs'

const client = fs.readFileSync('lib/client.js', 'utf8')
const calls = []
const nodes = []

class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.style = {}; this.dataset = {}; this._html = ''; this.textContent = ''; this.classList = { _s: new Set(), add(x) { this._s.add(x) }, remove(x) { this._s.delete(x) }, toggle(x, f) { f ? this._s.add(x) : this._s.delete(x) }, contains(x) { return this._s.has(x) } } }
  setAttribute(k, v) { this[k] = v }
  appendChild(c) {
    for (const host of [doc?.body, ...nodes, ...this.children]) {
      const at = Array.isArray(host?.children) ? host.children.indexOf(c) : -1
      if (at >= 0) host.children.splice(at, 1)
    }
    this.children.push(c)
    this._html += String(c.textContent ?? '')
    return c
  }
  append(...c) { for (const child of c) this.appendChild(child) }
  replaceChildren(...c) { this.children = []; this._html = ''; for (const child of c) if (child) this.appendChild(child) }
  get firstChild() { return this.children[0] ?? null }
  set innerHTML(v) { this._html = v; this.children = [] }
  get innerHTML() { return this._html }
  // The real DOM searches descendants; the popup asks whether focus is inside.
  contains(node) { if (node === this) return true; return this.children.some((c) => c.contains && c.contains(node)) }
  focus() { doc.activeElement = this }
  remove() { this.removed = true; for (const host of [doc.body, ...nodes]) { const at = host.children.indexOf(this); if (at >= 0) host.children.splice(at, 1) } }
  // Enough of a selector engine for the popup: .class, #id and TAG, descendants only.
  querySelectorAll(selector) {
    const hit = (n) => selector.startsWith('.') ? String(n.className || '').split(/\s+/).includes(selector.slice(1))
      : selector.startsWith('#') ? n.id === selector.slice(1)
      : n.tagName === selector.toUpperCase()
    const found = []
    const walk = (n) => { for (const c of n.children ?? []) { if (hit(c)) found.push(c); walk(c) } }
    walk(this)
    return found
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  addEventListener() {}
}

const doc = {
  body: new El('body'),
  activeElement: null,
  handlers: {},
  createElement: (t) => { const el = new El(t); nodes.push(el); return el },
  getElementById: (id) => doc.body.children.find((c) => c.id === id) ?? null,
  addEventListener(type, fn) { (doc.handlers[type] ||= []).push(fn) },
  removeEventListener(type, fn) { doc.handlers[type] = (doc.handlers[type] || []).filter((f) => f !== fn) },
}
// Dispatch is what lets a test prove the outside-click listener reacts; a
// simple call of every handler is enough for one listener with no options.
doc.dispatch = (type, target, extra) => { for (const fn of doc.handlers[type] || []) fn({ target, ...extra }) }
globalThis.document = doc
globalThis.window = { innerWidth: 1400 }
globalThis.confirm = () => true

const pending = [{ id: 'p1', agent: 'muse', name: 'github-token', createdAt: new Date().toISOString() }]
const requests = [{ id: 'r1', agent: 'codex', name: 'cloudflare-key', description: '需要 Cloudflare API token', createdAt: new Date().toISOString() }]
const items = [{ name: 'tavily-api-key', group: 'search', url: 'https://tavily.com' }, { name: 'github-token', group: '', url: '' }]

globalThis.fetch = async (url, options = {}) => {
  const path = String(url)
  calls.push({ path, method: options.method || 'GET', body: options.body })
  const reply = (body) => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) })
  if (options.method === 'POST') return reply({ ok: true })
  if (path.includes('/credential-requests')) return reply({ requests })
  if (path.includes('/pending')) return reply({ pending })
  if (path.includes('/activity')) return reply({ activity: [] })
  if (path.includes('/items')) return reply({ items })
  return reply({})
}
globalThis.react = { createElement: () => ({}) }

const start = client.indexOf('function startPopup(ctx)')
if (start < 0) throw new Error('startPopup not found')
let depth = 0, i = client.indexOf('{', start), end = i
for (; i < client.length; i++) {
  if (client[i] === '{') depth++
  else if (client[i] === '}') { depth--; if (depth === 0) { end = i; break } }
}
// startPopup injects the shared stylesheet through ensureCss, which lives
// outside the slice; the mock DOM has no <head>, and this suite is about
// behaviour, so the stylesheet is stubbed.
const fn = new Function('ctx', 'const ensureCss = () => {}\n' + client.slice(start, end + 1) + '\n return startPopup(ctx)')

const out = []
const record = (name, ok, detail) => { out.push({ name, ok, detail }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : ' :: ' + detail)) }
const walk = (node, visit) => { visit(node); for (const child of node.children ?? []) walk(child, visit) }
const collect = (root) => { const found = []; walk(root, (n) => found.push(n)); return found }
const findButton = (root, label) => collect(root).find((n) => n.tagName === 'BUTTON' && String(n.textContent ?? n._html) === label)
const findLabelled = (root, label, tag) => collect(root).find((n) => n.tagName === tag && String(n.textContent ?? n._html).includes(label))
// The header close button is also '×', so the delete control is picked by its
// title, which names the item it would remove.
const findDelete = (root) => collect(root).find((n) => n.tagName === 'BUTTON' && String(n.textContent ?? n._html) === '×' && String(n.title ?? '').startsWith('从 vault 删除'))
const panel = () => doc.getElementById('secrets-broker-sheet')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cleanup = fn({})
const launcher = doc.body.children.find((c) => c.id === 'secrets-broker-launcher')
if (!launcher) { console.log('FAIL launcher missing'); process.exit(1) }
launcher.onclick()
await sleep(200)
const overlay = doc.getElementById('secrets-broker-sheet')
if (!overlay) { console.log('FAIL panel did not open'); process.exit(1) }
const backdrop = doc.getElementById('secrets-broker-backdrop')

// C1: the open request can be declined, so the prompt stops coming back.
const skip = findButton(overlay, '取消（不填了）')
record('C1 a pending key request can be cancelled without typing anything', Boolean(skip))

// C2: cancelling calls the broker endpoint with the request id.
if (skip) {
  const before = calls.length
  skip.onclick()
  await sleep(200)
  const cancel = calls.slice(before).find((c) => c.method === 'POST' && c.path.includes('/credential-requests/cancel'))
  const id = cancel ? JSON.parse(cancel.body).id : null
  record('C2 cancelling posts the request id to the broker', Boolean(cancel) && id === 'r1', JSON.stringify({ cancel, id }))
}

// C3: the store tab lists stored keys with a delete control, no name retyping.
const addChip = findButton(overlay, '添加')
if (!addChip) record('C3 the store tab lists stored keys with a delete control', false, 'no 添加 tab')
else {
  addChip.onclick()
  await sleep(300)
  const kill = findDelete(overlay)
  const label = findLabelled(overlay, 'tavily-api-key', 'SPAN')
  record('C3 the store tab lists stored keys with a delete control', Boolean(kill) && Boolean(label), JSON.stringify({ kill: Boolean(kill), label: Boolean(label) }))
}

// C4: deleting from the list posts the item name that was clicked.
if (doc.body.children.includes(overlay)) {
  const kill = findDelete(overlay)
  if (kill) {
    const before = calls.length
    kill.onclick()
    await sleep(200)
    const del = calls.slice(before).find((c) => c.method === 'POST' && c.path.includes('/items/delete'))
    const name = del ? JSON.parse(del.body).name : null
    record('C4 deleting posts the clicked item name', Boolean(del) && name === 'tavily-api-key', JSON.stringify({ del, name }))
  } else record('C4 deleting posts the clicked item name', false, 'no delete button')
}

// C5: a tab click while a load is running still switches the tab. Each load
// fetches five endpoints, so two clicks in the same tick overlap.
{
  const activityChip = findButton(panel(), '动态')
  const queueChip = findButton(panel(), '待办')
  if (!activityChip || !queueChip) record('C5 a tab click during a load is not swallowed', false, 'tabs missing')
  else {
    queueChip.onclick()
    activityChip.onclick()
    await sleep(600)
    const nowOn = findButton(panel(), '动态')
    // The active chip is the one marked aria-selected; the fill is CSS now.
    const active = Boolean(nowOn) && nowOn['aria-selected'] === 'true'
    record('C5 a tab click during a load is not swallowed', active, JSON.stringify(nowOn && nowOn['aria-selected']))
  }
}

// C6: typing in a field still suspends the rerender. The store tab is the one
// with inputs, so switch to it first.
{
  const addChip = findButton(panel(), '添加')
  if (addChip) { addChip.onclick(); await sleep(400) }
  const input = collect(panel()).find((n) => n.tagName === 'INPUT')
  if (!input) record('C6 focus inside an input still suspends the rerender', false, 'no input')
  else {
    input.focus()
    const before = calls.length
    launcher.onclick()   // would reload; must be suppressed by the guard
    await sleep(250)
    record('C6 focus inside an input still suspends the rerender', calls.length === before, String(calls.length - before))
  }
}

// C7: switching tabs paints from the last payload, so it costs no network. This
// is the "20 seconds to switch" report: every tab click used to refetch all five
// endpoints behind a ~1s round trip, and a click during a load was dropped.
{
  // C6 closed the panel with the launcher, so open it again. The second open
  // has a payload cached from the first, which is what C7 measures.
  if (!panel()) { launcher.onclick(); await sleep(400) }
  const addChip = findButton(panel(), '添加')
  const activityChip = findButton(panel(), '动态')
  if (!addChip || !activityChip) record('C7 switching tabs costs no network round trip', false, 'tabs missing')
  else {
    const before = calls.length
    activityChip.onclick()
    await sleep(120)
    const spent = calls.length - before
    // A fresh load fires at most five GETs; a cached paint fires none.
    record('C7 switching tabs costs no network round trip', spent === 0, String(spent) + ' requests')
  }
}

// C8: clicking outside the panel dismisses it, and clicking inside does not.
// One document-level listener does this; it must ignore the panel's own clicks.
{
  if (!panel()) { launcher.onclick(); await sleep(400) }
  const inside = collect(panel())[1] ?? panel()   // a real child, like a tab chip
  doc.dispatch('click', inside)                  // inside: must survive
  await sleep(50)
  const survived = Boolean(panel())
  doc.dispatch('click', new El('div'))            // outside: must close
  await sleep(50)
  record('C8 a click outside closes the panel, a click inside does not', survived && !panel(), JSON.stringify({ survived, closed: !panel() }))
}

// C9: the add tab sends the chosen category and the origins it was given.
{
  if (!panel()) { launcher.onclick(); await sleep(400) }
  const addChip = findButton(panel(), '添加')
  if (addChip) { addChip.onclick(); await sleep(400) }
  const webChip = findButton(panel(), '网站登录')
  if (webChip) { webChip.onclick(); await sleep(300) }
  const fields = collect(panel())
  const originsBox = fields.find((n) => n.tagName === 'TEXTAREA')
  const inputs = fields.filter((n) => n.tagName === 'INPUT')
  const saveButton = findButton(panel(), '保存到 vault')
  if (!webChip || !originsBox || inputs.length < 2 || !saveButton) record('C9 the add tab sends kind and origins', false, JSON.stringify({ webChip: !!webChip, originsBox: !!originsBox, inputs: inputs.length }))
  else {
    inputs[0].value = 'web-login'; inputs[0].oninput?.()
    inputs[2].value = 'pw-123'; inputs[2].oninput?.()
    originsBox.value = 'https://a.example.com\nhttps://b.example.com\n'
    originsBox.oninput?.()
    const before = calls.length
    saveButton.onclick()
    await sleep(200)
    const post = calls.slice(before).find((c) => c.method === 'POST' && c.path.includes('/items/save'))
    const body = post ? JSON.parse(post.body) : {}
    const ok = body.kind === 'web' && Array.isArray(body.origins) && body.origins.length === 2 && body.origins[0] === 'https://a.example.com'
    record('C9 the add tab sends kind and origins', ok, JSON.stringify(body))
  }
}

// C10: the × in the header closes at once. It used to be a const named `close`
// that shadowed the close() function, so the handler called the button itself in
// a loop and dismissal took seconds.
{
  if (!panel()) { launcher.onclick(); await sleep(300) }
  const box = panel()
  const x = box ? collect(box).find((n) => n.tagName === 'BUTTON' && String(n.textContent ?? '') === '×' && !String(n.title ?? '').startsWith('从 vault 删除')) : null
  if (!x) record('C10 the header × closes immediately', false, 'no close button')
  else {
    // Both floating surfaces must go: the sheet and the dimming backdrop.
    const before = Boolean(doc.getElementById('secrets-broker-sheet'))
    x.onclick()
    await sleep(30)
    const sheet = doc.getElementById('secrets-broker-sheet')
    const shade = doc.getElementById('secrets-broker-backdrop')
    record('C10 the header × closes immediately', before && !sheet && !shade, JSON.stringify({ before, sheet: Boolean(sheet), shade: Boolean(shade) }))
  }
}

cleanup()

// C11: with the panel never opened, the poll only needs the two queue endpoints.
// It used to pull all five every 15s — /items decrypts the whole vault — which
// cost ~3.3s of broker work per tick to keep a badge number current.
{
  const before = calls.length
  const stop = fn({})
  await sleep(400)
  const spent = calls.slice(before)
  stop()
  const paths = spent.map((c) => c.path.replace('/api/secrets-broker', ''))
  const ok = spent.length === 2 && !paths.some((p) => p.includes('/items') || p.includes('/usage') || p.includes('/activity'))
  record('C11 a closed panel polls only the badge endpoints', ok, JSON.stringify(paths))
}

const passed = out.filter((r) => r.ok).length
console.log('\n==== popup actions ' + passed + '/' + out.length + ' passed ====')
process.exit(passed === out.length ? 0 : 1)
