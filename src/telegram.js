// Telegram command handler.
//
// The operator wants to answer approvals while away from the console. This adds a
// text interface on the SAME bot the notifications already use, so nothing has to
// be reconfigured.
//
// What it can do: list what is waiting, approve or deny a request, extend or
// revoke a grant, and answer questions about state.
//
// What it must never do: return a credential value, a username or a TOTP seed —
// not even to the operator who owns them. A chat is a copy on someone else's
// server and in a notification database; the value must stay behind a browser
// session. There is no command for it, and no fallback that could grow into one.
//
// Every mutation is authorised by the Shared Secret requirement (the webhook
// secret plus a chat-id allowlist) and recorded in the audit log with source
// 'telegram', so a change made from a phone is as traceable as one made in the
// console.

// Parse a command. Returns { verb, args } or null for free text.
export function parseCommand(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const cleaned = raw.replace(/^\//, '')
  const [verb, ...rest] = cleaned.split(/\s+/)
  return { verb: String(verb || '').toLowerCase(), args: rest, text: raw }
}

// The help text. Deliberately states what it cannot do, so nobody asks it for a
// password and assumes a failure means the feature is broken.
export const TELEGRAM_HELP = [
  '控制台命令（不会返回任何密钥值）：',
  '/pending — 列出待审批请求',
  '/approve <请求号> [once|1h|24h|7d|always] — 批准',
  '/deny <请求号> — 拒绝',
  '/grants — 列出授权及状态',
  '/extend <agent> <条目> <天数|permanent> — 延长授权',
  '/revoke <agent> <条目> [action] — 撤销授权',
  '/status — 概览',
  '/asksettings — 查看自动审批规则',
  '/auto <agent|*> <时长> <分钟> — 让某 Agent 的请求在 N 分钟内自动批准',
  '/auto off — 关闭自动审批',
  '',
  '直接发文字会交给 AI 助手回答（只读）。',
  '我不能读取、复制或分享密钥值，这不在能力范围内。',
].join('\n')

// A short prefix for a pending entry, so /approve takes a number rather than a
// uuid the operator cannot type on a phone.
export function pendingHandle(entry, index) {
  return '#' + (index + 1)
}

export function formatPendingList(state) {
  const entries = Object.values(state.pending ?? {})
  if (!entries.length) return '没有待审批请求。'
  const lines = entries.slice(0, 20).map((entry, index) => {
    const action = entry.action === 'secret.fill' ? '网页填充' : entry.action === 'secret.use' ? '代持调用' : '读取明文'
    return pendingHandle(entry, index) + ' ' + entry.agent + ' → ' + entry.name + '（' + action + '）'
  })
  return '待审批：\n' + lines.join('\n') + (entries.length > 20 ? '\n…还有 ' + (entries.length - 20) + ' 条' : '') + '\n\n用 /approve #1 或 /deny #1。'
}

export function formatGrants(state) {
  const now = Date.now()
  const caps = Object.values(state.capabilities ?? {})
  if (!caps.length) return '还没有任何授权。'
  const actionLabel = { 'secret.read': '读明文', 'secret.use': '代持', 'secret.fill': '填充' }
  const lines = caps.slice(-20).map((cap) => {
    const status = cap.revokedAt ? '已撤销' : (cap.expiresAt && cap.expiresAt <= now ? '已过期' : '有效')
    const when = cap.expiresAt ? new Date(cap.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '永久'
    return cap.subjectId + ' → ' + cap.itemName + '　' + (actionLabel[cap.action] || cap.action) + '　' + status + '　' + when
  })
  return '授权（最近 ' + lines.length + ' 条）：\n' + lines.join('\n')
}

export function formatStatus(state) {
  const now = Date.now()
  const pending = Object.keys(state.pending ?? {}).length
  const agents = Object.keys(state.agents ?? {}).length
  const items = Object.keys(state.itemIds ?? {}).length
  const expired = Object.values(state.capabilities ?? {}).filter((cap) => !cap.revokedAt && cap.expiresAt && cap.expiresAt <= now).length
  const denied = Object.keys(state.deniedAttempts ?? {}).length
  return ['概览：', 'Agent ' + agents + ' 个，条目 ' + items + ' 个', '待审批 ' + pending + ' 条', '已过期授权 ' + expired + ' 条', '被拦下的请求 ' + denied + ' 类'].join('\n')
}

// Resolve '#1' or a raw id to a pending entry.
export function resolvePending(state, handle) {
  const entries = Object.values(state.pending ?? {})
  const text = String(handle ?? '').trim()
  const numbered = /^#?(\d+)$/.exec(text)
  if (numbered) {
    const index = Number(numbered[1]) - 1
    return entries[index] ?? null
  }
  return entries.find((entry) => entry.id === text) ?? null
}

// The auto-approval rule: while it is live, a request from the named agent (or
// from anyone, for '*') is approved without asking. It is time-boxed because an
// unbounded one is a standing grant nobody remembers.
export function autoRuleActive(state, agent, now = Date.now()) {
  const rule = state.settings?.telegramAuto
  if (!rule || rule.until <= now) return null
  if (rule.agent !== '*' && rule.agent !== agent) return null
  return rule
}

export function describeAutoRule(state, now = Date.now()) {
  const rule = state.settings?.telegramAuto
  if (!rule || rule.until <= now) return '自动审批：关闭'
  const minutesLeft = Math.max(0, Math.round((rule.until - now) / 60000))
  return '自动审批：' + (rule.agent === '*' ? '所有 Agent' : rule.agent) + ' 的请求，还剩 ' + minutesLeft + ' 分钟'
}
