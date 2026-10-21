// Smoke-test the admin UI bundle: the served HTML must contain every element id
// the script binds to, and all top-level id selectors must resolve. A single
// missing element previously threw during init and froze the whole page.
import { Miniflare } from 'miniflare'
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const KEK = Buffer.alloc(32, 251).toString('base64')
const mf = new Miniflare({ modules: true, modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }], compatibilityDate: '2024-01-01', scriptPath: 'src/index.js', durableObjects: { BROKER_STATE: 'BrokerState' }, vars: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, bindings: { SESSION_KEK: KEK, ADMIN_PASSWORD: 'p' }, serviceBindings: { NODEWARDEN: async () => new Response('{}') } })
const ns = await mf.getDurableObjectNamespace('BROKER_STATE')
const stub = ns.get(ns.idFromName('global'))
await stub.fetch('https://do/state', { method: 'PUT', body: JSON.stringify({ agents: {}, oauthClients: {}, oauthCodes: {}, oauthTokens: {}, oauthAgentProfiles: {}, policies: {}, grants: {}, pending: {}, audit: [], settings: { notifications: {}, vaultEmail: 'p@example.invalid' }, itemGroups: {}, security: { passwordHash: '', passwordSalt: '', totpSecretWrapped: '', totpEnabled: false, totpPendingWrapped: '' } }) })
const cookie = String((await mf.dispatchFetch('https://broker.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'p' }) })).headers.get('set-cookie') || '').split(';')[0]
const r = await mf.dispatchFetch('https://broker.test/', { headers: { cookie } })
const html = await r.text()

// Every id the inline script looks up must exist in the served markup.
{
  const used = [...html.matchAll(/\$\('([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1])
  const defined = new Set([...html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((m) => m[1]))
  // Elements whose binding is explicitly null-guarded are allowed to be absent.
  // Elements created at runtime (the enlarged-globe overlay) are never in the
  // served markup, so they are expected to be missing here.
  const guarded = new Set(['copy-token', 'globe-overlay', 'globe-big-box', 'globe-danmu', 'globe-big-close'])
  const missing = [...new Set(used)].filter((id) => !defined.has(id) && !guarded.has(id))
  if (missing.length === 0) pass('U1 all ' + new Set(used).size + ' bound element ids exist or are guarded')
  else fail('U1', 'missing: ' + missing.join(','))
}
// V2 structure is present
{
  const marks = ['agent-stats', 'agent-search', 'agent-type-filter', 'agent-sort', 'agent-new']
  const missing = marks.filter((m) => !html.includes('id="' + m + '"'))
  if (missing.length === 0) pass('U2 V2 controls present in markup')
  else fail('U2', 'missing: ' + missing.join(','))
}
// V2 logic shipped
{
  const marks = ['function openAgentDetail', 'function openAgentCreate', 'function lastActivityFor', 'function agentHealth', 'renderAgentStats']
  const missing = marks.filter((m) => !html.includes(m))
  if (missing.length === 0) pass('U3 V2 handlers shipped')
  else fail('U3', 'missing: ' + missing.join(','))
}
// The copy-token binding must be null-guarded: a bare $('copy-token').onclick
// throws on null and aborts the whole init script, freezing the page.
{
  const bare = /\$\('copy-token'\)\.onclick/.test(html)
  const guarded = /const copyTokenBtn = \$\('copy-token'\); if \(copyTokenBtn\)/.test(html)
  if (guarded && !bare) pass('U4 copy-token binding is null-guarded')
  else fail('U4', JSON.stringify({ guarded, bare }))
}
// The inline script is syntactically parseable
{
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)
  let ok = false
  try { new Function(script[1]); ok = true } catch (e) { console.log('   parse error: ' + String(e.message).slice(0, 100)) }
  if (ok) pass('U5 inline script parses')
  else fail('U5', 'script parse error')
}
await mf.dispose()
const passed = results.filter((x) => x.ok).length
console.log('\n==== ui smoke ' + passed + '/' + results.length + ' passed ====')
if (passed !== results.length) process.exit(1)
