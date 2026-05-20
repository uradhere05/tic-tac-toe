// Firebase Messaging Service Worker
// Must live at root so it controls the full scope.

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// ── FILL IN after getting config from Firebase Console ──
firebase.initializeApp({
  apiKey:            'REPLACE_apiKey',
  authDomain:        'REPLACE_authDomain',
  databaseURL:       'https://filo-gang-tictactoe-default-rtdb.firebaseio.com',
  projectId:         'REPLACE_projectId',
  storageBucket:     'REPLACE_storageBucket',
  messagingSenderId: 'REPLACE_messagingSenderId',
  appId:             'REPLACE_appId'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const title = n.title || 'FILO Arena';
  const body  = n.body  || '';
  self.registration.showNotification(title, {
    body,
    icon:      '/icon-192.png',
    badge:     '/icon-192.png',
    tag:       'arena-chat',
    renotify:  true,
    vibrate:   [200, 100, 200]
  });
});
