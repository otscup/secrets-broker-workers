// The terminal hands pairing to the desktop app with a short deep link. These
// checks keep the link shape and the fail-closed cleanup honest without opening
// a browser or touching the real ~/.secrets-broker.
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'sb-pair-link-'))
process.env.BROKER_HOME = home
process.env.BROKER_CACHE_FILE = join(home, 'vault.db')

const { pairDeepLink, forgetDevice, deviceFile } = await import('./cli/vault.mjs')
const { savePull, cacheFile } = await import('./cli/cache.mjs')

const results = []
const pass = (name) => { results.push({ name, ok: true }); console.log('PASS  ' + name) }
const fail = (name, detail) => { results.push({ name, ok: false, detail }); console.log('FAIL  ' + name + ' :: ' + detail) }

try {
  const link = new URL(pairDeepLink({ base: 'https://sb.example/', code: 'ab 12' }))
  const ok = link.protocol === 'secrets-broker:' &&
    link.host === 'pair' &&
    link.searchParams.get('url') === 'https://sb.example/' &&
    link.searchParams.get('code') === 'ab 12' &&
    link.searchParams.get('noweb') === '1'
  ok ? pass('P1 the deep link keeps the broker URL and code') : fail('P1', link.toString())

  writeFileSync(deviceFile(), '{}')
  writeFileSync(join(home, 'device-key.dpapi'), 'sealed')
  savePull({ rows: [{ id: 'secret-1', ciphertext: 'abc' }] })
  if (!existsSync(cacheFile())) throw new Error('cache fixture was not created')

  forgetDevice()
  const cleared = !existsSync(deviceFile()) &&
    !existsSync(join(home, 'device-key.dpapi')) &&
    !existsSync(cacheFile())
  cleared ? pass('P2 forgetting a revoked device removes the key and local copy') : fail('P2', home)
} finally {
  rmSync(home, { recursive: true, force: true })
}

const failed = results.filter((result) => !result.ok)
console.log('\n==== desktop pairing ' + (results.length - failed.length) + '/' + results.length + ' passed ====')
process.exit(failed.length ? 1 : 0)
