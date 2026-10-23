// The overview carries one global search box that groups Agent / 密钥 / 授权 /
// 待审批 / 日志 / 被拦下的请求 hits and jumps to the page that owns each one.
// These checks pin the markup, the sources it reads, escaping and the fact that
// the inline script still parses: a broken inline script freezes the whole page.
import { uiHtml } from './src/ui.js'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const script = /<script>([\s\S]*?)<\/script>/.exec(uiHtml)
const body = script ? script[1] : ''

// G1: the box lives on the overview, in the same toolbar as the 24h/7d/30d control
{
  const row = /^.*id="range-row".*id="global-search".*$/m.test(uiHtml)
  const inOverview = /<section id="view-overview"[\s\S]*?id="global-search"/.test(uiHtml)
  if (row && inOverview) pass('G1 the search box sits in the overview toolbar beside the range control')
  else fail('G1', JSON.stringify({ row, inOverview }))
}
// G2: it has a placeholder naming the things it searches and a results container
{
  const placeholder = /<input id="global-search"[^>]*placeholder="搜索 Agent、密钥、授权、日志…"/.test(uiHtml)
  const box = uiHtml.includes('id="global-search-results"')
  if (placeholder && box) pass('G2 placeholder and #global-search-results exist')
  else fail('G2', JSON.stringify({ placeholder, box }))
}
// G3: grouped results with a hidden-scrollbar scroll box of about 13 rows
{
  const hiddenBar = /\.gs-box\{[^}]*max-height:400px[^}]*scrollbar-width:none/.test(uiHtml) &&
    /\.gs-box::-webkit-scrollbar\{[^}]*display:none/.test(uiHtml)
  if (hiddenBar) pass('G3 the results list scrolls with a hidden scrollbar at ~13 rows')
  else fail('G3', 'gs-box not scrollable with a hidden bar')
}
// G4: the search function exists and reads every source the request names
{
  const sources = ['app.data.agents', 'app.items', 'app.data.grants', 'app.data.pending', 'app.data.audit', 'app.data.deniedAttempts']
  const hasFn = /function globalSearch\(query\)/.test(body)
  const missing = sources.filter((src) => !new RegExp('function globalSearch\\(query\\)[\\s\\S]*?' + src.replace(/\./g, '\\.')).test(body))
  if (hasFn && missing.length === 0) pass('G4 globalSearch reads all ' + sources.length + ' sources')
  else fail('G4', JSON.stringify({ hasFn, missing }))
}
// G5: every group heading is produced, and each group is capped
{
  const labels = ['Agent', '密钥', '授权', '待审批', '日志', '被拦下的请求']
  const missing = labels.filter((label) => !body.includes("add('" + label + "'"))
  const capped = body.includes('slice(0, Math.min(8, left))') && body.includes('let left = 60')
  if (missing.length === 0 && capped) pass('G5 six groups, 8 rows each, 60 total')
  else fail('G5', JSON.stringify({ missing, capped }))
}
// G6: interpolated values are escaped
{
  const escapes = ['esc(row.title)', 'esc(row.sub)', 'esc(group.label)'].filter((call) => body.includes(call))
  if (escapes.length === 3) pass('G6 result rows are escaped with esc()')
  else fail('G6', 'unescaped: missing ' + ['esc(row.title)', 'esc(row.sub)', 'esc(group.label)'].filter((c) => !body.includes(c)).join(','))
}
// G7: rows are clickable and steer the view; Escape clears the box
{
  const wired = /'global-search-results'\)\.addEventListener\('click'/.test(body) && body.includes('data-goto')
  const escape = /'global-search'\)\.onkeydown = \(event\) => \{ if \(event\.key === 'Escape'\)/.test(body)
  const live = /'global-search'\)\.oninput = renderGlobalSearch/.test(body)
  if (wired && escape && live) pass('G7 live input, click-through and Escape-to-clear are wired')
  else fail('G7', JSON.stringify({ wired, escape, live }))
}
// G7b: a blank query yields nothing. '' includes '' would otherwise match every
// row, so the guard has to live inside the function, not only in the caller.
{
  const fn = (/function globalSearch\(query\) \{([\s\S]*?)\n\}/.exec(body) || [])[1] || ''
  const guard = fn.includes("if (!query) return []") && fn.includes('trim().toLowerCase()')
  if (guard) pass('G7b blank query returns no groups')
  else fail('G7b', 'empty-query guard missing from globalSearch')
}
// G8: the inline script still parses
{
  let ok = false
  try { new Function(body); ok = true } catch (e) { console.log('   parse error: ' + String(e.message).slice(0, 120)) }
  if (ok) pass('G8 inline script parses')
  else fail('G8', 'script parse error')
}
const passed = results.filter((r) => r.ok).length
console.log('\n==== global search ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
