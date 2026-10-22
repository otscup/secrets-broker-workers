import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const ui = fs.readFileSync('src/ui.js', 'utf8')
const globe = fs.readFileSync('src/globe/index.js', 'utf8')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// M1: the account menu is anchored so it cannot leave the screen
{
  const anchored = ui.includes('.account-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:60')
  const mobile = ui.includes('.account-menu{position:fixed;left:12px;right:12px;top:auto')
  if (anchored && mobile) pass('M1 account menu anchored, fixed on phones')
  else fail('M1', JSON.stringify({ anchored, mobile }))
}
// M2: tables keep a usable width and scroll sideways
{
  const minWidth = ui.includes('.table-wrap table{min-width:520px}')
  const phone = ui.includes('.table-wrap table{min-width:560px}')
  if (minWidth && phone) pass('M2 tables scroll sideways instead of squashing')
  else fail('M2', JSON.stringify({ minWidth, phone }))
}
// M3: the enlarged globe is a card, not the full viewport
{
  const card = ui.includes('.globe-big{position:fixed;inset:6%')
  if (card) pass('M3 enlarged globe is a card (inset 6%)')
  else fail('M3', 'still full screen')
}
// M4: the sphere renders about 12% bigger than it used to
{
  const cam = /camera\.position\.set\(([^)]*)\)/.exec(globe)
  const pos = cam ? cam[1].split(',').map((v) => Number(v.trim())) : [0, 90, 320]
  const dist = Math.hypot(pos[0], pos[1], pos[2])
  const fov = 42 * Math.PI / 180
  const pct = (2 * 100 / (2 * Math.tan(fov / 2) * dist)) * 100
  const prev = (2 * 100 / (2 * Math.tan(fov / 2) * Math.hypot(0, 106, 380))) * 100
  const smaller = ((pct - prev) / prev) * 100
  if (smaller >= 10 && smaller <= 15) pass('M4 sphere is ' + smaller.toFixed(1) + '% bigger')
  else fail('M4', 'reduction=' + smaller.toFixed(1) + '%')
}
// M5: phone layout measured in a real browser
{
  const css = /<style>([\s\S]*?)<\/style>/.exec(ui)[1]
  const rows = Array.from({ length: 5 }, (_, i) => '<tr><td><b>agent-' + i + '</b></td><td class="hint">最近 3 分钟有活动 · 长期</td><td>正常</td><td><button>延长</button></td></tr>').join('')
  const page = [
    '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>',
    '<div class="wrap"><div class="card"><div id="agents-box" class="table-wrap"><table><tr><th>Agent</th><th>最近活动</th><th>状态</th><th>操作</th></tr>' + rows + '</table></div></div></div>',
    '<pre id="M"></pre><script>',
    'var b=document.querySelector("#agents-box"),t=b.querySelector("table");',
    'document.getElementById("M").textContent=JSON.stringify({canScroll:b.scrollWidth>b.clientWidth,tableW:Math.round(t.getBoundingClientRect().width),boxW:b.clientWidth});',
    '</script></body></html>',
  ].join(String.fromCharCode(10))
  const file = path.join(os.tmpdir(), 'dsh-mobile-test.html')
  fs.writeFileSync(file, page, 'utf8')
  const url = 'file:///' + file.replace(/\\/g, '/')
  const out = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--virtual-time-budget=4000','--window-size=390,844','--dump-dom', url], { encoding: 'utf8', maxBuffer: 67108864 })
  const m = /<pre id="M">([\s\S]*?)<\/pre>/.exec(String(out.stdout || ''))
  if (!m) fail('M5', 'no browser output')
  else {
    const d = JSON.parse(m[1])
    if (d.canScroll && d.tableW > d.boxW) pass('M5 phone: agents table scrolls sideways (' + d.tableW + ' > ' + d.boxW + ')')
    else fail('M5', JSON.stringify(d))
  }
}
const passed = results.filter((r) => r.ok).length
console.log('\n==== mobile + globe ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)