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

// The broker's own position. The arc has to end at a real place, so this is
// resolved per render: an explicitly configured position, else the last
// position the broker itself was seen at. There is no hardcoded fallback.
function resolveBrokerNode(configured, operator) {
  if (configured && typeof configured.lat === 'number' && typeof configured.lon === 'number') {
    return { lat: configured.lat, lon: configured.lon, code: String(configured.code ?? '').toUpperCase() }
  }
  if (operator && operator.known && typeof operator.lat === 'number' && typeof operator.lon === 'number') {
    return { lat: operator.lat, lon: operator.lon, code: String(operator.country ?? '').toUpperCase() }
  }
  return null
}
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
  // The globe fills the card: the sphere is about 12% bigger than before, so
  // it matches the size of the agent ring below it.
  camera.position.set(0, 90, 340)

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

  // Direction markers: a light that travels along every arc. The dashes alone
  // do not read as a direction, so each arc gets a moving dot.
  const GLOBE_RADIUS = 100
  const markers = []
  const markerGroup = new THREE.Group()
  scene.add(markerGroup)
  // A points layer, not a second sphere: a coincident sphere z-fights with
  // the earth and makes it flicker.
  const markerGeometry = new THREE.BufferGeometry()
  const markerMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false })
  const markerPoints = new THREE.Points(markerGeometry, markerMaterial)
  // The arcs are great circles, so a point on one is found by slerping the two
  // ends. The height follows the same curve the arc uses.
  function pointOnArc(arc, t) {
    const start = new THREE.Vector3()
      .set(Math.cos(arc.startLng * Math.PI / 180) * Math.cos(arc.startLat * Math.PI / 180),
        Math.sin(arc.startLat * Math.PI / 180),
        -Math.sin(arc.startLng * Math.PI / 180) * Math.cos(arc.startLat * Math.PI / 180))
    const end = new THREE.Vector3()
      .set(Math.cos(arc.endLng * Math.PI / 180) * Math.cos(arc.endLat * Math.PI / 180),
        Math.sin(arc.endLat * Math.PI / 180),
        -Math.sin(arc.endLng * Math.PI / 180) * Math.cos(arc.endLat * Math.PI / 180))
    const angle = start.angleTo(end)
    if (angle === 0) return start.multiplyScalar(GLOBE_RADIUS * (1 + (arc.altitude ?? 0.2)))
    const sinAngle = Math.sin(angle)
    const a = Math.sin((1 - t) * angle) / sinAngle
    const b = Math.sin(t * angle) / sinAngle
    const point = start.multiplyScalar(a).add(end.multiplyScalar(b)).normalize()
    return point.multiplyScalar(GLOBE_RADIUS * (1 + (arc.altitude ?? 0.2) * Math.sin(Math.PI * t)))
  }
  function setDirectionMarkers(arcList) {
    for (const marker of markers) markerGroup.remove(marker)
    markers.length = 0
    if (!arcList.length) {
      markerGroup.remove(markerPoints)
      return
    }
    // One points object holds every marker, so the layer stays a single
    // draw call and the earth keeps exactly one sphere.
    const positions = new Float32Array(arcList.length * 3)
    const colors = new Float32Array(arcList.length * 3)
    const color = new THREE.Color()
    for (let i = 0; i < arcList.length; i += 1) {
      const arc = arcList[i]
      const point = pointOnArc(arc, 0)
      positions[i * 3] = point.x
      positions[i * 3 + 1] = point.y
      positions[i * 3 + 2] = point.z
      color.set(Array.isArray(arc.color) ? arc.color[0] : '#ffffff')
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
      markers.push({ arc, phase: arc.phase ?? 0 })
    }
    markerGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    markerGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    markerPoints.geometry = markerGeometry
    markerPoints.material = markerMaterial
    markerGroup.add(markerPoints)
  }
  let frame = 0
  let paused = reduceMotion
  let markerClock = 0
  function tick() {
    frame = requestAnimationFrame(tick)
    if (!paused) {
      controls.update()
      // The markers travel from the start to the end of their arc.
      markerClock += 1 / 60
      const attribute = markerPoints.geometry.getAttribute('position')
      if (attribute) {
        for (let i = 0; i < markers.length; i += 1) {
          const marker = markers[i]
          const t = (markerClock * 0.22 + marker.phase) % 1
          const point = pointOnArc(marker.arc, t)
          attribute.setXYZ(i, point.x, point.y, point.z)
        }
        attribute.needsUpdate = true
      }
    }
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

      // The broker node: where the traffic really ends. Without a real
      // position there is nothing to draw an arc to, so none is drawn.
      const broker = resolveBrokerNode(o.broker, operator)
      // Requests from the same place overlap into a single line, so each one
      // gets a deterministic offset. The offsets spread over a wide area and
      // the heights cover the whole range, so the trails read as scattered
      // departures instead of one dense bundle.
      const perSpot = new Map()
      const arcs = []
      for (const { ev, g, color } of located) {
        const spot = g.lat + ',' + g.lon
        const index = perSpot.get(spot) || 0
        perSpot.set(spot, index + 1)
        // Deterministic jitter keeps the layout stable between refreshes.
        const seed = Math.abs(Math.round((g.lat * 1000) + (g.lon * 977) + index * 7919))
        // A wide ring around the location, so the trails do not pile up.
        const spread = index === 0 ? 0 : 3 + ((seed % 37) / 37) * 14
        const bearing = (seed % 360) * (Math.PI / 180)
        const dLat = Math.cos(bearing) * spread
        const dLon = Math.sin(bearing) * spread
        const startLat = g.lat + dLat
        const startLon = g.lon + dLon
        // The height covers the whole range in even steps, so the trails are
        // spread from low to high instead of forming two clumps.
        const altitude = 0.08 + ((seed % 29) / 29) * 0.55 + (index % 5) * 0.06
        if (broker) {
          // The request itself: the agent location -> the broker.
          arcs.push({
            startLat, startLng: startLon, endLat: broker.lat, endLng: broker.lon,
            color: [color, '#7fc7ff'],
            altitude,
            stroke: 0.1 + ((seed % 7) / 7) * 0.26,
            // The marker starts at a different point on every arc, so the
            // direction reads as many separate flights.
            phase: (seed % 100) / 100,
          })
          // The operator leg, when the operator sits somewhere else.
          if (opLat !== null && opLon !== null && (Math.abs(g.lat - opLat) > 0.01 || Math.abs(g.lon - opLon) > 0.01)) {
            arcs.push({
              startLat: opLat, startLng: opLon, endLat: startLat, endLng: startLon,
              color: ['#ffd166', color],
              altitude: altitude * 0.6 + 0.04,
              stroke: 0.1 + ((seed % 5) / 5) * 0.16,
              phase: ((seed % 100) / 100 + 0.5) % 1,
            })
          }
        }
      }
      globe.arcsData(showArcs ? arcs : [])
      setDirectionMarkers(showArcs ? arcs : [])

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
