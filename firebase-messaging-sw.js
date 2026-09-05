// Service worker ini yang bikin notifikasi tetap muncul walau app KOMSOS
// lagi ditutup/tidak dibuka. File ini WAJIB ada persis di alamat
// https://<domain-kamu>/firebase-messaging-sw.js (root situs, bukan di
// dalam folder), karena Firebase mencarinya di situ secara otomatis.

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAG9tME0DyBqHsZi-rGjolO27NqXD0nanM",
  authDomain: "komsos-keluarga-kudus.firebaseapp.com",
  projectId: "komsos-keluarga-kudus",
  storageBucket: "komsos-keluarga-kudus.firebasestorage.app",
  messagingSenderId: "579282641548",
  appId: "1:579282641548:web:f0ec3583d726f650c2d1a9"
});

const messaging = firebase.messaging();

// Ini yang jalan kalau app lagi ketutup / HP lagi dikunci —
// notifikasi + bunyi default HP otomatis muncul dari sini.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'Pengingat KOMSOS';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, {
    body,
    vibrate: [200, 100, 200],
    tag: 'komsos-pengingat',
  });
});
