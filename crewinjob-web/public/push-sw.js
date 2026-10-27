// Ryzevo phone notifications. Pushes carry no data, so the notice is fixed and names no project, person or message.
self.addEventListener('push', event => {
  const tr = (self.navigator.language || 'tr').toLowerCase().startsWith('tr');
  event.waitUntil(self.registration.showNotification('Ryzevo', {
    body: tr ? 'Projelerinizden birinde size ait yeni bir konu var.' : 'Something new needs you in one of your projects.',
    icon: '/brand/ryzevo-app-192.png', tag: 'ryzevo-attention', renotify: true,
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const open = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (open) return open.navigate('/portfolio').then(client => (client || open).focus());
    return self.clients.openWindow('/portfolio');
  }));
});
