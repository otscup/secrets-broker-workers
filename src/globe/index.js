// Agent Live Globe — isolated island. Everything here is optional: if any step
// fails the admin console must keep working, so the caller mounts us via
// dynamic import inside a try/catch.
import * as THREE from 'three'
import ThreeGlobe from 'three-globe'

const ACCENT = 0x0f9d8a
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
    setPoints(events, brokerLat, brokerLon) {
      const byAgent = new Map()
      for (const ev of events) {
        const g = ev.geo || {}
        if (g.lat === null || g.lon === null || typeof g.lat !== 'number' || typeof g.lon !== 'number') continue
        const key = ev.agent + '|' + g.lat + ',' + g.lon
        const prev = byAgent.get(key)
        // One point per agent+location, coloured by the newest outcome.
        if (!prev || String(ev.at) > String(prev.at)) byAgent.set(key, ev)
      }
      const points = [...byAgent.values()].map((ev) => ({
        lat: ev.geo.lat,
        lng: ev.geo.lon,
        size: 0.5,
        color: '#' + severityColor(ev.ok).toString(16).padStart(6, '0'),
        agent: ev.agent,
      }))
      globe.pointsData(points)
      const arcs = points.map((p) => ({
        startLat: p.lat, startLng: p.lng,
        endLat: Number.isFinite(brokerLat) ? brokerLat : 0,
        endLng: Number.isFinite(brokerLon) ? brokerLon : 0,
        color: ['#' + ACCENT.toString(16).padStart(6, '0'), p.color],
      }))
      globe.arcsData(arcs)
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
