// Agent Live Globe — isolated island.
//
// Rendering:
//  - Earth uses a bundled photographic texture; no external requests, so the
//    page CSP stays at 'self'.
//  - three-globe owns the sphere. Never add a second coincident sphere: that
//    causes z-fighting and the globe visibly flickers.
//  - Arcs carry a country-code label at the arc midpoint.
import * as THREE from 'three'
import ThreeGlobe from 'three-globe'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import countries from './countries.json'

const CHINA_NODE = { lat: 31.23, lon: 121.47, code: 'CN' }

function currentTheme() {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark' || attr === 'light') return attr
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function createGlobe(container, options) {
  const reduceMotion = Boolean(options && options.reduceMotion)

  const width = () => container.clientWidth || 640
  const height = () => container.clientHeight || 340

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, width() / height(), 0.1, 4000)
  // Pull the camera back so the rendered globe is about 15% smaller.
  camera.position.set(0, 106, 380)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width(), height())
  container.appendChild(renderer.domElement)

  const globe = new ThreeGlobe({ animateIn: !reduceMotion })
    .globeImageUrl('/earth.jpg')
    .showAtmosphere(true)
    .atmosphereColor('#7fc7ff')
    .atmosphereAltitude(0.18)
    .pointAltitude(0.015)
    .pointRadius(0.55)
    .arcAltitudeAutoScale(0.42)
    .arcAltitude((d) => (typeof d.altitude === 'number' ? d.altitude : 0.2))
    .arcStroke((d) => (typeof d.stroke === 'number' ? d.stroke : 0.18))
    .arcDashLength(0.6)
    .arcDashGap(0.3)
    .arcDashAnimateTime(reduceMotion ? 0 : 2000)
    // Country-code labels use the labels layer: three-globe has no arcLabel
    // methods (those belong to globe.gl), and calling them returns undefined
    // which breaks the whole chained builder.
    .labelText((d) => d.text || '')
    .labelSize(0.55)
    .labelAltitude(0.014)
    .labelDotRadius(0)
    .labelColor(() => (currentTheme() === 'dark' ? '#7fe8d8' : '#0b6f62'))

  const globeMaterial = globe.globeMaterial()
  globeMaterial.color = new THREE.Color(0xffffff)
  globeMaterial.emissive = new THREE.Color(0x111111)
  globeMaterial.emissiveIntensity = 0.05
  globeMaterial.shininess = 4

  scene.add(globe)
  const ambient = new THREE.AmbientLight(0xffffff, 1.35)
  scene.add(ambient)
  const key = new THREE.DirectionalLight(0xffffff, 1.15)
  key.position.set(1, 0.6, 1)
  scene.add(key)

  // Borders only: the photograph already supplies land colour.
  globe
    .polygonsData(countries.features)
    .polygonAltitude(0.002)
    .polygonCapColor(() => 'rgba(0,0,0,0)')
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor(() => 'rgba(255,255,255,0.35)')

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.rotateSpeed = 0.55
  controls.zoomSpeed = 0.7
  controls.minDistance = 150
  controls.maxDistance = 620
  controls.autoRotate = !reduceMotion
  controls.autoRotateSpeed = 0.35
  let interacting = false
  controls.addEventListener('start', () => { interacting = true; controls.autoRotate = false })
  controls.addEventListener('end', () => { interacting = false })

  let frame = 0
  let paused = reduceMotion
  function tick() {
    frame = requestAnimationFrame(tick)
    if (!paused) controls.update()
    renderer.render(scene, camera)
  }
  tick()

  function onResize() {
    renderer.setSize(width(), height())
    camera.aspect = width() / height()
    camera.updateProjectionMatrix()
    renderer.render(scene, camera)
  }
  window.addEventListener('resize', onResize)

  return {
    setPoints(events, operator, opts) {
      const o = opts || {}
      const showArcs = o.showArcs !== false
      const showOperator = o.showOperator !== false

      // Every recorded request gets its own arc, so the globe fills with a dense
      // trail of flights instead of one line per location. Arcs are coloured per
      // agent so different agents stay distinguishable.
      const PALETTE = ['#2ee6c8', '#ff6b6b', '#ffd166', '#5b8cff', '#ff8ad8', '#9dff5b', '#ffa45b', '#c08cff', '#5be0ff', '#ff7a5c']
      const agentColor = new Map()
      const colorFor = (agent) => {
        const key = String(agent || '?')
        if (!agentColor.has(key)) agentColor.set(key, PALETTE[agentColor.size % PALETTE.length])
        return agentColor.get(key)
      }

      const located = []
      for (const ev of events || []) {
        const g = ev.geo || {}
        if (typeof g.lat !== 'number' || typeof g.lon !== 'number') continue
        located.push({ ev, g, color: colorFor(ev.agent) })
      }

      const opLat = operator && operator.known && typeof operator.lat === 'number' ? operator.lat : null
      const opLon = operator && operator.known && typeof operator.lon === 'number' ? operator.lon : null
      const opCode = operator && operator.country ? String(operator.country).toUpperCase() : ''

      // One marker per request, kept small so dense traffic stays readable.
      const points = []
      const spotCount = new Map()
      for (const { ev, g, color } of located) {
        const spot = g.lat + ',' + g.lon
        const index = spotCount.get(spot) || 0
        spotCount.set(spot, index + 1)
        const seed = Math.abs(Math.round((g.lat * 1000) + (g.lon * 977) + index * 7919))
        const spread = index === 0 ? 0 : 1.2 + ((seed % 23) / 23) * 6.5
        const bearing = (seed % 360) * (Math.PI / 180)
        points.push({
          lat: g.lat + Math.cos(bearing) * spread,
          lng: g.lon + Math.sin(bearing) * spread,
          size: 0.16 + ((seed % 5) / 5) * 0.18,
          color,
          agent: ev.agent,
        })
      }
      if (showOperator && opLat !== null && opLon !== null) {
        points.push({ lat: opLat, lng: opLon, size: 0.7, color: '#ffd166', agent: '我', isOperator: true })
      }
      globe.pointsData(points)

      // Requests from the same place overlap into a single line, so each one
      // gets a small deterministic offset. The result fans out like departing
      // flights instead of collapsing onto one stroke.
      const perSpot = new Map()
      const arcs = []
      for (const { ev, g, color } of located) {
        const spot = g.lat + ',' + g.lon
        const index = perSpot.get(spot) || 0
        perSpot.set(spot, index + 1)
        // Deterministic jitter keeps the layout stable between refreshes, while
        // the angle, the radius and the arc height all vary so the trails look
        // like scattered departures rather than a tight bundle.
        const seed = Math.abs(Math.round((g.lat * 1000) + (g.lon * 977) + index * 7919))
        const spread = index === 0 ? 0 : 1.2 + ((seed % 23) / 23) * 6.5
        const bearing = (seed % 360) * (Math.PI / 180)
        const dLat = Math.cos(bearing) * spread
        const dLon = Math.sin(bearing) * spread
        const startLat = g.lat + dLat
        const startLon = g.lon + dLon
        // Each trail gets its own altitude, so they arc apart in the air.
        const altitude = 0.12 + ((seed % 13) / 13) * 0.9
        // The request itself: the agent location -> the broker node in China.
        arcs.push({
          startLat, startLng: startLon, endLat: CHINA_NODE.lat, endLng: CHINA_NODE.lon,
          color: [color, '#7fc7ff'],
          // Every trail flies at its own height and width, so the paths read
          // as scattered departures instead of one dense bundle.
          altitude,
          stroke: 0.1 + ((seed % 7) / 7) * 0.26,
        })
        // The operator leg, when the operator sits somewhere else.
        if (opLat !== null && opLon !== null && (Math.abs(g.lat - opLat) > 0.01 || Math.abs(g.lon - opLon) > 0.01)) {
          arcs.push({
            startLat: opLat, startLng: opLon, endLat: startLat, endLng: startLon,
            color: ['#ffd166', color],
          })
        }
      }
      globe.arcsData(showArcs ? arcs : [])

      // Country codes sit on the globe, one per visited country.
      const labels = []
      const seenCountry = new Set()
      for (const { g } of located) {
        const cc = g.country ? String(g.country).toUpperCase() : ''
        if (!cc || seenCountry.has(cc)) continue
        seenCountry.add(cc)
        labels.push({ lat: g.lat, lng: g.lon, text: cc })
      }
      if (opLat !== null && opLon !== null && opCode) labels.push({ lat: opLat, lng: opLon, text: opCode })
      globe.labelsData(showArcs ? labels : [])
    },
    setTheme(name) {
      // The photographic texture is theme-neutral; only the glow shifts.
      const dark = name === 'dark'
      globe.atmosphereColor(dark ? '#0f9d8a' : '#7fc7ff')
      globe.labelColor(() => (dark ? '#7fe8d8' : '#0b6f62'))
      ambient.intensity = dark ? 1.15 : 1.4
      key.intensity = dark ? 1.0 : 1.2
    },
    setPaused(value) {
      paused = Boolean(value) || reduceMotion
      controls.autoRotate = !paused && !interacting
    },
    dispose() {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      container.innerHTML = ''
    },
  }
}

export function mountGlobe(container, options) {
  return createGlobe(container, options)
}
