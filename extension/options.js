const DEFAULTS = { brokerUrl: '', executorId: '', executorSecret: '', pollSeconds: 5, enabled: true }
const $ = (id) => document.getElementById(id)

function setStatus(message, kind) {
  const el = $('status')
  el.textContent = message
  el.className = 'status ' + (kind || '')
}

async function load() {
  const values = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) }
  for (const key of ['brokerUrl', 'executorId', 'executorSecret', 'pollSeconds']) $(key).value = values[key]
  $('enabled').checked = values.enabled !== false
}

$('save').onclick = async () => {
  const brokerUrl = $('brokerUrl').value.trim()
  const executorId = $('executorId').value.trim()
  const executorSecret = $('executorSecret').value.trim()
  if (!brokerUrl || !executorId || !executorSecret) return setStatus('三项都要填', 'err')
  try { new URL(brokerUrl) } catch { return setStatus('Broker 地址不是合法 URL', 'err') }
  const pollSeconds = Math.max(3, Math.min(60, Number($('pollSeconds').value) || 5))
  const enabled = $('enabled').checked
  await chrome.storage.local.set({ brokerUrl, executorId, executorSecret, pollSeconds, enabled })
  // Re-arm the alarm with the interval just saved; the worker only reads settings.
  await chrome.alarms.clear('poll')
  if (enabled) chrome.alarms.create('poll', { periodInMinutes: Math.max(0.5, pollSeconds / 60) })
  setStatus('已保存', 'ok')
}

$('test').onclick = async () => {
  const brokerUrl = $('brokerUrl').value.trim()
  const executorId = $('executorId').value.trim()
  const executorSecret = $('executorSecret').value.trim()
  if (!brokerUrl || !executorId || !executorSecret) return setStatus('三项都要填', 'err')
  setStatus('测试中…')
  try {
    // claim with no task waiting is the cheapest authenticated call: 200 with
    // {status:'idle'} means the credentials are accepted.
    const response = await fetch(brokerUrl.replace(/\/$/, '') + '/api/fill/tasks/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fill-executor-id': executorId, 'x-fill-executor-secret': executorSecret },
      body: '{}',
    })
    if (response.status === 401) return setStatus('凭据被拒绝：检查执行器 ID 和密钥', 'err')
    if (!response.ok) return setStatus('Broker 返回 ' + response.status, 'err')
    const payload = await response.json().catch(() => ({}))
    if (payload?.taskId) setStatus('连接正常（正好有一个任务在等待）', 'ok')
    else setStatus('连接正常，当前没有待填任务', 'ok')
  } catch (error) { setStatus('连不上：' + error.message, 'err') }
}

load()
