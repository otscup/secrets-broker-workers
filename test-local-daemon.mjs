// The local vault daemon: one process holds the decrypted vault and answers MCP
// on 127.0.0.1. These assertions drive a real HTTP server, so what is checked is
// what a client on this machine actually gets.
import { makeDaemon, hostnameOf } from './cli/daemon.mjs'
import { request as httpRequest } from 'node:http'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const VAULT = [
  { id: 'a1', kind: 'api', payload: { name: 'openai-prod', secret: 'sk-live-1' } },
  { id: 'b2', kind: 'web', payload: { name: 'GitHub', username: 'octocat', password: 'hunter2', url: 'https://github.com' } },
]

let pullCalls = 0
let failNext = false
const fakePull = async () => {
  pullCalls += 1
  if (failNext) throw new Error('network down')
  return { revision: pullCalls, items: VAULT }
}

const daemon = makeDaemon({ pull: fakePull, everyMs: 0 })
const first = await daemon.refresh()
const { origin } = await daemon.listen({ port: 0 })

// D1: a browser page must never reach this.
{
  const response = await fetch(origin + '/healthz', { headers: { origin: 'https://evil.example' } })
  response.status === 403 ? pass('D1 a request carrying an Origin is refused') : fail('D1', String(response.status))
}

// D2: DNS rebinding - a Host that is not loopback is refused. fetch() will not
// let a caller set Host, so this one goes over a raw socket, which can.
{
  const status = await new Promise((resolve, reject) => {
    const url = new URL(origin + '/healthz')
    const request = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host: 'evil.example' } }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
    request.end()
  })
  status === 403 ? pass('D2 a non-loopback Host is refused') : fail('D2', String(status))
}

// D3: health says how many items are held, and when they were read.
{
  const body = await (await fetch(origin + '/healthz')).json()
  const ok = body.ok === true && body.items === 2 && body.stale === false && body.pulledAt > 0
  ok ? pass('D3 /healthz reports the item count and when it was read') : fail('D3', JSON.stringify(body))
}

// D4: the MCP endpoint answers with the real tool list.
{
  const response = await fetch(origin + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  const body = await response.json()
  const names = (body.result?.tools ?? []).map((tool) => tool.name)
  names.includes('list_secrets') && names.includes('get_secret') ? pass('D4 /mcp lists the local tools') : fail('D4', JSON.stringify(names))
}

// D5: a failed refresh keeps the last vault and says it may be old.
{
  failNext = true
  const stale = await daemon.refresh()
  const ok = stale.stale === true && stale.vault.length === 2 && stale.error.includes('network down')
  failNext = false
  ok ? pass('D5 a failed refresh keeps the old vault and marks it stale') : fail('D5', JSON.stringify(stale))
}

// D6: a preflight is refused, so a page cannot even negotiate.
{
  const response = await fetch(origin + '/mcp', { method: 'OPTIONS' })
  response.status === 403 ? pass('D6 a CORS preflight is refused') : fail('D6', String(response.status))
}

// D7: the Host parser handles IPv6 and ports - the guard depends on it.
{
  const ok = hostnameOf('127.0.0.1:4319') === '127.0.0.1' && hostnameOf('[::1]:4319') === '::1' && hostnameOf('localhost') === 'localhost'
  ok ? pass('D7 the host parser handles ports and IPv6') : fail('D7', 'hostnameOf broke')
}

await daemon.close()
const failed = results.filter((r) => !r.ok)
console.log('\n==== local daemon ' + results.filter((r) => r.ok).length + '/' + results.length + ' passed ====')
process.exit(failed.length ? 1 : 0)
