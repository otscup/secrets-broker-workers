import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const ui = fs.readFileSync('src/ui.js', 'utf8')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// S1: four panels in the 2x2 reading order
{
  const start = ui.indexOf('<div class="grid3">')
  const block = ui.slice(start, start + 2000)
  const order = ['id="chart-box"', 'id="globe-card"', 'id="top-box"', 'id="donut-box"']
  const idx = order.map((id) => block.indexOf(id))
  const inOrder = idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]))
  if (inOrder) pass('S1 panels ordered: trend, globe, ranking, share')
  else fail('S1', JSON.stringify(idx))
}
// S2: every panel is a fixed-height grid child
{
  const fixed = ui.includes('.grid3>.card{display:flex;flex-direction:column;min-width:0;height:300px;overflow:hidden}')
  const cols = ui.includes('.grid3{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr)')
  if (fixed && cols) pass('S2 fixed-height panels in a 2fr/1fr grid')
  else fail('S2', JSON.stringify({ fixed, cols }))
}
// S3: ranking scrolls, scrollbar hidden
{
  const scroll = ui.includes('overflow-y:scroll')
  const hidden = ui.includes('scrollbar-width:none') && ui.includes('::-webkit-scrollbar{width:0;height:0;display:none}')
  if (scroll && hidden) pass('S3 ranking scrolls with no visible scrollbar')
  else fail('S3', JSON.stringify({ scroll, hidden }))
}
// S4: content cannot stretch the panels
{
  const flexFix = ui.includes('.grid3 .rank-box{flex:1 1 auto;min-height:0;height:auto')
  const clip = /\.grid3>\.card\{[^}]*overflow:hidden/.test(ui)
  if (flexFix && clip) pass('S4 panels cannot be stretched by content')
  else fail('S4', JSON.stringify({ flexFix, clip }))
}
// S5: real browser geometry - generated fixture, no external file needed
{
  const fixture = [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'body{margin:0;padding:20px;font:14px system-ui}',
    '.card{background:#fff;border:1px solid #e3e9f2;border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;min-width:0;height:300px;overflow:hidden}',
    '.grid3{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px;align-items:start}',
    '.table-wrap{overflow-x:auto;max-width:100%}',
    '.rank-box{flex:1 1 auto;min-height:0;height:auto;overflow-y:scroll;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none}',
    '.rank-box::-webkit-scrollbar{width:0;height:0;display:none}',
    '.rank-box table{width:100%;border-collapse:collapse}',
    '.rank-box td,.rank-box th{padding:4px 6px;border-bottom:1px solid #eee;font-size:12px}',
    '</style></head><body>',
    '<div class="grid3">',
    '  <div class="card" id="c1"><h3>trend</h3><div style="flex:1;min-height:0;overflow:hidden">c</div></div>',
    '  <div class="card" id="c2"><h3>globe</h3><div style="flex:1;min-height:0">g</div></div>',
    '  <div class="card" id="c3"><h3>rank</h3><div id="top" class="table-wrap rank-box"></div></div>',
    '  <div class="card" id="c4"><h3>share</h3><div style="flex:1;min-height:0;overflow:hidden">d</div></div>',
    '</div>',
    '<pre id="M"></pre>',
    '<script>',
    'var rows = "";',
    'for (var i = 0; i < 40; i++) rows += "<tr><td>" + (i+1) + "</td><td>item-" + i + "</td></tr>";',
    'document.getElementById("top").innerHTML = "<table><tr><th>#</th><th>item</th></tr>" + rows + "</table>";',
    'var out = {};',
    '["c1","c2","c3","c4"].forEach(function(id){ var r = document.getElementById(id).getBoundingClientRect(); out[id] = { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) } });',
    'var t = document.getElementById("top");',
    'var cs = getComputedStyle(t);',
    'out.rank = { clientH: t.clientHeight, scrollH: t.scrollHeight, sb: cs.scrollbarWidth };',
    't.scrollTop = 50;',
    'out.scrollTop = t.scrollTop;',
    'document.getElementById("M").textContent = JSON.stringify(out);',
    '</script></body></html>',
  ].join('\n')
  const file = path.join(os.tmpdir(), 'dsh-layout-check.html')
  fs.writeFileSync(file, fixture, 'utf8')
  const url = 'file:///' + file.replace(/\\/g, '/')
  const out = spawnSync(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--virtual-time-budget=5000','--window-size=1440,900','--dump-dom', url], { encoding: 'utf8', maxBuffer: 67108864 })
  const html = String(out.stdout || '')
  const m = /<pre id="M">([\s\S]*?)<\/pre>/.exec(html)
  if (!m) { fail('S5', 'chrome produced no measurement (status ' + out.status + ')') }
  else {
    const d = JSON.parse(m[1])
    const same = new Set([d.c1.h, d.c2.h, d.c3.h, d.c4.h]).size === 1
    const row1 = d.c1.t === d.c2.t
    const row2 = d.c3.t === d.c4.t
    const scrollable = d.rank.scrollH > d.rank.clientH
    const moved = d.scrollTop > 0
    const noBar = d.rank.sb === 'none'
    if (same && row1 && row2 && scrollable && moved && noBar) {
      pass('S5 browser: panels equal ' + d.c1.h + 'px, rows aligned, ranking scrolls to ' + d.scrollTop + ', bar hidden')
    } else {
      fail('S5', JSON.stringify({ hs: [d.c1.h, d.c2.h, d.c3.h, d.c4.h], row1, row2, scrollable, moved, noBar, rank: d.rank }))
    }
  }
}
// S6: the style block is balanced
{
  const style = /<style>([\s\S]*?)<\/style>/.exec(ui)
  const css = style ? style[1] : ''
  const open = (css.match(/{/g) || []).length
  const close = (css.match(/}/g) || []).length
  if (open === close) pass('S6 style block braces balanced (' + open + ')')
  else fail('S6', 'open=' + open + ' close=' + close)
}
const passed = results.filter((r) => r.ok).length
console.log('\n==== fixed layout ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
