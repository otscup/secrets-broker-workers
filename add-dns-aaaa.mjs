import fs from 'node:fs'

const token = fs.readFileSync('E:\\dsh-home\\.cloudflare\\secrets-broker-token.txt', 'utf8').trim()
const zone = '9a1893fc52f7a09d766dd9d091376d42'
const host = 'poc-broker.otscup.com'
const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'AAAA', name: host, content: '100::', proxied: true, ttl: 1 }),
})
const payload = await response.json().catch(() => ({}))
console.log(response.status, JSON.stringify(payload).slice(0, 500))
