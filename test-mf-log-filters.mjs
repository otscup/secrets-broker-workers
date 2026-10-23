// Log-view filters: three dropdowns, a search box, a count line and a reset
// button, all combining with AND. The interesting failure mode is a curated
// event group that silently stops covering an event, so that is checked by name
// against the real event list rather than by eyeballing the labels.
import { uiHtml } from './src/ui.js'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const script = /<script>([\s\S]*?)<\/script>/.exec(uiHtml)
if (!script) { console.log('FAIL  L0 no inline script'); process.exit(1) }
const code = script[1]

// L1 - the controls exist in the served markup, inside the logs view.
{
  const marks = ['logs-item-filter', 'logs-agent-filter', 'logs-event-filter', 'logs-search', 'logs-count', 'logs-reset']
  const missing = marks.filter((id) => !uiHtml.includes('id="' + id + '"'))
  const inView = /<section id="view-logs"[\s\S]*?id="logs-reset"[\s\S]*?id="logs-box"/.test(uiHtml)
  if (!missing.length && inView) pass('L1 three selects + search + count + reset are in the logs view')
  else fail('L1', 'missing: ' + missing.join(',') + ' inView=' + inView)
}
// L2 - each dropdown offers an "全部" default and is wired to a re-render.
{
  const alls = ['全部条目', '全部 Agent', '全部事件类型']
  const missing = alls.filter((label) => !uiHtml.includes(label))
  const wiring = ["$('logs-item-filter').onchange = renderLogs", "$('logs-agent-filter').onchange = renderLogs", "$('logs-event-filter').onchange = renderLogs", "$('logs-search').oninput = renderLogs", "$('logs-reset').onclick"]
  const unwired = wiring.filter((mark) => !code.includes(mark))
  if (!missing.length && !unwired.length) pass('L2 all four controls default to 全部 and re-render on change')
  else fail('L2', 'missingLabels=' + missing.join(',') + ' unwired=' + unwired.join(','))
}
// L3 - the curated event groups cover every event name the log can contain.
{
  const literal = /const LOG_EVENT_GROUPS = (\[[\s\S]*?\n\])/.exec(code)
  if (!literal) { fail('L3', 'LOG_EVENT_GROUPS not found'); }
  else {
    let groups
    try { groups = new Function('return ' + literal[1])() } catch (e) { groups = null }
    const events = ['secret.read', 'secret.read-deny', 'secret.read-noapproval', 'access.denied',
      'grant.share', 'grant.revoke', 'grant.extend', 'request.create', 'request.approve', 'request.deny', 'request.auto-approve',
      'admin.login', 'admin.login-fail', 'admin.oidc-login', 'admin.origin-mismatch', 'vault.unlock', 'vault.lock',
      'item.create', 'item.update', 'item.delete', 'fill-policy.update', 'use-policy.update', 'plaintext-read-policy.update',
      'ai.ask', 'telegram.reject', 'telegram.auto-on', 'telegram.auto-off',
      'oauth.authorize', 'oauth.token-issue', 'oauth.client-register', 'fill.task.start', 'fill.fill']
    const matchers = (groups || []).filter((group) => !group.red)
    const covers = (group, event) => (group.match || []).some((kind) => (kind.endsWith('.*') ? event.startsWith(kind.slice(0, -1)) : event === kind))
    const uncovered = events.filter((event) => !matchers.some((group) => covers(group, event)))
    const labelled = (groups || []).filter((group) => group.label).length
    if (groups && groups.length === 8 && !uncovered.length && labelled === 8) pass('L3 ' + groups.length + ' labelled groups cover all ' + events.length + ' event names')
    else fail('L3', 'groups=' + (groups ? groups.length : 'none') + ' labelled=' + labelled + ' uncovered=' + uncovered.join(','))
  }
}
// L4 - the risk group reuses RED_LOG_EVENTS instead of a second red list.
{
  const reuses = /if \(group\.red\) return RED_LOG_EVENTS\.has\(event\)/.test(code)
  const declared = /\{ key: 'risk', label: '仅风险事件', red: true/.test(code)
  if (reuses && declared) pass('L4 仅风险事件 is defined by RED_LOG_EVENTS')
  else fail('L4', JSON.stringify({ reuses, declared }))
}
// L5 - every dynamic value interpolated into the markup goes through esc().
// Only runtime identifiers are checked; literals and the red-row style are static.
{
  const start = code.indexOf('function fillLogSelect')
  const end = code.indexOf('async function reveal')
  const region = start >= 0 && end > start ? code.slice(start, end) : ''
  const bad = []
  for (const m of region.matchAll(/' \+\s*([^+']+?)\s*\+\s*'/g)) {
    const expr = m[1].trim()
    if (expr === 'cell' || /^esc\(/.test(expr) || /^[A-Za-z_$.]*\.length$/.test(expr)) continue
    bad.push(expr)
  }
  if (!region) fail('L5', 'filter code region not found')
  else if (!bad.length) pass('L5 every interpolated value in the filter markup is esc()d')
  else fail('L5', 'unescaped: ' + [...new Set(bad)].join(' | '))
}
// L6 - the table keeps its columns, the hidden-scrollbar container and the red rows.
{
  const scroll = /<div id="logs-box" class="table-wrap scroll-list"/.test(uiHtml)
  const cols = ['<th>时间</th>', '<th>描述</th>', '<th>Agent</th>', '<th>条目</th>']
  const missing = cols.filter((col) => !code.includes(col))
  const red = /const red = RED_LOG_EVENTS\.has\(String\(entry\.event \|\| ''\)\)/.test(code)
  if (scroll && !missing.length && red) pass('L6 scroll-list container, 4 columns and red rows preserved')
  else fail('L6', JSON.stringify({ scroll, missing, red }))
}
// L7 - filters AND together and never refetch: the view only reads app.data.
{
  const ands = (code.slice(code.indexOf('function renderLogs'), code.indexOf('async function reveal')).match(/return false/g) || []).length
  const noFetch = !/api\(/.test(code.slice(code.indexOf('function renderLogs'), code.indexOf('async function reveal')))
  if (ands >= 4 && noFetch) pass('L7 filters combine (AND) and re-render from app.data without a refetch')
  else fail('L7', JSON.stringify({ ands, noFetch }))
}
// L8 - the inline script still parses, and the count line has the asked-for shape.
{
  let ok = false
  try { new Function(code); ok = true } catch (e) { console.log('   parse error: ' + String(e.message).slice(0, 100)) }
  const count = code.includes("'显示 ' + shown.length + ' / 共 ' + all.length + ' 条'")
  if (ok && count) pass('L8 inline script parses and the count reads 显示 N / 共 M 条')
  else fail('L8', JSON.stringify({ ok, count }))
}
const passed = results.filter((r) => r.ok).length
console.log('\n==== log filters ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
