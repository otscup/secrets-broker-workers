// The read-share card must never clip its legend: the legend stays beside the
// ring and scrolls internally when there are many agents.
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const ui = fs.readFileSync('src/ui.js', 'utf8')

// D1: the legend never wraps below the ring
{
  const nowrap = /\.donut-wrap\{[^}]*flex-wrap:nowrap/.test(ui)
  if (nowrap) pass('D1 the legend stays on the same row as the ring')
  else fail('D1', 'donut-wrap can still wrap')
}
// D2: the legend scrolls internally instead of overflowing
{
  const scroll = /\.legend\{[^}]*overflow-y:auto/.test(ui) && /\.legend\{[^}]*scrollbar-width:none/.test(ui)
  if (scroll) pass('D2 the legend scrolls with a hidden scrollbar')
  else fail('D2', 'legend overflow not contained')
}
// D3: two columns are kept so many agents stay compact
{
  const cols = /\.legend\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(ui)
  if (cols) pass('D3 the legend uses two columns')
  else fail('D3', 'legend is not two columns')
}
// D4: the ring keeps its size; the card is not resized
{
  const ring = /\.donut-svg\{[^}]*width:140px;height:140px/.test(ui)
  if (ring) pass('D4 the ring keeps its 140px size')
  else fail('D4', 'ring size changed')
}
// D5: only one .legend rule remains, so the styles cannot fight each other
{
  const count = (ui.match(/^\.legend\{/gm) || []).length
  if (count === 1) pass('D5 a single .legend rule defines the layout')
  else fail('D5', '.legend rules=' + count)
}
const passed = results.filter((r) => r.ok).length
console.log('\n==== donut legend ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)