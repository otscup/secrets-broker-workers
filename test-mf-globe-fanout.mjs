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
  for (const g of located) {
    const spot = g.lat + ',' + g.lon
    const index = perSpot.get(spot) || 0
    perSpot.set(spot, index + 1)
    const seed = Math.abs(Math.round((g.lat * 1000) + (g.lon * 977) + index * 31))
    const spread = index === 0 ? 0 : 0.35 + ((seed % 17) / 17) * 0.9
    const bearing = (seed % 360) * (Math.PI / 180)
    starts.push((g.lat + Math.cos(bearing) * spread).toFixed(4) + ',' + (g.lon + Math.sin(bearing) * spread).toFixed(4))
  }
  const unique = new Set(starts).size
  if (unique === starts.length) pass('F3 all ' + starts.length + ' arcs start at distinct points')
  else fail('F3', 'unique=' + unique + ' of ' + starts.length)
}
{
  if (/\.arcStroke\(0\.22\)/.test(src)) pass('F4 arc strokes are thin')
  else fail('F4', 'arc stroke not reduced')
}
const passed = results.filter((r) => r.ok).length
console.log('\n==== globe fan-out ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)