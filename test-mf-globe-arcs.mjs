// Every request must draw its own arc, coloured per agent, with country codes
// on the globe. The previous builder de-duplicated by agent+location, so the
// globe showed only a couple of lines.
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const src = fs.readFileSync('src/globe/index.js', 'utf8')
const start = src.indexOf('    setPoints(events, operator, opts) {')
const end = src.indexOf('    setTheme(name) {')
const body = src.slice(start, end)

{
  if (!/byAgent/.test(body)) pass('A1 every event is drawn, none de-duplicated')
  else fail('A1', 'byAgent map still present')
}
{
  if (/size: 0\.16/.test(body)) pass('A2 one small marker per request')
  else fail('A2', 'per-request marker missing')
}
{
  const palette = /const PALETTE = \[/.test(body)
  const perAgent = /agentColor/.test(body) && /colorFor\(ev\.agent\)/.test(body)
  if (palette && perAgent) pass('A3 arcs coloured per agent')
  else fail('A3', JSON.stringify({ palette, perAgent }))
}
{
  const code = /String\(g\.country\)\.toUpperCase\(\)/.test(body)
  const label = /text: cc/.test(body)
  if (code && label) pass('A4 country codes label the globe')
  else fail('A4', JSON.stringify({ code, label }))
}
{
  const onePerEvent = /for \(const \{ ev, g, color \} of located\)/.test(body)
  const opLeg = /startLat: opLat, startLng: opLon, endLat: startLat/.test(body)
  if (onePerEvent && opLeg) pass('A5 one arc per request plus operator leg')
  else fail('A5', JSON.stringify({ onePerEvent, opLeg }))
}
{
  if (/size: 0\.7, color: '#ffd166'/.test(body)) pass('A6 operator marker keeps a distinct colour')
  else fail('A6', 'operator marker colour missing')
}
const passed = results.filter((r) => r.ok).length
console.log('\n==== globe arcs ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)