#!/usr/bin/env node
// Exercise the fill path end to end with a real agent token, and report what the
// broker says at each step. Read-only apart from creating one fill task, which is
// the point of the test.
//
//   AGENT_TOKEN=... BROKER=https://sb.otscup.com node scripts/try-fill.mjs <item> <origin>
//
// Exit code is 0 when a task was minted (an executor will pick it up), 1 when the
// broker refused, so this can gate a check in CI.
const BROKER = String(process.env.BROKER || 'https://sb.otscup.com').replace(/\/$/, '')
const TOKEN = String(process.env.AGENT_TOKEN || '').trim()
const [, , item, origin] = process.argv

if (!TOKEN) { console.error('AGENT_TOKEN is required'); process.exit(2) }
if (!item || !origin) { console.error('usage: try-fill.mjs <item> <origin>'); process.exit(2) }

async function rpc(name, args) {
  const response = await fetch(BROKER + '/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const payload = await response.json().catch(() => ({}))
  const result = payload.result ?? payload.error ?? {}
  const text = result?.content?.[0]?.text ?? JSON.stringify(result)
  return { isError: result?.isError === true || Boolean(payload.error), text }
}

const step = (label, value) => console.log(label.padEnd(22), value)

// 1. What can this agent see? An empty list means the token is wrong, not that
//    the vault is empty.
const list = await rpc('list_secrets', {})
if (list.isError) { step('list_secrets', 'FAILED: ' + list.text); process.exit(1) }
let visible = []
try { visible = JSON.parse(list.text) } catch {}
step('visible items', visible.length)
if (!visible.some((entry) => entry.name === item)) {
  step('scope', 'NOT IN SCOPE — grant it on the Agents page first')
  process.exit(1)
}
step('scope', 'ok')

// 2. request_access reports the approval state without consuming anything.
const access = await rpc('request_access', { name: item })
step('request_access', access.text)

// 3. The real thing: mint a fill task. A refusal here names the missing piece.
const fill = await rpc('secret.fill', { name: item, origin })
step('secret.fill', fill.text || '(empty)')

if (fill.text.includes('taskId')) {
  step('result', 'task minted — an executor will claim it within ~30s')
  process.exit(0)
}
// The common refusals, translated so the next step is obvious.
const hints = {
  'action-not-migratable': 'this agent has no secret.fill grant; grant it on the Agents page (read does not imply fill)',
  'no-execution-layer': 'no executor registered; install the extension and register it',
  'origin-not-allowed': 'the origin is not in the item\'s fill policy',
  'not-a-web-credential': 'the item is not classified as web',
  'no-fill-policy': 'the item has no fill policy yet',
  'not-granted': 'the item is outside this agent\'s scope',
  'web-credential-is-fill-only': 'this is a read attempt; use secret.fill',
}
for (const [needle, hint] of Object.entries(hints)) {
  if (fill.text.includes(needle)) { step('next step', hint); break }
}
process.exit(1)
