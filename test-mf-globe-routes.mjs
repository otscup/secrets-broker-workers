// Verify the route builder really produces different interior paths for the
// same endpoint pair, while both endpoints stay exact.
import fs from 'node:fs'

const src = fs.readFileSync('src/globe/index.js', 'utf8')

// Extract buildLegs so it can be exercised directly (it is pure maths).
const startMark = '      const buildLegs = ('
const start = src.indexOf(startMark)
const end = src.indexOf('      const perSpot = new Map()')
if (start < 0 || end < 0) throw new Error('buildLegs not found in source')
const body = src.slice(start, end).trimEnd()
const expression = body.replace(/^\s*const buildLegs =\s*/, '').replace(/;$/, '')
const buildLegs = new Function('return (' + expression + ')')()

const FROM = { lat: 30.67, lon: 104.07 }   // Chengdu
const TO = { lat: 40.71, lon: -74.0 }      // New York

const routes = []
for (let seed = 1; seed <= 40; seed += 1) {
  const hops = seed % 3 === 0 ? 2 : 1
  routes.push({ seed, hops, legs: buildLegs(FROM.lat, FROM.lon, TO.lat, TO.lon, seed, hops) })
}

// 1. Every route starts and ends exactly at the given endpoints.
let endpointErrors = 0
for (const route of routes) {
  const first = route.legs[0]
  const last = route.legs[route.legs.length - 1]
  if (first.fromLat !== FROM.lat || first.fromLng !== FROM.lon) endpointErrors += 1
  if (last.toLat !== TO.lat || last.toLng !== TO.lon) endpointErrors += 1
}
console.log('endpoint errors:', endpointErrors)

// 2. The interior differs: compare the first waypoint of the two-hop routes.
const midpoints = routes.filter((r) => r.hops === 2).map((r) => {
  const mid = r.legs[0]
  return `${mid.toLat.toFixed(2)},${mid.toLng.toFixed(2)}`
})
const uniqueMid = new Set(midpoints)
console.log('two-hop routes:', midpoints.length, 'distinct first waypoints:', uniqueMid.size)
console.log('sample waypoints:', [...uniqueMid].slice(0, 6).join(' | '))

// 3. Lateral spread: waypoints must sit clearly off the direct line, both north
//    and south of it, which is the "via Russia vs via Australia" ask.
const lats = routes.filter((r) => r.hops === 2).map((r) => r.legs[0].toLat)
const directLatAtMid = (FROM.lat + TO.lat) / 2
const north = lats.filter((v) => v > directLatAtMid + 5).length
const south = lats.filter((v) => v < directLatAtMid - 5).length
console.log('waypoints well north of direct line:', north, 'well south:', south)

// 4. Determinism: the same seed twice gives the identical route.
const a = JSON.stringify(buildLegs(FROM.lat, FROM.lon, TO.lat, TO.lon, 1234, 2))
const b = JSON.stringify(buildLegs(FROM.lat, FROM.lon, TO.lat, TO.lon, 1234, 2))
console.log('same seed identical:', a === b)

// 5. Legs are contiguous: each leg starts where the previous one ended.
let gaps = 0
for (const route of routes) {
  for (let i = 1; i < route.legs.length; i += 1) {
    if (route.legs[i].fromLat !== route.legs[i - 1].toLat || route.legs[i].fromLng !== route.legs[i - 1].toLng) gaps += 1
  }
}
console.log('broken leg joins:', gaps)

const ok = endpointErrors === 0 && uniqueMid.size === midpoints.length && north > 0 && south > 0 && a === b && gaps === 0
console.log(ok ? '\nPASS route builder' : '\nFAIL route builder')
process.exit(ok ? 0 : 1)
