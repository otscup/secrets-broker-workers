import { cp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const out = join(here, 'ui')

// Clear yesterday's console copy, otherwise an incremental build keeps
// index.html and globe assets in the bundle even though this script no longer
// writes them.
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

// The app window only ever loads setup.html; the full console is served by the
// broker online. Shipping the console copy plus its globe assets put ~3 MB of
// files in the MSI that no window can open, so only what setup.html uses
// (logo.png, plus the favicon the browser asks for) is written here.
await cp(join(here, 'setup.html'), join(out, 'setup.html'))

for (const [from, to] of [
  ['assets/logo.png', 'logo.png'],
  ['assets/favicon.ico', 'favicon.ico'],
]) {
  await cp(join(root, from), join(out, to))
}

console.log('desktop UI written to ' + out)
