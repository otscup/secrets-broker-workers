/**
 * MCP tools answered from the vault this machine already holds.
 *
 * The remote broker curates what an agent may reach, item by item. A paired
 * device holds the whole key instead, so nothing here can be curated by the
 * server — the honest answer is to serve reads only and send writes back to the
 * remote, where a human approves them.
 */
const PROTOCOL_VERSION = '2025-06-18'

const TOOLS = [
  {
    name: 'list_secrets',
    title: 'List credentials',
    description: 'Names this vault holds, without any value. Use it before asking for one.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_secret',
    title: 'Read a secret',
    description: 'The secret value for one exact name. Names are case-sensitive.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    annotations: { readOnlyHint: true, openWorldHint: false, sensitiveOutput: true },
  },
  {
    name: 'get_credential',
    title: 'Read a login',
    description: 'Username, password, url and totp of one exact name.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    annotations: { readOnlyHint: true, openWorldHint: false, sensitiveOutput: true },
  },
  {
    name: 'put_secret',
    title: 'Store a credential',
    description: 'Not available on a paired device: the remote broker approves writes.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name'] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
]

const reply = (id, result) => JSON.stringify({ jsonrpc: '2.0', id, result })
const rpcError = (id, code, message) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) })

function present(item) {
  return { name: item.name, kind: item.kind, hasTotp: Boolean(item.payload?.totp), url: item.payload?.url ?? '' }
}

// "openai prod" should find "openai-prod": an agent that mistypes should get the
// near miss back instead of "not found".
function closest(wanted, names) {
  const loose = String(wanted).toLowerCase().replace(/[\s_\-.]+/g, '')
  return names.find((name) => name.toLowerCase().replace(/[\s_\-.]+/g, '') === loose) ?? ''
}

export function createLocalServer({ vault, revision = 0 } = {}) {
  const items = (vault ?? [])
    .filter((item) => item && item.payload && typeof item.payload.name === 'string')
    .map((item) => ({ kind: item.kind === 'web' ? 'web' : 'api', name: item.payload.name, payload: item.payload }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const byName = (name) => items.find((item) => item.name === name) ?? null

  const call = (name, args = {}) => {
    if (name === 'list_secrets') {
      return text({ revision, count: items.length, items: items.map(present) })
    }
    if (name === 'get_secret' || name === 'get_credential') {
      const wanted = String(args.name ?? '').trim()
      if (!wanted) return text('name is required', true)
      const item = byName(wanted)
      if (!item) {
        const guess = closest(wanted, items.map((entry) => entry.name))
        return text(guess ? `no item named "${wanted}"; did you mean "${guess}"?` : `no item named "${wanted}"; run list_secrets for the names`, true)
      }
      if (name === 'get_secret') return text({ name: item.name, kind: item.kind, value: item.payload.secret ?? '', url: item.payload.url ?? '' })
      return text({ name: item.name, username: item.payload.username ?? '', password: item.payload.secret ?? item.payload.password ?? '', url: item.payload.url ?? '', totp: item.payload.totp ?? '' })
    }
    if (name === 'put_secret') {
      return text('a paired device reads; writes go through the remote broker, where a human approves them', true)
    }
    return text('unknown tool: ' + name, true)
  }

  return {
    items,
    handle(message) {
      const id = message?.id ?? null
      const method = String(message?.method ?? '')
      if (method === 'initialize') {
        return { status: 200, body: reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'secrets-broker-local', version: '2.0.0' } }) }
      }
      if (method === 'tools/list') return { status: 200, body: reply(id, { tools: TOOLS }) }
      if (method === 'tools/call') {
        const params = message.params ?? {}
        const result = call(String(params.name ?? ''), params.arguments ?? {})
        return { status: 200, body: reply(id, result) }
      }
      if (method.startsWith('notifications/')) return { status: 202, body: '' }
      if (!id) return { status: 202, body: '' }
      return { status: 200, body: rpcError(id, -32601, 'method not found: ' + method) }
    },
  }
}
