import fs from 'node:fs'

const file = 'E:\\dsh-home\\secrets-broker\\xid-client.json'
const client = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const registrationToken = client.registration_access_token
const uri = client.registration_client_uri
const redirects = new Set(client.redirect_uris || [])
redirects.add('https://broker.otscup.com/oidc/callback')
redirects.add('https://poc-broker.otscup.com/oidc/callback')
const payload = { ...client, redirect_uris: [...redirects] }
delete payload.registration_access_token
const response = await fetch(uri, {
  method: 'PUT',
  headers: { authorization: `Bearer ${registrationToken}`, 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})
const body = await response.json().catch(() => ({}))
console.log(response.status, JSON.stringify({ ...body, registration_access_token: body.registration_access_token ? '[redacted]' : undefined }).slice(0, 700))
if (response.ok) {
  fs.writeFileSync(file, JSON.stringify({ ...client, ...body }, null, 2), 'utf8')
}
