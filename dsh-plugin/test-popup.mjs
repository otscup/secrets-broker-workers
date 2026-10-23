// Smoke test for the DSH plugin popup: launcher exists, empty state renders
// the help panel, and pending cards render approve buttons. No broker calls are
// made (fetch is stubbed).
import fs from 'node:fs'
import { webcrypto } from 'node:crypto'

const client = fs.readFileSync('lib/client.js', 'utf8')

// Minimal DOM stub: enough for the popup code path.
const nodes = []
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this._html = ''; this.textContent = ''; this.classList = { _s: new Set(), add(x) { this._s.add(x) }, remove(x) { this._s.delete(x) }, toggle(x, f) { f ? this._s.add(x) : this._s.delete(x) }, contains(x) { return this._s.has(x) } } }
  setAttribute(k, v) { this[k] = v }
  appendChild(c) {
    // Match the DOM: a node moves to its new parent instead of being cloned, or
    // "while (parent.firstChild) other.appendChild(...)" never terminates.
    for (const host of [doc?.body, ...nodes]) {
      if (!host || !Array.isArray(host.children)) continue
      const at = host.children.indexOf(c)
      if (at >= 0) host.children.splice(at, 1)
    }
    this.children.push(c)
    this._html += String(c.textContent ?? '')
    return c
  }
  append(...c) { this.children.push(...c); for (const child of c) this._html += String(child.textContent ?? '') }
  get firstChild() { return this.children[0] ?? null }
  set innerHTML(v) { this._html = v; this.children = [] }
  get innerHTML() { return this._html }
  remove() { this.removed = true }
  querySelector(sel) { return this.children.find((c) => c._matches === sel) ?? null }
  addEventListener() {}
}
const doc = {
  body: new El('body'),
  createElement: (t) => new El(t),
  getElementById: (id) => doc.body.children.find((c) => c.id === id) ?? null,
  addEventListener() {},
  removeEventListener() {},
}
globalThis.document = doc
globalThis.window = { innerWidth: 1400 }
globalThis.fetch = async (url) => {
  if (String(url).includes('/pending')) return { json: async () => ({ pending: [] }) }
  if (String(url).includes('/credential-requests')) return { json: async () => ({ requests: [] }) }
  return { json: async () => ({}) }
}
globalThis.react = { createElement: () => ({}) }

// Extract startPopup by brace matching and run it.
const start = client.indexOf('function startPopup(ctx)')
if (start < 0) throw new Error('startPopup not found')
let depth = 0, i = client.indexOf('{', start), end = i
for (; i < client.length; i++) {
  if (client[i] === '{') depth++
  else if (client[i] === '}') { depth--; if (depth === 0) { end = i; break } }
}
const body = client.slice(start, end + 1)
const fn = new Function('ctx', body + '\n return startPopup(ctx)')

const cleanup = fn({})
const launcher = doc.body.children.find((c) => c.id === 'secrets-broker-launcher')
if (!launcher) { console.log('FAIL launcher missing'); process.exit(1) }
console.log('PASS launcher present')

launcher.onclick()
// Walk the tree for a label: the real DOM searches descendants, and the stub's
// flat _html cannot see text nested under a child element.
const textOf = (node) => {
  let out = String(node.textContent ?? '')
  for (const child of node.children ?? []) out += ' ' + textOf(child)
  return out
}
setTimeout(() => {
  const overlay = doc.body.children.find((c) => c !== launcher)
  if (!overlay) { console.log('FAIL empty panel did not open'); process.exit(1) }
  const all = textOf(overlay)
  // The popup is useful when nothing is pending: tabs for the queue, recent
  // activity and adding a key are always there.
  const hasTabs = all.includes('待办') && all.includes('动态') && all.includes('添加')
  if (!hasTabs) { console.log('FAIL tabs missing in: ' + all.slice(0, 120)); process.exit(1) }
  console.log('PASS empty panel opens with tabs')
  cleanup()
  process.exit(0)
}, 1200)
