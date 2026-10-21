import fs from 'node:fs'
const s = fs.readFileSync('node_modules/three-globe/dist/three-globe.mjs', 'utf8')
for (const name of ['htmlElementsData','htmlElement','htmlAltitude','htmlTransitionDuration','labelsData','labelText','labelSize','labelColor','labelDotRadius','labelAltitude','ringsData','ringColor','ringMaxRadius','ringPropagationSpeed','ringRepeatPeriod']) {
  const present = s.includes(name + ':') || new RegExp('\\b' + name + '\\b').test(s)
  console.log((present ? 'OK   ' : 'MISS ') + name)
}
