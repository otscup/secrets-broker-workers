import { cp, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { uiHtml } from '../src/ui.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const out = join(here, 'ui')

await mkdir(out, { recursive: true })
await writeFile(join(out, 'index.html'), uiHtml)

await cp(join(here, 'setup.html'), join(out, 'setup.html'))

for (const [from, to] of [
  ['assets/logo.png', 'logo.png'],
  ['assets/favicon.ico', 'favicon.ico'],
  ['public/globe.js', 'globe.js'],
  ['public/earth.jpg', 'earth.jpg'],
]) {
  await cp(join(root, from), join(out, to))
}

console.log('desktop UI written to ' + out)
