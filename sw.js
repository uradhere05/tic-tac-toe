// FILO Gang Arena — Push Service Worker

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const { title, body } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title || 'FILO Arena', {
      body:     body || '',
      icon:     '/icon-192.png',
      badge:    '/icon-192.png',
      tag:      'arena-chat',
      renotify: true,
      vibrate:  [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/index.html'));
});
