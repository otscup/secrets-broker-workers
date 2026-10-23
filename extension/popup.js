const $ = (id) => document.getElementById(id)
const DEFAULTS = { brokerUrl: '', executorId: '', executorSecret: '', enabled: true }

async function render() {
  const values = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) }
  const configured = Boolean(values.brokerUrl && values.executorId && values.executorSecret)
  $('state').textContent = !configured
    ? '还没配置。点下面的「设置」填入 Broker 地址和执行器凭据。'
    : values.enabled === false ? '已暂停：不会领取新任务。' : '运行中：有新任务时会自动填充。'
  $('toggle').textContent = values.enabled === false ? '启用' : '暂停'
  $('toggle').className = values.enabled === false ? 'primary' : ''
}

$('check').onclick = async () => {
  const out = $('result')
  out.textContent = '检查中…'
  try {
    // chrome.runtime.sendMessage resolves only if the worker answers; a rejected
    // promise means the service worker is asleep and will be woken by the call.
    const reply = await chrome.runtime.sendMessage({ type: 'poll-now' })
    out.textContent = reply?.text || '没有回应'
  } catch (error) { out.textContent = '出错：' + error.message }
}

$('toggle').onclick = async () => {
  const current = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) }
  await chrome.storage.local.set({ enabled: current.enabled === false })
  render()
}

$('open-options').onclick = () => chrome.runtime.openOptionsPage()

render()
