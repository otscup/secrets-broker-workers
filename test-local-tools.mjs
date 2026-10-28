// The local vault server answers MCP from the rows this machine pulled, so an
// agent can work with the broker offline. Reads only: a write needs the remote
// approval a human gives in a browser.
import { createLocalServer } from './cli/vaulttools.mjs'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }

const vault = [
  { id: 'a1', kind: 'api', revision: 1, payload: { name: 'openai-prod', secret: 'sk-live-1' } },
  { id: 'b2', kind: 'web', revision: 2, payload: { name: 'GitHub', username: 'octocat', secret: 'hunter2', url: 'https://github.com', totp: 'JBSWY3DPEHPK3PXP' } },
  { id: 'c3', kind: 'api', revision: 3, deleted: true },
  { id: 'd4', kind: 'api', revision: 4, payload: null },
]
const server = createLocalServer({ vault, revision: 4 })
const ask = async (message) => {
  const { status, body } = await server.handle(message)
  return { status, body: body ? JSON.parse(body) : null }
}
const callTool = async (name, args) => (await ask({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } })).body.result

// L1: initialize names a protocol version and the server, so a client can proceed.
{
  const { status, body } = await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  const ok = status === 200 && body.result.protocolVersion === '2025-06-18' && body.result.serverInfo.name === 'secrets-broker-local'
  ok ? pass('L1 initialize answers a known protocol version') : fail('L1', JSON.stringify(body))
}

// L2: deleted rows and rows this key cannot open never reach the client, and
// every tool advertises whether it reads or writes.
{
  const { body } = await ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const names = body.result.tools.map((tool) => tool.name).sort().join(',')
  const annotated = body.result.tools.every((tool) => typeof tool.annotations?.readOnlyHint === 'boolean')
  const skipped = server.items.length === 2
  const ok = names === 'get_credential,get_secret,http_request,list_secrets,put_secret' && annotated && skipped
  ok ? pass('L2 the tool list is annotated and tombstones are not items') : fail('L2', JSON.stringify({ names, annotated, items: server.items.length }))
}

// L3: listing carries names and kinds but never a value.
{
  const result = await callTool('list_secrets', {})
  const text = result.content[0].text
  const listed = JSON.parse(text)
  const web = listed.items.find((item) => item.name === 'GitHub')
  const ok = listed.count === 2 && web?.kind === 'web' && !text.includes('sk-live-1') && !text.includes('hunter2')
  ok ? pass('L3 list_secrets names items without leaking values') : fail('L3', text.slice(0, 200))
}

// L4: an exact name returns the value and its kind.
{
  const result = await callTool('get_secret', { name: 'openai-prod' })
  const body = JSON.parse(result.content[0].text)
  const ok = body.value === 'sk-live-1' && body.kind === 'api'
  ok ? pass('L4 get_secret returns the value for an exact name') : fail('L4', JSON.stringify(body))
}

// L5: a near miss names the right item instead of claiming "not found" — the
// mistake that cost a real user an hour of chasing permissions.
{
  const result = await callTool('get_secret', { name: ' OpenAI prod ' })
  const said = result.content[0].text
  const ok = result.isError === true && /did you mean "openai-prod"/.test(said)
  ok ? pass('L5 a mistyped name gets the near miss back') : fail('L5', JSON.stringify(said))
}

// L6: a web login comes back with its username, url and totp.
{
  const body = JSON.parse((await callTool('get_credential', { name: 'GitHub' })).content[0].text)
  const ok = body.username === 'octocat' && body.password === 'hunter2' && body.totp.length === 16 && body.url === 'https://github.com'
  ok ? pass('L6 get_credential returns the whole login') : fail('L6', JSON.stringify(body))
}

// L7: writes are refused here, and the refusal says where they are allowed.
{
  const result = await callTool('put_secret', { name: 'x', value: 'y' })
  const ok = result.isError === true && /remote broker/.test(result.content[0].text)
  ok ? pass('L7 put_secret refuses and points at the remote broker') : fail('L7', JSON.stringify(result))
}

// L8: a notification is accepted without a body; an unknown method is -32601;
// a message without an id is never answered with a made-up id.
{
  const note = await ask({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const unknown = await ask({ jsonrpc: '2.0', id: 9, method: 'resources/list' })
  const noId = await ask({ jsonrpc: '2.0', method: 'resources/list' })
  const ok = note.status === 202 && note.body === null && unknown.body.error.code === -32601 && noId.status === 202
  ok ? pass('L8 notifications, unknown methods and id-less messages follow the spec') : fail('L8', JSON.stringify({ note, unknown: unknown.body, noId: noId.status }))
}

// L9: http_request injects the secret at the local daemon, returns only the
// response, and scrubs an upstream echo. The item URL is the target policy.
{
  const seen = []
  const proxy = createLocalServer({
    vault: [{ id: 'p1', kind: 'api', payload: { name: 'api-proxy', secret: 'sk-proxy', url: 'https://api.example.com/v1' } }],
    fetchImpl: async (url, init) => {
      seen.push({ url, init })
      return new Response('echo sk-proxy', { status: 200 })
    },
  })
  const result = await proxy.handle({
    jsonrpc: '2.0', id: 10, method: 'tools/call',
    params: { name: 'http_request', arguments: { name: 'api-proxy', url: 'https://api.example.com/v1/chat', method: 'POST', body: '{}' } },
  })
  const body = JSON.parse(result.body).result
  const text = body.content[0].text
  const parsed = JSON.parse(text)
  const ok = parsed.status === 200 && parsed.body.includes('[REDACTED]') && !text.includes('sk-proxy') &&
    seen.length === 1 && seen[0].init.headers.Authorization === 'Bearer sk-proxy' && seen[0].init.redirect === 'manual'
  ok ? pass('L9 http_request injects and scrubs the secret') : fail('L9', JSON.stringify({ text, calls: seen.length }))
}

// L10: the item URL is a real target policy, not just a suggestion.
{
  const proxy = createLocalServer({
    vault: [{ id: 'p1', kind: 'api', payload: { name: 'api-proxy', secret: 'sk-proxy', url: 'https://api.example.com/v1' } }],
    fetchImpl: async () => { throw new Error('must not be called') },
  })
  const result = await proxy.handle({
    jsonrpc: '2.0', id: 11, method: 'tools/call',
    params: { name: 'http_request', arguments: { name: 'api-proxy', url: 'https://evil.example.com/v1/chat' } },
  })
  const body = JSON.parse(result.body).result
  const ok = body.isError === true && /not the url/.test(body.content[0].text)
  ok ? pass('L10 a different host is refused before fetch') : fail('L10', JSON.stringify(body))
}

const failed = results.filter((r) => !r.ok)
console.log('\n==== local vault tools ' + results.filter((r) => r.ok).length + '/' + results.length + ' passed ====')
process.exit(failed.length ? 1 : 0)
