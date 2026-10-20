import fs from 'node:fs'

const mainToken = fs.readFileSync('E:\\dsh-home\\.cloudflare\\secrets-broker-token.txt', 'utf8').trim()
const workerToken = fs.readFileSync('E:\\dsh-home\\.cloudflare\\workers-d1-token.txt', 'utf8').trim()
const account = 'f475b3dcf291c33ae82ab0b595f81958'
const zone = '9a1893fc52f7a09d766dd9d091376d42'
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
