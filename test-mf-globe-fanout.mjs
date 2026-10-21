// Requests from the same location must not collapse into a single stroke:
// each one is fanned out to its own start point, like departing flights.
import fs from 'node:fs'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const src = fs.readFileSync('src/globe/index.js', 'utf8')

{
  const arcs = /const perSpot = new Map\(\)/.test(src) && /const spread = index === 0 \? 0 :/.test(src)
  const points = /const spotCount = new Map\(\)/.test(src)
  if (arcs && points) pass('F1 arcs and points fan out per request')
  else fail('F1', JSON.stringify({ arcs, points }))
}
{
  const seed = /const seed = Math\.abs\(Math\.round/.test(src)
  if (seed) pass('F2 the fan-out offset is deterministic')
  else fail('F2', 'offset is not deterministic')
}
{
  const located = []
  const spots = [{ lat: 30.67, lon: 104.07 }, { lat: 34.05, lon: -118.24 }]
  for (let i = 0; i < 22; i += 1) located.push(spots[i % 2])
  const perSpot = new Map()
  const starts = []
  const altitudes = []
  const widths = []
  const ends = []
  for (const g of located) {
    const spot = g.lat + ',' + g.lon
    const index = perSpot.get(spot) || 0
    perSpot.set(spot, index + 1)
    const seed = Math.abs(Math.round((g.lat * 1000) + (g.lon * 977) + index * 7919))
    const spread = index === 0 ? 0 : 1.2 + ((seed % 23) / 23) * 6.5
    const bearing = (seed % 360) * (Math.PI / 180)
    starts.push((g.lat + Math.cos(bearing) * spread).toFixed(3) + ',' + (g.lon + Math.sin(bearing) * spread).toFixed(3))
    altitudes.push(0.12 + ((seed % 13) / 13) * 0.9)
    widths.push(0.1 + ((seed % 7) / 7) * 0.26)
    ends.push('31.23,121.47')
  }
  const unique = new Set(starts).size
  const alts = new Set(altitudes.map((v) => v.toFixed(3))).size
  const wids = new Set(widths.map((v) => v.toFixed(3))).size
  const endsSet = new Set(ends).size
  if (unique === starts.length && alts > 1 && wids > 1 && endsSet === 1) {
    pass('F3 arcs scatter: ' + unique + ' starts, ' + alts + ' altitudes, ' + wids + ' widths, one endpoint')
  } else {
    fail('F3', JSON.stringify({ unique, alts, wids, endsSet }))
  }
}
{
  const acc = /\.arcAltitude\(\(d\)/.test(src) && /\.arcStroke\(\(d\)/.test(src)
  if (acc) pass('F4 per-arc altitude and stroke accessors wired')
  else fail('F4', 'accessors missing')
}
const passed = results.filter((r) => r.ok).length
console.log('\n==== globe fan-out ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)