#!/usr/bin/env node
// Fill executor: the only component that ever holds a credential value in the
// clear. It polls the broker for an authorised fill task, redeems it, drives a
// real browser to the exact authorised origin, submits the login and reports the
// outcome. The Agent never sees the value; the broker never renders a page.
//
// Why this is not a Worker: a Worker has no DOM, no cookie jar, no CDP. This has
// to be a process that can run a browser, so it runs in Docker beside your vault.
//
//   BROKER_URL=https://sb.otscup.com \
//   EXECUTOR_ID=home \
//   EXECUTOR_SECRET=<shown once when registered> \
//   node fill-executor.mjs
//
// Register the executor first, in the broker console or with curl:
//   POST /api/fill/executors/register   {"executorId":"home"}
//   -> { executorId, secret }           (the secret is shown once)
// Playwright is an optional dependency: the Worker does not need it, only this
// file does. A missing install is a setup error, so say so instead of crashing
// with a bare module-not-found.
let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.error('playwright is not installed. Run: npm install playwright && npx playwright install chromium')
  console.error('or use the Docker image: docker compose -f deploy/executor-compose.yml up -d')
  process.exit(1)
}

const BROKER = String(process.env.BROKER_URL || '').replace(/\/$/, '')
const EXECUTOR_ID = String(process.env.EXECUTOR_ID || '').trim()
const SECRET = String(process.env.EXECUTOR_SECRET || '').trim()
const POLL_MS = Math.max(1000, Number(process.env.POLL_MS) || 3000)
// A task may not wander: every navigation and the final submit are re-checked
// against the origin the broker authorised.
const NAV_TIMEOUT = Math.max(5000, Number(process.env.NAV_TIMEOUT_MS) || 20000)
const HEADLESS = process.env.HEADLESS !== '0'
const LOG = (...args) => console.log(new Date().toISOString(), ...args)

if (!BROKER || !EXECUTOR_ID || !SECRET) {
  console.error('BROKER_URL, EXECUTOR_ID and EXECUTOR_SECRET are required')
  process.exit(1)
}

let running = true
const stop = () => { running = false; LOG('stopping after the current task') }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

async function broker(path, body) {
  const response = await fetch(BROKER + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fill-executor-id': EXECUTOR_ID,
      'x-fill-executor-secret': SECRET,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body: payload }
}

// The origin is the whole security boundary: only scheme + host + port, exactly
// as the broker authorised it. A redirect to another host is refused, not
// followed.
function originOf(value) {
  try {
    const url = new URL(String(value))
    if (url.username || url.password) return ''
    return url.origin.toLowerCase()
  } catch { return '' }
}

// A login form is matched by its visible shape, not by a site-specific selector:
// a password input and the text field closest before it. This is the same
// heuristic password managers use; a site with an unusual form fails loudly
// rather than silently filling the wrong field.
async function findLoginForm(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    const passwords = [...document.querySelectorAll('input[type=password]')].filter(visible)
    if (!passwords.length) return null
    const password = passwords[0]
    const all = [...document.querySelectorAll('input')].filter(visible)
    const before = all.slice(0, all.indexOf(password))
    const username = before.reverse().find((el) =>
      ['text', 'email', 'tel', ''].includes(String(el.type || '').toLowerCase())
      && el.name !== 'search' && el.id !== 'search') || null
    const form = password.form || document.body
    const submit = form.querySelector('button[type=submit], input[type=submit], button:not([type])')
    return {
      hasPassword: true,
      hasUsername: Boolean(username),
      hasSubmit: Boolean(submit),
    }
  })
}

async function fillLogin(page, origin, username, password) {
  const shape = await findLoginForm(page)
  if (!shape) return { ok: false, errorCode: 'no-password-field' }

  // Fill by the same rule the probe used, then verify the page is still on the
  // authorised origin before submitting: a form can navigate on input.
  await page.evaluate(({ user, pass }) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    const passwords = [...document.querySelectorAll('input[type=password]')].filter(visible)
    const passwordEl = passwords[0]
    if (!passwordEl) return
    const all = [...document.querySelectorAll('input')].filter(visible)
    const before = all.slice(0, all.indexOf(passwordEl))
    const userEl = before.reverse().find((el) =>
      ['text', 'email', 'tel', ''].includes(String(el.type || '').toLowerCase())
      && el.name !== 'search' && el.id !== 'search') || null
    const set = (el, value) => {
      // React and Vue track the previous value; a plain assignment is ignored.
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
      if (setter) setter.call(el, value); else el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (userEl && user) set(userEl, user)
    set(passwordEl, pass)
  }, { user: username, pass: password })

  if (originOf(page.url()) !== origin) return { ok: false, errorCode: 'origin-moved-before-submit', redirected: true }

  const submitted = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const passwords = [...document.querySelectorAll('input[type=password]')].filter(visible)
    const form = passwords[0]?.form
    const submit = form?.querySelector('button[type=submit], input[type=submit], button:not([type])')
    if (submit) { submit.click(); return true }
    if (form) { form.requestSubmit?.(); return true }
    return false
  })
  if (!submitted) return { ok: false, errorCode: 'no-submit' }
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {})

  const finalOrigin = originOf(page.url())
  // A login usually navigates within the same origin. Leaving it is reported,
  // never silently accepted as success.
  if (finalOrigin !== origin) return { ok: false, errorCode: 'origin-moved-after-submit', redirected: true, finalOrigin }

  // Still a password field visible and no navigation: likely a wrong password.
  const stillThere = await findLoginForm(page)
  const captcha = await page.evaluate(() => {
    const text = document.body?.innerText?.slice(0, 4000) || ''
    return /captcha|recaptcha|hcaptcha|验证码|人机验证/i.test(text)
  }).catch(() => false)
  if (captcha) return { ok: false, errorCode: 'captcha', captcha: true, finalOrigin }
  if (stillThere?.hasPassword) return { ok: false, errorCode: 'login-not-accepted', finalOrigin }
  return { ok: true, finalOrigin }
}

async function runTask(task) {
  const origin = originOf(task.origin)
  if (!origin) return { state: 'failed', errorCode: 'bad-origin' }

  // Redeem first: the credential is short lived and bound to this task, this
  // executor and this origin. A failed redemption must not start a browser.
  const redeemed = await broker('/api/fill/task/redeem', { taskId: task.taskId, credential: task.credential })
  if (!redeemed.ok) return { state: 'failed', errorCode: 'redeem-' + (redeemed.body?.error ?? redeemed.status) }
  const { username, password, totp } = redeemed.body ?? {}
  if (!password) return { state: 'failed', errorCode: 'no-credential' }

  await broker('/api/fill/tasks/report', { taskId: task.taskId, state: 'running' })

  // A fresh context per task, destroyed afterwards: no cookie jar survives into
  // the next login, and nothing from this one can be replayed.
  const browser = await chromium.launch({ headless: HEADLESS, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 1280, height: 900 } })
  try {
    // No request leaves the container except for the authorised origin. This is
    // the isolation rule from the contract, enforced by the browser itself.
    await context.route('**/*', (route) => {
      const target = originOf(route.request().url())
      // data:/blob: have no origin and are same-document.
      if (!target || target === origin) return route.continue()
      return route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(NAV_TIMEOUT)
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
    if (originOf(page.url()) !== origin) return { state: 'failed', errorCode: 'redirect-on-load', redirected: true }

    const probe = await findLoginForm(page)
    // A page with no form yet (SPA still booting): give it one more beat.
    if (!probe) await page.waitForSelector('input[type=password]', { timeout: 5000 }).catch(() => {})
    const outcome = await fillLogin(page, origin, username, password)
    if (!outcome.ok) return { state: 'failed', errorCode: outcome.errorCode, redirected: outcome.redirected === true, captcha: outcome.captcha === true, finalOrigin: outcome.finalOrigin }
    // TOTP is not entered: a code that expires in 30 seconds cannot be carried
    // across an arbitrary login page reliably, and guessing the second field is
    // how a login gets submitted with the code in the password box.
    return { state: 'completed', outcome: totp ? 'filled-without-totp' : 'filled', finalOrigin: outcome.finalOrigin }
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function poll() {
  while (running) {
    const claimed = await broker('/api/fill/tasks/claim', {}).catch(() => null)
    if (!claimed?.ok || !claimed.body?.taskId) {
      if (claimed && claimed.status === 401) {
        // The secret was rotated or revoked; retrying will not help.
        console.error('executor credentials rejected; stopping')
        return
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
      continue
    }
    const task = claimed.body
    LOG('task', task.taskId, task.origin, task.action)
    let report
    try { report = await runTask(task) } catch (error) { report = { state: 'failed', errorCode: 'executor-error:' + String(error.message ?? error).slice(0, 80) } }
    const sent = await broker('/api/fill/tasks/report', { taskId: task.taskId, ...report }).catch(() => ({ ok: false }))
    LOG('task', task.taskId, '->', report.state, report.errorCode ?? '', sent.ok ? '' : '(report failed)')
  }
}

LOG('fill executor', EXECUTOR_ID, 'polling', BROKER, 'headless=' + HEADLESS)
await poll()
