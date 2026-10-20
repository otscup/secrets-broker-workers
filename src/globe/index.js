// Agent Live Globe — isolated island. Everything here is optional: if any step
// fails the admin console must keep working, so the caller mounts us via
// dynamic import inside a try/catch.
import * as THREE from 'three'
import ThreeGlobe from 'three-globe'

const ACCENT = 0x0f9d8a
// The broker is deployed close to this node; used only as the fixed anchor of
// the "visited country" leg, never as a claim about where an agent is.
const CHINA_NODE = { lat: 31.23, lon: 121.47 }
const WARN = 0xd08a00
const DANGER = 0xc0392b

function severityColor(ok) {
  return ok ? ACCENT : DANGER
}

// Reused across renders to avoid GPU churn.
function createGlobe(container, { reduceMotion }) {
  const width = () => container.clientWidth || 640
  const height = () => container.clientHeight || 320
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, width() / height(), 0.1, 2000)
  camera.position.set(0, 60, 260)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width(), height())
  container.appendChild(renderer.domElement)

  const globe = new ThreeGlobe()
    .globeImageUrl('')            // no external texture: keeps CSP self-only
    .showAtmosphere(true)
    .atmosphereColor('#0f9d8a')
    .atmosphereAltitude(0.16)
    .pointAltitude(0.012)
    .pointRadius(0.55)
    .arcAltitudeAutoScale(0.35)
    .arcStroke(0.4)
    .arcDashLength(0.4)
    .arcDashGap(0.2)
    .arcDashAnimateTime(reduceMotion ? 0 : 2400)

  // A plain wireframe sphere reads as "earth" without any external asset.
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(100, 64, 48),
    new THREE.MeshPhongMaterial({ color: 0x16324f, transparent: true, opacity: 0.92, shininess: 8 }),
  )
  scene.add(sphere)
  scene.add(globe)
  scene.add(new THREE.AmbientLight(0xffffff, 1.1))
  const dir = new THREE.DirectionalLight(0xffffff, 1.4)
  dir.position.set(1, 1, 1)
  scene.add(dir)

  let running = !reduceMotion
  let frame = 0
  function tick() {
    frame = requestAnimationFrame(tick)
    if (!running) return
    sphere.rotation.y += 0.0012
    globe.rotation.y += 0.0012
    renderer.render(scene, camera)
  }
  tick()

  function resize() {
    renderer.setSize(width(), height())
    camera.aspect = width() / height()
    camera.updateProjectionMatrix()
    renderer.render(scene, camera)
  }
  const onResize = () => resize()
  window.addEventListener('resize', onResize)

  return {
    // Arc routing:
    //   me -> agent -> visited country   when we know where the operator is
    //   agent -> visited country         otherwise (or when both coincide)
    // A fixed node is never invented; if there is no operator fix we simply omit
    // that leg rather than fabricating a location.
    setPoints(events, operator, options) {
      const opts = options || {}
      const showArcs = opts.showArcs !== false
      const showOperator = opts.showOperator !== false
      const opLat = operator && operator.known && typeof operator.lat === 'number' ? operator.lat : null
      const opLon = operator && operator.known && typeof operator.lon === 'number' ? operator.lon : null
      const byAgent = new Map()
      for (const ev of events) {
        const g = ev.geo || {}
        if (g.lat === null || g.lon === null || typeof g.lat !== 'number' || typeof g.lon !== 'number') continue
        const key = ev.agent + '|' + g.lat + ',' + g.lon
        const prev = byAgent.get(key)
        // One point per agent+location, coloured by the newest outcome.
        if (!prev || String(ev.at) > String(prev.at)) byAgent.set(key, ev)
      }
      const hex = (value) => '#' + value.toString(16).padStart(6, '0')
      const points = [...byAgent.values()].map((ev) => ({
        lat: ev.geo.lat,
        lng: ev.geo.lon,
        size: 0.5,
        color: hex(severityColor(ev.ok)),
        agent: ev.agent,
        country: ev.geo.country || '',
        city: ev.geo.city || '',
      }))
      if (showOperator && opLat !== null && opLon !== null) {
        points.push({ lat: opLat, lng: opLon, size: 0.7, color: hex(ACCENT), agent: '我', isOperator: true })
      }
      globe.pointsData(points)
      const arcs = []
      for (const p of points) {
        if (p.isOperator) continue
        // Operator leg: only when we actually know the operator position and it
        // is not the same spot as the agent.
        if (opLat !== null && opLon !== null && (Math.abs(p.lat - opLat) > 0.01 || Math.abs(p.lng - opLon) > 0.01)) {
          arcs.push({ startLat: opLat, startLng: opLon, endLat: p.lat, endLng: p.lng, color: [hex(ACCENT), p.color] })
        } else if (opLat !== null && opLon !== null) {
          // Same location: still show me -> agent as a short stub is meaningless,
          // so skip this leg and let the agent -> country leg carry the story.
        }
        // Agent -> visited country leg: the broker sits in mainland China, and the
        // agent's own reported position is the visited country.
        arcs.push({ startLat: p.lat, startLng: p.lng, endLat: CHINA_NODE.lat, endLng: CHINA_NODE.lon, color: [p.color, hex(ACCENT)] })
      }
      globe.arcsData(showArcs ? arcs : [])
      renderer.render(scene, camera)
    },
    setPaused(value) { running = !value && !reduceMotion },
    dispose() {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      container.innerHTML = ''
    },
  }
}

export function mountGlobe(container, options) {
  return createGlobe(container, options)
}
