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

// Fires when a notification arrives while the app tab is closed or in the background — this
// is the actual "show a popup on the phone" step.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'TROCA-MISTO';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, {
    body: body,
    icon: undefined, // no shared icon file to point to yet — the browser falls back to a default
  });
});
