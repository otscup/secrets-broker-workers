/**
 * The plugin's host routes sit on the same origin as the DSH GUI, and the plugin
 * token behind them is what makes the broker approve things. They used to serve
 * any caller: a page on another site could POST /decide and hand an agent a
 * secret its human was still looking at. Only the origin is checkable here, so
 * that is what this asserts.
 */
import { apply } from './lib/index.js'

const routes = new Map()
apply({ effect: (fn) => { fn() }, webServer: { register: (def) => { routes.set(def.path, def.handler); return () => {} } } })

const out = []
const record = (name, ok, detail) => {
  out.push({ name, ok, detail })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : ' :: ' + detail))
}

// The broker is never reached by these cases: they must be refused first.
const calls = []
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options })
  const body = String(url).includes('/pending') ? { pending: [] } : { ok: true }
  return { ok: true, status: 200, json: async () => body }
}

function makeReq(method, url, headers = {}, body = '') {
  const chunks = body ? [Buffer.from(body)] : []
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }
}
function makeRes() {
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { res.status = status; res.headers = headers },
    end(text) { res.body = text },
  }
  return res
}
const call = async (path, method, headers, body) => {
  const handler = routes.get('/api/secrets-broker/' + path)
  if (!handler) throw new Error('route not registered: ' + path)
  const res = makeRes()
  await handler(makeReq(method, '/api/secrets-broker/' + path, headers, body), res)
  return { status: res.status, body: (() => { try { return JSON.parse(res.body) } catch { return res.body } })() }
}

// S1 - every route the client calls exists, so a renamed endpoint fails here.
{
  const wanted = ['pending', 'credential-requests', 'credential-requests/cancel', 'connect/save', 'decide', 'usage', 'wait', 'activity', 'items', 'items/save', 'items/delete']
  const missing = wanted.filter((path) => !routes.has('/api/secrets-broker/' + path))
  record('S1 every endpoint the client calls is registered', missing.length === 0, JSON.stringify(missing))
}

// S2 - a cross-site POST to /decide is refused before the broker is touched.
{
  calls.length = 0
  const result = await call('decide', 'POST', { origin: 'https://evil.example.com', host: '127.0.0.1:53862' }, '{"id":"p1","decision":"once"}')
  const reached = calls.length
  record('S2 a cross-site approve is refused and never reaches the broker', result.status === 403 && reached === 0, JSON.stringify({ status: result.status, reached }))
}

// S3 - the browser's own signal is enough even without an Origin header, which
// is how a no-cors form post or a fetch in some configurations arrives.
{
  calls.length = 0
  const result = await call('items/delete', 'POST', { 'sec-fetch-site': 'cross-site' }, '{"name":"x"}')
  record('S3 sec-fetch-site: cross-site is refused on POST', result.status === 403 && calls.length === 0, JSON.stringify({ status: result.status }))
}

// S4 - the same request from the GUI's own origin still works.
{
  calls.length = 0
  const result = await call('decide', 'POST', { origin: 'http://127.0.0.1:53862', host: '127.0.0.1:53862' }, '{"id":"p1","decision":"once"}')
  record('S4 a same-origin request is relayed', result.status === 200 && calls.length === 1 && String(calls[0].url).endsWith('/api/plugin/decide'), JSON.stringify({ status: result.status, reached: calls.length }))
}

// S5 - a same-site subresource request carries no Origin at all; it must pass.
{
  calls.length = 0
  const result = await call('pending', 'GET', { host: '127.0.0.1:53862' })
  record('S5 an idle GET with no Origin header is relayed', result.status === 200 && calls.length === 1, JSON.stringify({ status: result.status }))
}

// S6 - a GET is never turned into a write, and a POST is never served as a read.
{
  const wrong = await call('decide', 'GET', { host: '127.0.0.1:53862' })
  record('S6 the method is enforced per route', wrong.status === 405, JSON.stringify(wrong))
}

// S7 - the broker token is attached server-side and never returned to the page.
{
  calls.length = 0
  const result = await call('pending', 'GET', { host: '127.0.0.1:53862' })
  const sent = calls[0]?.options?.headers?.['x-broker-plugin-token'] ?? ''
  const leaked = JSON.stringify(result.body).includes(sent) && sent !== ''
  record('S7 the plugin token travels upstream only', sent.length > 0 && !leaked, JSON.stringify({ sent: sent ? sent.slice(0, 4) + '…' : '', leaked }))
}

const passed = out.filter((r) => r.ok).length
console.log('\n==== plugin guard ' + passed + '/' + out.length + ' passed ====')
process.exit(passed === out.length ? 0 : 1)
