importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyD0Dch5D-QVye33lj5NcdQ19aGGuhPEVAo",
  authDomain: "amigo-invisible-c1e5a.firebaseapp.com",
  projectId: "amigo-invisible-c1e5a",
  storageBucket: "amigo-invisible-c1e5a.firebasestorage.app",
  messagingSenderId: "226478486459",
  appId: "1:226478486459:web:c8627858a8ab8f77eb8a9e"
});

// Mensajes solo de datos: aquí se muestra la notificación (así funciona igual en Android, escritorio e iPhone)
firebase.messaging().onBackgroundMessage(payload => {
  const d = payload.data || {};
  return self.registration.showNotification(d.title || '🎁 Amigo Invisible', {
    body: d.body || 'Tienes un mensaje nuevo',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'amigo-mensaje',
    renotify: true,
    data: { url: d.url || self.registration.scope },
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c && c.url.split('#')[0] === url.split('#')[0]) return c.focus();
    return clients.openWindow(url);
  }));
});
