// One-off ops script. Needs CF_ZONE_ID.
import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dsh = process.env.DSH_HOME || join(homedir(), '.dsh')
const zone = process.env.CF_ZONE_ID
if (!zone) {
  console.error('CF_ZONE_ID is not set')
  process.exit(1)
}
const mainToken = fs.readFileSync(join(dsh, '.cloudflare', 'secrets-broker-token.txt'), 'utf8').trim()
const workerToken = fs.readFileSync(join(dsh, '.cloudflare', 'workers-d1-token.txt'), 'utf8').trim()
const host = 'sb.otscup.com'

async function api(token, method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  console.log(method, path, response.status, payload.success ? 'ok' : JSON.stringify(payload.errors))
  return payload
}

const existing = await api(mainToken, 'GET', `/zones/${zone}/dns_records?name=${host}`)
if (existing.success && existing.result.length === 0) {
  await api(mainToken, 'POST', `/zones/${zone}/dns_records`, { type: 'A', name: host, content: '192.0.2.1', proxied: true, ttl: 1 })
  await api(mainToken, 'POST', `/zones/${zone}/dns_records`, { type: 'AAAA', name: host, content: '100::', proxied: true, ttl: 1 })
}
const routes = await api(workerToken, 'GET', `/zones/${zone}/workers/routes`)
if (routes.success && !routes.result.some((route) => route.pattern === `${host}/*`)) {
  await api(workerToken, 'POST', `/zones/${zone}/workers/routes`, { pattern: `${host}/*`, script: 'secrets-broker-poc' })
}
