// The local daemon used to be open to every process on the machine. These
// assertions drive the real HTTP server: a request needs that agent's token,
// and a secret read waits for a human decision unless a policy allows it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeDaemon } from './cli/daemon.mjs'
import { localUrl, readAgent, rotateAgent, makeGate } from './cli/localauth.mjs'

process.env.BROKER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-local-auth-'))
process.env.BROKER_NO_BROWSER = '1'

const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log('PASS  ' + n) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log('FAIL  ' + n + ' :: ' + d) }
const VAULT = [{ id: 'a1', kind: 'api', payload: { name: 'openai-prod', secret: 'sk-live-1' } }]
const call = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const rpc = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
const waitPending = async (origin) => {
  for (let i = 0; i < 100; i += 1) {
    const list = await (await fetch(origin + '/local/pending')).json()
    if (list.length) return list[0]
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return null
}

const daemon = makeDaemon({ pull: async () => ({ revision: 1, items: VAULT }), everyMs: 0 })
await daemon.refresh()
const { origin, port } = await daemon.listen({ port: 0 })
const mcp = localUrl('pi').replace(':4319', ':' + port)

// L1: no token, wrong token -> refused; the right token only identifies the agent.
{
  const empty = await call(origin + '/mcp', rpc(1, 'tools/list'))
  const wrong = await call(mcp.replace(/token=[^&]+/, 'token=nope'), rpc(2, 'tools/list'))
  const good = await call(mcp, { jsonrpc: '2.0', id: 3, method: 'tools/list' })
  const names = (await good.json()).result?.tools?.map((tool) => tool.name) ?? []
  empty.status === 401 && wrong.status === 401 && good.status === 200 && names.includes('get_secret')
    ? pass('L1 /mcp requires a valid per-agent token')
    : fail('L1', JSON.stringify({ empty: empty.status, wrong: wrong.status, good: good.status, names }))
}

// L2: listing names is not a secret read and does not wait for approval.
{
  const response = await call(mcp, rpc(4, 'list_secrets'))
  const body = await response.json()
  const text = body.result?.content?.[0]?.text ?? ''
  response.status === 200 && text.includes('openai-prod') && !body.error
    ? pass('L2 list_secrets does not need approval')
    : fail('L2', JSON.stringify({ status: response.status, text }))
}

// L3: a read waits; the approval page resolves it; the value then reaches the agent.
{
  const read = call(mcp, rpc(5, 'get_secret', { name: 'openai-prod' }))
  const pending = await waitPending(origin)
  const page = pending ? await fetch(pending.url) : null
  const html = page ? await page.text() : ''
  const decision = pending
    ? await fetch(pending.url + '/decision?decision=once', { method: 'POST' })
    : null
  const response = await read
  const body = await response.json()
  const text = body.result?.content?.[0]?.text ?? ''
  pending && page?.status === 200 && html.includes('pi') && decision?.status === 200 && response.status === 200 && text.includes('sk-live-1')
    ? pass('L3 an unapproved read waits and succeeds after Allow once')
    : fail('L3', JSON.stringify({ pending: Boolean(pending), page: page?.status, decision: decision?.status, status: response.status, text }))
}

// L4: deny is a refusal, not a leaked value.
{
  const read = call(mcp, rpc(6, 'get_secret', { name: 'openai-prod' }))
  const pending = await waitPending(origin)
  if (pending) await fetch(pending.url + '/decision?decision=deny', { method: 'POST' })
  const response = await read
  const body = await response.json()
  response.status === 403 && !JSON.stringify(body).includes('sk-live-1')
    ? pass('L4 deny returns an error and no value')
    : fail('L4', JSON.stringify({ status: response.status, body }))
}

// L5: an allow policy is remembered for this agent and this item.
{
  const first = call(mcp, rpc(7, 'get_secret', { name: 'openai-prod' }))
  const pending = await waitPending(origin)
  if (pending) await fetch(pending.url + '/decision?decision=allow', { method: 'POST' })
  await first
  const second = await call(mcp, rpc(8, 'get_secret', { name: 'openai-prod' }))
  const body = await second.json()
  const policy = readAgent('pi').policy
  second.status === 200 && body.result?.content?.[0]?.text?.includes('sk-live-1') && policy.mode === 'allow' && policy.items.includes('openai-prod')
    ? pass('L5 Always allow persists for one agent and one item')
    : fail('L5', JSON.stringify({ status: second.status, policy }))
}

// L6: 15 minutes is a time box, not a permanent grant.
{
  const dsh = localUrl('dsh').replace(':4319', ':' + port)
  const first = call(dsh, rpc(9, 'get_secret', { name: 'openai-prod' }))
  const pending = await waitPending(origin)
  if (pending) await fetch(pending.url + '/decision?decision=window', { method: 'POST' })
  await first
  const second = await call(dsh, rpc(10, 'get_secret', { name: 'openai-prod' }))
  const policy = readAgent('dsh').policy
  second.status === 200 && policy.mode === 'window' && policy.until > Date.now()
    ? pass('L6 Allow 15 minutes is stored as an expiring window')
    : fail('L6', JSON.stringify({ status: second.status, policy }))
}

// L7: writes never run on the loopback device.
{
  const response = await call(mcp, rpc(11, 'put_secret', { name: 'x', value: 'y' }))
  const body = await response.json()
  response.status === 403 && !JSON.stringify(body).includes('"y"')
    ? pass('L7 put_secret is refused locally')
    : fail('L7', JSON.stringify({ status: response.status, body }))
}

// L8: rotating one token invalidates the old URL, keeps the policy, and the new URL works.
{
  const old = localUrl('pi').replace(':4319', ':' + port)
  rotateAgent('pi')
  const fresh = localUrl('pi').replace(':4319', ':' + port)
  const denied = await call(old, { jsonrpc: '2.0', id: 12, method: 'tools/list' })
  const allowed = await call(fresh, { jsonrpc: '2.0', id: 13, method: 'tools/list' })
  denied.status === 401 && allowed.status === 200 && readAgent('pi').policy.mode === 'allow'
    ? pass('L8 rotating one token invalidates the old URL and keeps its policy')
    : fail('L8', JSON.stringify({ denied: denied.status, allowed: allowed.status, policy: readAgent('pi').policy }))
}

// L9: decisions are recorded without the value itself.
{
  const text = fs.readFileSync(path.join(process.env.BROKER_HOME, 'audit.jsonl'), 'utf8')
  !text.includes('sk-live-1') && text.includes('"agent":"pi"') && text.includes('"result":"allowed"')
    ? pass('L9 approvals are audited without the secret value')
    : fail('L9', text.slice(-500))
}

// L10: a burst of approval requests is rate-limited, not queued forever.
{
  const gate = makeGate({ open: () => {}, timeoutMs: 1000, limit: 1 })
  const first = gate.check('burst', { params: { name: 'get_secret', arguments: { name: 'x' } } })
  const waiting = gate.pending()[0]
  const blocked = await gate.check('burst', { params: { name: 'get_secret', arguments: { name: 'x' } } })
  if (waiting) gate.decide(waiting.id, 'deny')
  const result = await first
  blocked.ok === false && /too many/.test(blocked.reason) && result.ok === false
    ? pass('L10 a burst of approval requests is rate-limited')
    : fail('L10', JSON.stringify({ blocked, result, waiting: Boolean(waiting) }))
}

await daemon.close()
fs.rmSync(process.env.BROKER_HOME, { recursive: true, force: true })
const failed = results.filter((row) => !row.ok)
console.log('\n==== local auth ' + results.filter((row) => row.ok).length + '/' + results.length + ' passed ====')
process.exit(failed.length ? 1 : 0)
