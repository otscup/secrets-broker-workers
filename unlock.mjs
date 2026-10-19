#!/usr/bin/env node
/**
 * Headless unlock for the Workers broker.
 *
 * BROKER_URL=https://poc-broker.otscup.com \
 * ADMIN_PASSWORD=... MASTER_PASSWORD=... TTL=permanent \
 * node unlock.mjs
 *
 * The master password never leaves this process; only the derived
 * symmetric keys are sent to the Worker.
 */
import http from 'node:http'
import https from 'node:https'
import { pbkdf2, unlockUserKey, bytesToB64 } from './src/crypto.js'

const base = process.env.BROKER_URL
const adminPassword = process.env.ADMIN_PASSWORD
const masterPassword = process.env.MASTER_PASSWORD
const ttl = process.env.TTL || 'permanent'

if (!base || !adminPassword || !masterPassword) {
  console.error('usage: BROKER_URL=... ADMIN_PASSWORD=... MASTER_PASSWORD=... [TTL=permanent] node unlock.mjs')
  process.exit(1)
}

const target = new URL(base)
const client = target.protocol === 'http:' ? http : https
const cookies = []

function request(path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = client.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path,
      method,
      family: 4,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        ...(cookies.length ? { cookie: cookies.join('; ') } : {}),
      },
    }, (res) => {
      const setCookie = res.headers['set-cookie']
      if (setCookie) cookies.splice(0, cookies.length, ...setCookie.map((value) => value.split(';')[0]))
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = null
        try { data = JSON.parse(text) } catch {}
        resolve({ status: res.statusCode, data, text })
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const login = await request('/api/login', { method: 'POST', body: { password: adminPassword } })
if (login.status !== 200) throw new Error(`login failed: ${login.data?.error ?? login.status}`)

const bootstrap = await request('/api/bootstrap')
if (bootstrap.status !== 200) throw new Error(`bootstrap failed: ${bootstrap.data?.error ?? bootstrap.status}`)

const masterKey = await pbkdf2(masterPassword, String(bootstrap.data.email).toLowerCase(), bootstrap.data.kdfIterations, 32)
const keys = await unlockUserKey(bootstrap.data.profileKey, masterKey)
const unlock = await request('/api/unlock', {
  method: 'POST',
  body: { symEncKey: bytesToB64(keys.encKey), symMacKey: bytesToB64(keys.macKey), ttl },
})
if (unlock.status !== 200) throw new Error(`unlock failed: ${unlock.data?.error ?? unlock.status}`)

console.log(JSON.stringify({ ok: true, email: bootstrap.data.email, ttl, expiresAt: unlock.data.expiresAt, permanent: unlock.data.permanent }))
