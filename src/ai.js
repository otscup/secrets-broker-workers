// AI diagnostic assistant.
//
// It answers questions about this installation — why a request was refused, which
// authorisation expired, what needs attention — from a snapshot of the broker's
// own state. It never receives a credential value, a username, a TOTP seed or a
// session key, and it has no write access at all: every answer is a suggestion the
// operator acts on in the console.
//
// Two providers, tried in order:
//   1. an OpenAI-compatible endpoint the operator configures (any base URL, key,
//      model), so a self-hosted or third-party model works;
//   2. Cloudflare Workers AI through the AI binding, if the Worker has one.
// No provider configured means the feature reports that plainly instead of
// failing a call.

// What the model may see. Built from state only; every field below is metadata.
export function aiSnapshot(state, extras = {}) {
  const now = Date.now()
  const audit = (state.audit ?? []).slice(0, 60).map((entry) => ({
    time: entry.time ?? '', event: entry.event ?? '', agent: entry.agent ?? '', name: entry.name ?? '',
    reason: entry.reason ?? '', severity: entry.severity ?? '',
  }))
  const capabilities = Object.values(state.capabilities ?? {}).map((cap) => ({
    agent: cap.subjectId ?? '', item: cap.itemName ?? '', action: cap.action ?? '',
    expiresAt: cap.expiresAt ?? null,
    status: cap.revokedAt ? 'revoked' : (cap.expiresAt && cap.expiresAt <= now ? 'expired' : 'valid'),
    usesLeft: cap.maxUses == null ? null : Math.max(0, cap.maxUses - (cap.usedCount ?? 0)),
  }))
  // Only the items of the account the snapshot is about. state.itemIds is an
  // append-only cache that survives an account switch, so using it directly
  // reported every item ever seen — including another vault's — which reads like
  // a privilege leak. extras.scope limits it to what this account actually has.
  const inScope = extras.scope instanceof Set ? extras.scope : null
  const items = Object.entries(state.itemIds ?? {})
    .filter(([name]) => !inScope || inScope.has(name))
    .map(([name, id]) => ({
      name,
      kind: state.credentialKinds?.[id] ?? 'unclassified',
      origins: state.fillPolicies?.[id]?.origins ?? [],
      plaintextRead: Boolean(state.plaintextReadPolicies?.[id]),
      noApproval: state.policies?.[name]?.noApproval === true,
      group: state.itemGroups?.[name] ?? '',
    }))
  return {
    now: new Date(now).toISOString(),
    vaultUnlocked: extras.vaultUnlocked === true,
    requireClassification: state.settings?.requireClassification === true,
    // The switches that actually decide a plaintext read. Without these the model
    // is guessing why a credential was refused.
    unclassifiedPlaintext: state.settings?.unclassifiedPlaintext === true,
    webPlaintext: state.settings?.webPlaintext === true,
    executors: Object.values(state.fillExecutors ?? {}).filter((e) => !e.revokedAt).map((e) => e.executorId),
    counts: {
      agents: Object.keys(state.agents ?? {}).length,
      items: items.length,
      pending: Object.keys(state.pending ?? {}).length,
      denied: Object.keys(state.deniedAttempts ?? {}).length,
      capabilities: capabilities.length,
    },
    agents: Object.entries(state.agents ?? {}).map(([name, agent]) => ({
      name, alias: agent.alias ?? '',
      scope: agent.allowAll === true ? 'all' : (agent.allow ?? []).slice(0, 40),
      groups: (agent.groups ?? []).slice(0, 20),
      expired: typeof agent.expiresAt === 'number' && agent.expiresAt < now,
    })),
    oauthAgents: Object.values(state.oauthTokens ?? {}).map((token) => ({
      agent: token.agent ?? '', clientId: token.clientId ?? '',
      expiresAt: token.expiresAt ?? null, expired: Boolean(token.expiresAt && token.expiresAt < now),
    })),
    items,
    capabilities,
    pending: Object.values(state.pending ?? {}).map((entry) => ({
      agent: entry.agent ?? '', name: entry.name ?? '', action: entry.action ?? '', createdAt: entry.createdAt ?? '',
    })),
    deniedAttempts: Object.values(state.deniedAttempts ?? {}).map((entry) => ({
      agent: entry.agent ?? '', name: entry.name ?? '', action: entry.action ?? '',
      reason: entry.reason ?? '', count: entry.count ?? 1, lastAt: entry.lastAt ?? '',
    })),
    audit,
  }
}

const AI_SYSTEM_PROMPT = `You are the built-in assistant of Secrets Broker, a self-hosted credential broker for AI agents.

You are given a JSON snapshot of this installation: agents and the items they may reach, which read/use/fill grants exist and whether they are valid, pending approvals, refused requests with reasons, and the recent audit log. It contains no credential values, no usernames and no TOTP seeds, and you must never ask for them.

How to answer:
- Answer in the operator's language (Chinese if they write Chinese).
- Be concrete. Name the agent and the credential. Explain the rule that caused the outcome, in plain words.
- The layers are separate and this is the usual source of confusion: scope (the agent's allow list / groups) decides whether it may even ask; a capability grant decides whether it may read/use/fill; classification (api / web / unclassified) and the plaintext-read policy decide whether a read returns a value. "not allowed to read this item" is scope or grant; "no-plaintext-read-policy" is the read switch; "unclassified-credential" is the missing label; "action-not-migratable" means the grant for that action was never given.
- For a website login (kind "web") a plaintext read is impossible by design; the only route is a fill task, which needs a registered executor and an exact origin.
- Say which console page fixes it and what to click. Be brief: a few sentences, or a short list.
- If the snapshot does not contain the answer, say so and name the field you would need. Never invent an item, an agent or an event.
- You cannot change anything. Do not claim you did.`

// Build the message list. History is the previous turns, already trimmed by the
// caller; this only enforces the shape.
export function aiMessages(question, snapshot, history = []) {
  const messages = [{ role: 'system', content: AI_SYSTEM_PROMPT }]
  for (const turn of history.slice(-6)) {
    if (turn?.role !== 'user' && turn?.role !== 'assistant') continue
    if (typeof turn.content !== 'string' || !turn.content) continue
    messages.push({ role: turn.role, content: turn.content.slice(0, 4000) })
  }
  messages.push({
    role: 'user',
    content: 'Snapshot of the installation:\n```json\n' + JSON.stringify(snapshot).slice(0, 24000) + '\n```\n\nQuestion: ' + String(question).slice(0, 2000),
  })
  return messages
}

// Ask the configured OpenAI-compatible endpoint. Returns { ok, text } or
// { ok: false, reason } so the caller can fall through to Workers AI.
async function askCustom({ endpoint, apiKey, model, messages, timeoutMs }) {
  const base = String(endpoint || '').replace(/\/$/, '')
  // Accept either the full chat path or just the base, because both are common.
  const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 900 }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) return { ok: false, reason: 'provider ' + response.status + ': ' + String(payload?.error?.message ?? payload?.error ?? '').slice(0, 160) }
    const text = payload?.choices?.[0]?.message?.content
    // Some gateways answer with `text` (completions) or a content array rather
    // than a string; take whichever is present instead of failing a working
    // provider for a shape difference.
    const fromCompletions = payload?.choices?.[0]?.text
    const fromArray = Array.isArray(text) ? text.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('') : ''
    const answer = typeof text === 'string' && text.trim() ? text : (fromArray || (typeof fromCompletions === 'string' ? fromCompletions : ''))
    if (!answer || !String(answer).trim()) {
      // Name what arrived, so an empty reply is diagnosable rather than a shrug.
      const shape = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 6).join(',') : typeof payload
      const finish = payload?.choices?.[0]?.finish_reason ?? ''
      return { ok: false, reason: 'provider returned no text（返回字段：' + shape + (finish ? '，finish_reason=' + finish : '') + '）' }
    }
    return { ok: true, text: String(answer).trim(), provider: 'custom' }
  } catch (error) {
    return { ok: false, reason: String(error.message ?? error).slice(0, 160) }
  } finally { clearTimeout(timer) }
}

// The one entry point. There is one provider: an OpenAI-compatible endpoint the
// operator configured themselves. The Workers AI binding is gone on purpose, so
// the assistant works the same whether this runs on Cloudflare, in a container
// or on a laptop.
export async function askAi(env, settings, { question, snapshot, history = [] }) {
  const ai = settings?.ai ?? {}
  if (ai.enabled === false) return { ok: false, reason: 'AI 助手已在设置里关闭' }
  const apiKey = ai.apiKey || env.AI_API_KEY
  if (!ai.endpoint) return { ok: false, reason: '自建 API 未配置（需要 endpoint / key / model）' }
  if (!apiKey) return { ok: false, reason: '自建 API 未配置（需要 endpoint / key / model）' }
  if (!ai.model) return { ok: false, reason: '自建 API 未配置（需要 endpoint / key / model）' }
  const messages = aiMessages(question, snapshot, history)
  const timeoutMs = Math.max(5000, Math.min(60000, Number(ai.timeoutMs) || 25000))
  const result = await askCustom({ endpoint: ai.endpoint, apiKey, model: ai.model, messages, timeoutMs })
  if (result.ok) return result
  return { ok: false, reason: '自建 API：' + result.reason }
}

async function listCustomModels({ endpoint, apiKey, timeoutMs = 15000 }) {
  const base = String(endpoint || '').replace(/\/$/, '')
  if (!base) return { ok: false, reason: '还没有填接口地址' }
  const url = /\/chat\/completions$/.test(base) ? base.replace(/\/chat\/completions$/, '/models') : base + '/models'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { headers: { authorization: 'Bearer ' + apiKey } , signal: controller.signal })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) return { ok: false, reason: '接口返回 ' + response.status + '：' + String(payload?.error?.message ?? payload?.error ?? '').slice(0, 140) }
    // Two shapes exist in the wild: {data:[{id}]} and a bare array of ids.
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
    const models = rows.map((row) => (typeof row === 'string' ? row : row?.id)).filter(Boolean).map(String)
    if (!models.length) return { ok: false, reason: '接口没有返回任何模型' }
    return { ok: true, models: models.sort((a, b) => a.localeCompare(b)).slice(0, 300) }
  } catch (error) {
    return { ok: false, reason: String(error.message ?? error).slice(0, 160) }
  } finally { clearTimeout(timer) }
}

// What the settings page offers. The list is only fetched when asked, because it
// costs a request to someone else's API.
export async function aiModelCatalog(env, settings, { fetchCustom = false } = {}) {
  const ai = settings?.ai ?? {}
  const out = { custom: { ok: false, models: [], reason: '' } }
  if (fetchCustom) {
    const key = ai.apiKey || env.AI_API_KEY
    if (!ai.endpoint) out.custom.reason = '先填接口地址'
    else if (!key) out.custom.reason = '先填 API Key'
    else out.custom = await listCustomModels({ endpoint: ai.endpoint, apiKey: key })
  }
  return out
}

// A short "what needs attention" list, computed here rather than asked of the
// model: these are facts, and a deterministic answer is cheaper and never wrong.
// Ordered by severity, not by category, so a truncated list still shows the
// problems that block an agent rather than the cosmetic ones.
export function aiInsights(snapshot) {
  const out = []
  const expiredGrants = snapshot.capabilities.filter((cap) => cap.status === 'expired')
  if (expiredGrants.length) {
    out.push({ level: 'warn', text: expiredGrants.length + ' 条授权已过期，例如 ' + expiredGrants[0].agent + ' → ' + expiredGrants[0].item + '（' + expiredGrants[0].action + '）。到「授权」页点时长可以延期。' })
  }
  if (snapshot.pending.length) out.push({ level: 'warn', text: '有 ' + snapshot.pending.length + ' 个请求在等你批准。' })
  if (!snapshot.vaultUnlocked) out.push({ level: 'warn', text: 'vault 当前是锁定的，Agent 无法读取任何值。' })
  const expiredOauth = snapshot.oauthAgents.filter((token) => token.expired)
  if (expiredOauth.length) out.push({ level: 'warn', text: expiredOauth.length + ' 个 OAuth token 已过期，客户端需要重新授权。' })
  const expiredAgents = snapshot.agents.filter((agent) => agent.expired)
  if (expiredAgents.length) out.push({ level: 'warn', text: expiredAgents.length + ' 个 Agent 的授权窗口已过，需要延期：' + expiredAgents.map((a) => a.name).slice(0, 3).join('、') })
  const websNoOrigin = snapshot.items.filter((item) => item.kind === 'web' && !(item.origins || []).length)
  if (websNoOrigin.length) out.push({ level: 'warn', text: websNoOrigin.length + ' 个 web 条目没有填允许的站点，填充永远不会成功。' })
  if (!snapshot.executors.length && snapshot.items.some((item) => item.kind === 'web')) {
    out.push({ level: 'warn', text: '有条目是 web 类型，但没有注册执行器，所以无法自动填充。' })
  }
  const denied = snapshot.deniedAttempts
  if (denied.length) {
    const top = denied.slice().sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0]
    out.push({ level: 'info', text: '有 ' + denied.length + ' 类请求被拦下；最多的是 ' + top.agent + ' → ' + top.name + '（' + (top.count ?? 1) + ' 次，' + top.reason + '）。「被拦下的请求」里可以一键授权。' })
  }
  const revoked = snapshot.capabilities.filter((cap) => cap.status === 'revoked')
  if (revoked.length) out.push({ level: 'info', text: revoked.length + ' 条授权已被撤销，不再生效。' })
  const unclassified = snapshot.items.filter((item) => item.kind === 'unclassified')
  if (unclassified.length) out.push({ level: 'info', text: unclassified.length + ' 个条目还没分类，Agent 读不到它们。到「密钥」页标成 api 或 web。' })
  return out.slice(0, 10)
}
