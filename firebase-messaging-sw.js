// This file runs in the background, separate from the main app page — it's what lets a
// notification actually show up even when the app tab isn't open at all. It needs to be
// uploaded to GitHub alongside index.html, at the root of the repo (not inside a folder),
// since that's the only location a service worker is allowed to control the whole site from.

importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDVJE3FwFC7mYuygtvZXPAzf6xYWgkLTMM",
  authDomain: "troca-misto.firebaseapp.com",
  projectId: "troca-misto",
  storageBucket: "troca-misto.firebasestorage.app",
  messagingSenderId: "418787038493",
  appId: "1:418787038493:web:cb451df73d8433bbf47df4",
  measurementId: "G-FGXSXVX4QV"
});

const messaging = firebase.messaging();

// Without these two, a genuinely updated service worker file sits idle in a "waiting" state
// until every open tab of the site is fully closed — which is exactly why this update (and
// any future one) might not seem to take effect right away just from a normal refresh.
// skipWaiting activates the new version immediately after installing, and clients.claim takes
// over any already-open tabs right away too, instead of only affecting tabs opened afterward.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Fires when a notification arrives while the app tab is closed or in the background — this
// is the actual "show a popup on the phone" step. Reading from payload.data (not
// payload.notification) is deliberate — see the matching comment in the Cloud Function for
// why: a "notification" field there would make the browser display its own automatic,
// generic-icon notification in addition to this explicit one.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.data && payload.data.title) || 'TROCA-MISTO';
  const body = (payload.data && payload.data.body) || '';
  self.registration.showNotification(title, {
    body: body,
    icon: '/main_icon_circle_transparent.png',
  });
});
