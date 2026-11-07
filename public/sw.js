// Web Push payload: the Worker sends an encrypted JSON body (RFC 8291,
// aes128gcm), so the notification is rendered from the push itself. The older
// empty-payload path had to fetch /api/state first; that request needs a live
// session and a reachable network, so a background push could wake the worker
// and then show nothing. The fetch stays as a fallback for a push queued before
// the upgrade.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function readPayload(event) {
  if (!event.data) return null
  try { return event.data.json() } catch {}
  try { return { body: event.data.text() } } catch { return null }
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const payload = readPayload(event)
    let title = String(payload?.title || '')
    let body = String(payload?.body || '')
    let target = String(payload?.url || '/#pending')
    if (!body) {
      title = 'Secrets Broker'
      body = '有新的授权请求，点击查看'
      target = '/#pending'
      try {
        const response = await fetch('/api/state', { cache: 'no-store', headers: { accept: 'application/json' } })
        if (response.ok) {
          const state = await response.json()
          // A first connection is an approval too, and it used to be invisible
          // here because only item requests were read. Prefer the connection
          // queue; fall back to the item queue when none is waiting.
          const connection = ((state.connections || {}).pending || [])[0]
          const pending = (state.pending || [])[0]
          if (connection) {
            title = 'Secrets Broker 连接请求'
            body = `${connection.agent || 'Agent'} 请求首次连接，点击打开待审批面板`
          } else if (pending) {
            title = 'Secrets Broker 授权请求'
            body = `${pending.agent || 'Agent'} 请求读取「${pending.name || ''}」`
          }
        }
        // A 401 or any other failure keeps the generic text above: the session
        // is gone, so naming an agent or item would leak to the lock screen.
      } catch {}
    }
    await self.registration.showNotification(title, {
      body,
      icon: '/logo.png',
      badge: '/logo.png',
      tag: 'secrets-broker-pending',
      renotify: true,
      data: { url: target },
    })
    // An open console must not wait for its next poll to show the new row:
    // tell every tab to refresh the queue now.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) client.postMessage({ type: 'secrets-broker:pending' })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) {
      await existing.focus()
      if ('navigate' in existing) await existing.navigate(target)
      return
    }
    await self.clients.openWindow(target)
  })())
})
