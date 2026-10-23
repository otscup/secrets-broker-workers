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
  const items = Object.entries(state.itemIds ?? {}).map(([name, id]) => ({
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
    requireClassification: state.settings?.requireClassification !== false,
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
    if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'provider returned no text' }
    return { ok: true, text: text.trim(), provider: 'custom' }
  } catch (error) {
    return { ok: false, reason: String(error.message ?? error).slice(0, 160) }
  } finally { clearTimeout(timer) }
}

// Ask Workers AI. Its chat interface is the same shape as OpenAI's, so the
// messages array is reused unchanged.
async function askWorkersAi(env, { model, messages, timeoutMs }) {
  if (!env.AI || typeof env.AI.run !== 'function') return { ok: false, reason: 'AI binding not configured' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const result = await env.AI.run(model || '@cf/meta/llama-3.1-8b-instruct', { messages, max_tokens: 900 }, { signal: controller.signal })
    const text = typeof result === 'string' ? result : (result?.response ?? '')
    if (!String(text).trim()) return { ok: false, reason: 'Workers AI returned no text' }
    return { ok: true, text: String(text).trim(), provider: 'workers-ai' }
  } catch (error) {
    return { ok: false, reason: String(error.message ?? error).slice(0, 160) }
  } finally { clearTimeout(timer) }
}

// The one entry point. `settings.ai` decides the order: an explicit custom
// provider wins when configured; otherwise Workers AI; when neither is
// available the caller gets a clear reason instead of a stack trace.
export async function askAi(env, settings, { question, snapshot, history = [] }) {
  const ai = settings?.ai ?? {}
  if (ai.enabled === false) return { ok: false, reason: 'AI 助手已在设置里关闭' }
  const messages = aiMessages(question, snapshot, history)
  const timeoutMs = Math.max(5000, Math.min(60000, Number(ai.timeoutMs) || 25000))
  const failures = []

  const customReady = ai.endpoint && ai.apiKey && ai.model
  const order = ai.provider === 'workers-ai' ? ['workers-ai', 'custom'] : ['custom', 'workers-ai']
  for (const provider of order) {
    if (provider === 'custom') {
      if (!customReady) { failures.push('自建 API 未配置（需要 endpoint / key / model）'); continue }
      const result = await askCustom({ endpoint: ai.endpoint, apiKey: ai.apiKey, model: ai.model, messages, timeoutMs })
      if (result.ok) return result
      failures.push('自建 API：' + result.reason)
      continue
    }
    const result = await askWorkersAi(env, { model: ai.workersModel, messages, timeoutMs })
    if (result.ok) return result
    failures.push('Workers AI：' + result.reason)
  }
  return { ok: false, reason: failures.join('；') || '没有可用的 AI 提供方' }
}

// Workers AI text-generation models, as of the catalogue in 2026. Kept here
// rather than fetched at boot because the Worker has no way to ask Cloudflare for
// its catalogue without a separate API token — the AI binding can run a model but
// cannot list them. A stale entry is harmless: picking one that has been retired
// produces a clear provider error, and the field is still editable.
export const WORKERS_AI_MODELS = [
  { id: '@cf/deepseek-ai/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash（推荐，中文好）' },
  { id: '@cf/deepseek-ai/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash' },
  { id: '@cf/deepseek-ai/deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro（更强，更慢）' },
  { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 Distill 32B' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B' },
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8', label: 'Llama 3.1 8B（快）' },
  { id: '@cf/meta/llama-3.2-3b-instruct', label: 'Llama 3.2 3B（最快）' },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B' },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8', label: 'Qwen3 30B' },
  { id: '@cf/qwen/qwen3.8-27b', label: 'Qwen 3.8 27B' },
  { id: '@cf/zai-org/glm-4.7-flash', label: 'GLM-4.7 Flash' },
  { id: '@cf/zai-org/glm-5.3-flash', label: 'GLM-5.3 Flash' },
  { id: '@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
  { id: '@cf/openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
  { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1 24B' },
  { id: '@cf/google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
]

// Ask an OpenAI-compatible endpoint what it serves. GET /models is the one part
// of that API every provider implements, and it is what makes the model a picker
// rather than a field you must spell from memory.
export async function listCustomModels({ endpoint, apiKey, timeoutMs = 15000 }) {
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

// What the settings page offers. Workers AI is always listed (the binding may be
// absent, in which case asking is refused with that reason); the custom list is
// only fetched when asked, because it costs a request to someone else's API.
export async function aiModelCatalog(env, settings, { fetchCustom = false } = {}) {
  const ai = settings?.ai ?? {}
  const out = {
    workersAiAvailable: Boolean(env.AI),
    workersModels: WORKERS_AI_MODELS,
    custom: { ok: false, models: [], reason: '' },
  }
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
