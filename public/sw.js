// Empty Web Push payload: read the waiting approval with the operator's
// existing session instead of carrying encrypted data in the push message.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let title = 'Secrets Broker'
    let body = '有新的授权请求，点击查看'
    try {
      const response = await fetch('/api/state', { cache: 'no-store', headers: { accept: 'application/json' } })
      if (response.ok) {
        const state = await response.json()
        const pending = (state.pending || [])[0]
        if (pending) {
          title = 'Secrets Broker 授权请求'
          body = `${pending.agent || 'Agent'} 请求读取「${pending.name || ''}」`
        }
      }
    } catch {}
    await self.registration.showNotification(title, {
      body,
      icon: '/logo.png',
      tag: 'secrets-broker-pending',
      data: { url: '/#pending' },
    })
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
