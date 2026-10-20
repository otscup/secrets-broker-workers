import fs from 'node:fs'

const response = await fetch('https://auth.otscup.com/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'secrets-broker-workers-sb',
    redirect_uris: ['https://sb.otscup.com/oidc/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope: 'openid profile email',
    subject_type: 'public',
  }),
})
const body = await response.json().catch(() => ({}))
console.log(response.status, JSON.stringify({ ...body, registration_access_token: body.registration_access_token ? '[redacted]' : undefined }).slice(0, 900))
if (response.ok && body.client_id) fs.writeFileSync('E:\\dsh-home\\secrets-broker\\xid-sb-client.json', JSON.stringify(body, null, 2), 'utf8')
