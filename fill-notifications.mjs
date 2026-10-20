import fs from 'node:fs'
import https from 'node:https'

const admin = fs.readFileSync('E:\\dsh-home\\secrets-broker\\workers-admin-login-password.txt', 'utf8').trim()
const ntfyTopic = fs.readFileSync('E:\\dsh-home\\secrets-broker\\ntfy-topic.txt', 'utf8').trim()
const gotifyToken = fs.readFileSync('E:\\dsh-home\\secrets-broker\\gotify-token.txt', 'utf8').trim()
const wxpushToken = fs.readFileSync('E:\\dsh-home\\secrets-broker\\wxpush-token.txt', 'utf8').trim()
let cookies = []
function request(path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = https.request({ hostname: 'sb.otscup.com', port: 443, path, method, family: 4, headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...(cookies.length ? { cookie: cookies.join('; ') } : {}) } }, (res) => {
      const set = res.headers['set-cookie']; if (set) cookies = set.map((v) => v.split(';')[0])
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { const text = Buffer.concat(chunks).toString(); let data = null; try { data = JSON.parse(text) } catch {}; resolve({ status: res.statusCode, data }) })
    }); req.on('error', reject); if (payload) req.write(payload); req.end()
  })
}

console.log('login', (await request('/api/login', { method: 'POST', body: { password: admin } })).status)
const settings = {
  notifications: {
    ntfy: { url: 'https://ntfy.otscup.com', topic: ntfyTopic },
    gotify: { url: 'https://gotify.otscup.com', token: gotifyToken },
    wxpush: { url: 'https://wxpush.otscup.com/wxsend', token: wxpushToken },
  },
}
console.log('settings save', (await request('/api/settings', { method: 'POST', body: settings })).status)
console.log('policy', (await request('/api/policies', { method: 'POST', body: { name: 'tavily-api-key', noApproval: true } })).status)
const current = await request('/api/settings')
console.log('notifications', JSON.stringify(current.data?.notifications))
