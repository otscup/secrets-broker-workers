// HTML structure guard: a stray closing tag in the admin template silently
// reparents whole sections. A missing </div> put the "浏览器通知" and "MCP 接入"
// cards outside #view-settings, so they rendered on every page at full width;
// a duplicate </section> closed #dashboard early and pushed the grants, logs,
// profile and settings views out of it. Both were invisible to the id-based
// smoke test, because every id still existed.
import { uiHtml } from './src/ui.js'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const VOID = new Set(['input', 'link', 'meta', 'br', 'img', 'hr', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr'])
const body = uiHtml.slice(uiHtml.indexOf('<body'), uiHtml.indexOf('<script>'))
const tokens = []
const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
let match
while ((match = re.exec(body))) {
  const closing = match[1]
  const name = match[2].toLowerCase()
  const attrs = match[3]
  const selfClose = match[4]
  if (!closing && (name === 'script' || name === 'style')) continue
  if (closing) tokens.push({ close: true, name, at: match.index })
  // A void element still carries an id worth locating, it just never nests.
  else tokens.push({ close: false, name, at: match.index, void: Boolean(selfClose) || VOID.has(name), id: (/\bid="([^"]*)"/.exec(attrs) || [])[1] || '' })
}

// `<body>` itself is opened before this slice and closed after the script, so
// it is not part of the balanced check.
const structural = tokens.filter((token) => !token.close && token.void ? false : token.name !== 'body')

// T1: every close matches the element it actually closes.
{
  const stack = []
  const problems = []
  for (const token of structural) {
    if (!token.close) { stack.push(token); continue }
    const top = stack[stack.length - 1]
    if (!top) { problems.push('extra </' + token.name + '>'); continue }
    if (top.name !== token.name) {
      problems.push('</' + token.name + '> closes <' + top.name + (top.id ? '#' + top.id : '') + '>')
      const idx = stack.map((s) => s.name).lastIndexOf(token.name)
      if (idx < 0) continue
      stack.length = idx
      continue
    }
    stack.pop()
  }
  if (problems.length === 0) pass('T1 every closing tag matches its opening tag')
  else fail('T1', problems.join(' | '))
}

// T2: the template ends balanced, with nothing left open.
{
  const depth = []
  for (const token of structural) {
    if (!token.close) { depth.push(token); continue }
    const idx = depth.map((s) => s.name).lastIndexOf(token.name)
    if (idx >= 0) depth.length = idx
  }
  if (depth.length === 0) pass('T2 no element is left unclosed')
  else fail('T2', 'unclosed: ' + depth.map((s) => s.name + (s.id ? '#' + s.id : '')).join(','))
}

// Walk once, recording for every id the ancestor ids that enclose it.
const ancestors = {}
{
  const stack = []
  for (const token of tokens) {
    if (token.close) {
      const idx = stack.map((s) => s.name).lastIndexOf(token.name)
      if (idx >= 0) stack.length = idx
      continue
    }
    if (token.id) ancestors[token.id] = stack.map((s) => s.id).filter(Boolean)
    if (!token.void) stack.push(token)
  }
}

// T3: every dashboard view lives inside #dashboard. A view left outside it
// stays visible whatever page is open, because the nav toggles .view only.
{
  const views = Object.keys(ancestors).filter((id) => id.startsWith('view-'))
  const misplaced = views.filter((id) => !ancestors[id].includes('dashboard'))
  if (views.length >= 7 && misplaced.length === 0) pass('T3 all ' + views.length + ' views sit inside #dashboard')
  else fail('T3', 'found ' + views.length + ' views; outside #dashboard: ' + (misplaced.join(',') || '(none)'))
}

// T4: the settings-only cards must sit inside #view-settings, not the body.
{
  const needed = ['browser-notify-status', 'mcp-url', 'tg-token', 'tpl-ap-title', 'card-notify-channels', 'card-notify-templates']
  const absent = needed.filter((id) => !ancestors[id])
  const misplaced = needed.filter((id) => ancestors[id] && !ancestors[id].includes('view-settings'))
  if (absent.length === 0 && misplaced.length === 0) pass('T4 settings-only cards are inside #view-settings')
  else fail('T4', 'absent: ' + absent.join(',') + ' outside: ' + misplaced.join(','))
}

// T5: the two long notification cards start folded, and each has a toggle.
{
  const needs = [['card-notify-channels', '通知渠道'], ['card-notify-templates', '通知模板']]
  const missing = []
  for (const [id, label] of needs) {
    const at = uiHtml.indexOf('id="' + id + '"')
    if (at < 0) { missing.push(id + ' absent'); continue }
    const open = uiHtml.lastIndexOf('<div', at)
    const tag = uiHtml.slice(open, uiHtml.indexOf('>', open) + 1)
    if (!/class="[^"]*\bcollapsible\b/.test(tag)) missing.push(id + ' not collapsible')
    if (!/class="[^"]*\bcollapsed\b/.test(tag)) missing.push(id + ' not collapsed by default')
    if (!uiHtml.includes('data-collapse="' + id + '"')) missing.push(id + ' has no toggle')
    if (!label) missing.push(id + ' has no label')
  }
  if (missing.length === 0) pass('T5 the notification cards start folded with a toggle')
  else fail('T5', missing.join(' | '))
}

// T6: devices have their own tab, and the list lives there instead of being
// duplicated in the Vault 2.0 card. A second copy would drift silently.
{
  const view = ancestors['view-devices'] || []
  const list = ancestors['v2-devices'] || []
  const needed = ['devices-refresh', 'devices-status', 'devices-msg', 'pair-command']
  const missing = needed.filter((id) => !ancestors[id] || !ancestors[id].includes('view-devices'))
  const ok = uiHtml.includes('data-view="devices"') && view.includes('dashboard') && list.includes('view-devices') && !list.includes('card-vault2') && missing.length === 0
  if (ok) pass('T6 the device list lives in its own dashboard tab')
  else fail('T6', JSON.stringify({ view, list, missing }))
}

const passed = results.filter((r) => r.ok).length
console.log('\n==== html structure ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
