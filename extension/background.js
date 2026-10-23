// Secrets Broker Fill — background service worker.
//
// This is the fill executor, hosted by the browser you already run instead of a
// container. It polls the broker for an authorised fill task, redeems it, fills
// the login into a tab it opens, and reports the outcome. The Agent never sees
// the value; the value exists in this extension for one task.
//
// It is deliberately small: the security rules live here, not in the page.

const DEFAULTS = { brokerUrl: '', executorId: '', executorSecret: '', pollSeconds: 5, enabled: true }

async function settings() {
  const stored = await chrome.storage.local.get(DEFAULTS)
  return { ...DEFAULTS, ...stored }
}

async function rateLimited(key, perMinute) {
  const now = Date.now()
  const store = (await chrome.storage.local.get('rate:' + key))['rate:' + key] || { at: now, count: 0 }
  if (now - store.at > 60000) { store.at = now; store.count = 0 }
  store.count += 1
  await chrome.storage.local.set({ ['rate:' + key]: store })
  return store.count > perMinute
}

async function broker(path, body) {
  const { brokerUrl, executorId, executorSecret } = await settings()
  if (!brokerUrl || !executorId || !executorSecret) throw new Error('not-configured')
  const response = await fetch(brokerUrl.replace(/\/$/, '') + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fill-executor-id': executorId,
      'x-fill-executor-secret': executorSecret,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body: payload }
}

function originOf(value) {
  try {
    const url = new URL(String(value))
    if (url.username || url.password) return ''
    return url.origin.toLowerCase()
  } catch { return '' }
}

function notify(title, message) {
  try { chrome.notifications.create('', { type: 'basic', iconUrl: 'icon128.png', title, message: message.slice(0, 300) }) } catch {}
}

// The form heuristic is the same one the container executor uses and the same
// one password managers use: a visible password field, and the text field
// closest before it. No site-specific selectors.
function fillInPage(user, pass) {
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const passwords = [...document.querySelectorAll('input[type=password]')].filter(visible)
  if (!passwords.length) return { ok: false, errorCode: 'no-password-field' }
  const passwordEl = passwords[0]
  const all = [...document.querySelectorAll('input')].filter(visible)
  const before = all.slice(0, all.indexOf(passwordEl))
  const userEl = before.reverse().find((el) =>
    ['text', 'email', 'tel', ''].includes(String(el.type || '').toLowerCase())
    && el.name !== 'search' && el.id !== 'search') || null
  const set = (el, value) => {
    // React and Vue track the previous value and ignore a plain assignment, so
    // the native setter is used. It has to be the accessor that OWNS the
    // property: a page may define `value` on the element itself (some test
    // harnesses and a few widgets do), and taking the prototype's setter then
    // writes past it. Walk from the element up to the first owner.
    let owner = el
    let desc = null
    while (owner && !(desc = Object.getOwnPropertyDescriptor(owner, 'value'))) owner = Object.getPrototypeOf(owner)
    if (desc?.set) desc.set.call(el, value); else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  if (userEl && user) set(userEl, user)
  set(passwordEl, pass)
  return { ok: true }
}

// Run a script in a tab, returning its result. MV3 needs this indirection; the
// function is serialised, so it may not close over anything.
async function run(tabId, func, args) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args })
  return result?.result
}

async function fillTask(task) {
  const origin = originOf(task.origin)
  if (!origin) return { state: 'failed', errorCode: 'bad-origin' }

  // Poll only when a vault session exists; a locked broker answers 423 and the
  // task dies, so asking first would burn the task.
  const redeemed = await broker('/api/fill/task/redeem', { taskId: task.taskId, credential: task.credential })
  if (!redeemed.ok) return { state: 'failed', errorCode: 'redeem-' + (redeemed.body?.error ?? redeemed.status) }
  const { username, password, totp } = redeemed.body ?? {}
  if (!password) return { state: 'failed', errorCode: 'no-credential' }

  await broker('/api/fill/tasks/report', { taskId: task.taskId, state: 'running' })

  const tab = await chrome.tabs.create({ url: origin, active: false })
  try {
    await waitForComplete(tab.id)
    const finalOrigin = originOf(tab.url)
    if (finalOrigin !== origin) return { state: 'failed', errorCode: 'redirect-on-load', redirected: true }

    const filled = await run(tab.id, fillInPage, [username, password])
    if (!filled?.ok) return { state: 'failed', errorCode: filled?.errorCode ?? 'fill-failed' }

    const submitted = await run(tab.id, () => {
      const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const passwords = [...document.querySelectorAll('input[type=password]')].filter(visible)
      const form = passwords[0]?.form
      const submit = form?.querySelector('button[type=submit], input[type=submit], button:not([type])')
      if (submit) { submit.click(); return true }
      if (form?.requestSubmit) { form.requestSubmit(); return true }
      return false
    })
    if (!submitted) return { state: 'failed', errorCode: 'no-submit' }

    // Give the page a beat to navigate, then judge by what it looks like.
    await new Promise((r) => setTimeout(r, 3000))
    const updated = await chrome.tabs.get(tab.id)
    const afterOrigin = originOf(updated.url)
    if (afterOrigin !== origin) return { state: 'failed', errorCode: 'origin-moved-after-submit', redirected: true, finalOrigin: afterOrigin }

    const verdict = await run(tab.id, () => {
      const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const text = document.body?.innerText?.slice(0, 4000) || ''
      const captcha = /captcha|recaptcha|hcaptcha|验证码|人机验证/i.test(text)
      const stillPassword = [...document.querySelectorAll('input[type=password]')].filter(visible).length > 0
      return { captcha, stillPassword }
    })
    if (verdict?.captcha) return { state: 'failed', errorCode: 'captcha', captcha: true, finalOrigin: afterOrigin }
    if (verdict?.stillPassword) return { state: 'failed', errorCode: 'login-not-accepted', finalOrigin: afterOrigin }
    return { state: 'completed', outcome: totp ? 'filled-without-totp' : 'filled', finalOrigin: afterOrigin }
  } finally {
    // A filled tab is left in place so the operator can use the session; the
    // value itself is never stored anywhere by this extension.
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {})
  }
}

function waitForComplete(tabId) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); resolve() }
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done() }
    chrome.tabs.onUpdated.addListener(listener)
    // A page that never fires complete must not hang the task forever.
    setTimeout(done, 20000)
  })
}

// Poll loop. chrome.alarms is the only timer an MV3 worker is guaranteed; a
// plain setInterval is killed when the worker sleeps. Chrome clamps a period
// below 30 seconds up to 30, so asking for 0.1 gets one tick per half minute —
// state it plainly rather than pretending it is faster. The popup's 立即检查
// button exists for the case where you do not want to wait.
const POLL_MINUTES = 0.5
chrome.alarms.create('poll', { periodInMinutes: POLL_MINUTES })

// One poll step, shared by the alarm and the popup's manual check. Returns a
// short human line so the popup can say what happened.
async function pollOnce() {
  const { enabled } = await settings()
  if (!enabled) return '已暂停'
  let claimed
  try { claimed = await broker('/api/fill/tasks/claim', {}) } catch (e) { return '连不上：' + e.message }
  if (claimed.status === 401) return '执行器凭据被拒绝'
  if (!claimed.ok) return 'Broker 返回 ' + claimed.status
  if (!claimed.body?.taskId) return '没有待填任务'
  const task = claimed.body
  notify('Secrets Broker', '正在为 ' + originOf(task.origin) + ' 填充登录信息')
  let report
  try { report = await fillTask(task) } catch (error) { report = { state: 'failed', errorCode: 'executor-error:' + String(error.message ?? error).slice(0, 60) } }
  await broker('/api/fill/tasks/report', { taskId: task.taskId, ...report }).catch(() => {})
  if (report.state === 'completed') { notify('Secrets Broker', '已填充 ' + originOf(task.origin)); return '已填充 ' + originOf(task.origin) }
  notify('Secrets Broker', '填充失败：' + (report.errorCode || report.state))
  return '填充失败：' + (report.errorCode || report.state)
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'poll-now') return false
  if (awaitRateLimited()) { sendResponse({ text: '太频繁，稍等一下' }); return true }
  pollOnce().then((text) => sendResponse({ text })).catch((error) => sendResponse({ text: '出错：' + error.message }))
  return true
})

// A manual click must not let a stuck script hammer the broker.
let lastManual = 0
function awaitRateLimited() {
  const now = Date.now()
  if (now - lastManual < 5000) return true
  lastManual = now
  return false
}
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'poll') return
  if (await rateLimited('poll', 30)) return
  await pollOnce()
})

// Opening the popup is the only way to reach the options page from the icon.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(DEFAULTS).then((values) => chrome.storage.local.set({ ...DEFAULTS, ...values }))
})
