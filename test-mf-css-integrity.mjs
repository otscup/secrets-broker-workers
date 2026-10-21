// CSS integrity guard: a stray brace in the <style> block silently drops every
// rule after it, which is how the agent summary cards stopped laying out in a
// single row for several rounds.
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const src = fs.readFileSync('src/ui.js', 'utf8')
const style = /<style>([\s\S]*?)<\/style>/.exec(src)
if (!style) { fail('C1', 'no style block found'); process.exit(1) }
const css = style[1]
const open = (css.match(/{/g) || []).length
const close = (css.match(/}/g) || []).length
if (open === close) pass('C1 style block braces are balanced (' + open + ')')
else fail('C1', 'open=' + open + ' close=' + close + ' - rules after the stray brace are dropped')
// The styles that were silently dropped must be present in the stylesheet.
const required = [
  '.agent-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))',
  '.grid3 .rank-box{',
  '.legend{',
  '.globe-pause{',
  '.grid3-col{',
]
const missing = required.filter((rule) => !css.includes(rule))
if (missing.length === 0) pass('C2 all key rules are present in the stylesheet')
else fail('C2', 'missing: ' + missing.join(' | '))
// Every rule that matters must come before the end of the stylesheet.
const lastIdx = Math.max(...required.map((rule) => css.indexOf(rule)))
if (lastIdx > 0 && lastIdx < css.length - 10) pass('C3 key rules are not at the truncated tail')
else fail('C3', 'last key rule at ' + lastIdx + ' of ' + css.length)
const passed = results.filter((r) => r.ok).length
console.log('\n==== css integrity ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)