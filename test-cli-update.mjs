import assert from 'node:assert/strict'
import { checkForUpdate, compareVersions } from './cli/update.mjs'

assert.equal(compareVersions('0.2.15', '0.2.14'), 1)
assert.equal(compareVersions('v0.2.15', '0.2.15'), 0)
assert.equal(compareVersions('0.2.9', '0.2.10'), -1)
assert.equal(compareVersions('0.2.15-beta.1', '0.2.15'), -1)
assert.throws(() => compareVersions('0.2', '0.2.15'))

const release = (status, body) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
})

const newer = await checkForUpdate({
  current: '0.2.14',
  fetchImpl: release(200, {
    tag_name: 'desktop-v0.2.15',
    html_url: 'https://example.test/release',
    assets: [{ name: 'Secrets Broker_0.2.15_x64_en-US.msi', browser_download_url: 'https://example.test/a.msi' }],
  }),
})
assert.equal(newer.update, true)
assert.equal(newer.latest, '0.2.15')
assert.equal(newer.download, 'https://example.test/a.msi')

const current = await checkForUpdate({
  current: '0.2.15',
  fetchImpl: release(200, { tag_name: 'v0.2.15', assets: [] }),
})
assert.equal(current.update, false)

const none = await checkForUpdate({ current: '0.2.15', fetchImpl: release(404, {}) })
assert.equal(none.noReleases, true)
assert.equal(none.update, false)

const fallback = await checkForUpdate({
  current: '0.2.17',
  fetchImpl: async (url) => url.includes('api.github.com')
    ? { status: 403, ok: false }
    : {
        status: 200,
        ok: true,
        url: 'https://github.com/otscup/secrets-broker-workers/releases/tag/desktop-v0.2.18',
        text: async () => '<a href="https://github.com/otscup/secrets-broker-workers/releases/download/desktop-v0.2.18/Secrets.Broker_0.2.18_x64.msi">MSI</a>',
      },
})
assert.equal(fallback.update, true)
assert.equal(fallback.latest, '0.2.18')
assert.match(fallback.download, /desktop-v0\.2\.18\/.*\.msi$/)

const limited = await checkForUpdate({ current: '0.2.15', fetchImpl: release(403, {}) })
assert.equal(limited.rateLimited, true)
assert.equal(limited.update, false)

await assert.rejects(() => checkForUpdate({ current: '0.2.15', fetchImpl: release(500, {}) }), /500/)
await assert.rejects(() => checkForUpdate({ current: '0.2.15', fetchImpl: async () => { throw new Error('offline') } }), /offline/)

console.log('update check ok')
