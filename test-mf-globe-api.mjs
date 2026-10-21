// Guard against calling methods three-globe does not implement. A single bogus
// call returns undefined and breaks the whole chained builder, exactly what
// produced the "globe unavailable" error twice (arcLabel*, bumpImageUrl).
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const lib = fs.readFileSync('node_modules/three-globe/dist/three-globe.mjs', 'utf8')
const src = fs.readFileSync('src/globe/index.js', 'utf8')

// Only calls made on the globe instance matter: chained builder lines and
// explicit globe.foo(...) calls.
const chained = [...src.matchAll(/^\s*\.([a-zA-Z][\w]*)\s*\(/gm)].map((m) => m[1])
const direct = [...src.matchAll(/\bglobe\.([a-zA-Z][\w]*)\s*\(/g)].map((m) => m[1])
const apiCalls = [...new Set([...chained, ...direct])]
const missing = apiCalls.filter((name) => !new RegExp('(^|[\\s{,])' + name + '\\s*:').test(lib))
if (missing.length === 0) pass('G1 every globe API call exists in three-globe (' + apiCalls.length + ' checked)')
else fail('G1', 'not in three-globe: ' + missing.join(', '))

for (const badName of ['arcLabel', 'bumpImageUrl']) {
  const used = new RegExp('\\\\.' + badName + '\\s*\\(').test(src)
  if (!used) pass('G2 no .' + badName + '() call')
  else fail('G2', badName + ' still called')
}

{
  const ok = src.includes('labelsData') && src.includes('labelText')
  if (ok) pass('G3 country labels use the labels layer')
  else fail('G3', 'labels layer not used')
}

{
  const ui = fs.readFileSync('src/ui.js', 'utf8')
  const equal = /\.grid2\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(ui)
  const transparent = /\.globe-box\{[^}]*background:transparent/.test(ui)
  const clamp = /#globe-status\{[^}]*overflow-wrap:anywhere/.test(ui)
  if (equal && transparent && clamp) pass('G4 equal columns, transparent globe, clamped text')
  else fail('G4', JSON.stringify({ equal, transparent, clamp }))
}
