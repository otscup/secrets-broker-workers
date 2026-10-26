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
const token = fs.readFileSync(join(dsh, '.cloudflare', 'secrets-broker-token.txt'), 'utf8').trim()
const host = 'poc-broker.otscup.com'
const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'AAAA', name: host, content: '100::', proxied: true, ttl: 1 }),
})
const payload = await response.json().catch(() => ({}))
console.log(response.status, JSON.stringify(payload).slice(0, 500))
