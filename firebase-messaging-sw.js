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
// notifikasi otomatis muncul dari sini, termasuk di layar kunci.
// CATATAN PENTING soal suara: Web Push API (standar yang dipakai semua
// browser, bukan cuma Firebase) TIDAK mengizinkan file suara custom untuk
// notifikasi yang muncul saat app tertutup/HP terkunci — browser hanya
// boleh memutar suara notifikasi BAWAAN sistem Android/HP kamu di kondisi
// ini. Suara bel custom yang kamu upload HANYA bisa berbunyi kalau app-nya
// sedang terbuka di layar (lihat playNotifSound() di index.html) — itu
// sudah cukup untuk skenario presentasi karena HP kalian akan dibuka.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'Pengingat KOMSOS';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, {
    body,
    vibrate: [200, 100, 200],
    tag: 'komsos-pengingat-' + Date.now(), // tag unik biar tidak menimpa notifikasi sebelumnya
    requireInteraction: true, // notifikasi tetap nongol sampai disentuh, tidak hilang sendiri
    renotify: true,
  });
});

// Tanpa ini, waktu notifikasi di-tap (di layar kunci / notification tray),
// nggak ada yang ngatur "abis di-tap, buka app-nya" — perilakunya jadi
// nggak konsisten antar-HP/browser. Sekarang: kalau tab KOMSOS udah kebuka
// di suatu tempat, itu yang difokuskan (bukan buka tab baru); kalau belum
// ada sama sekali, baru dibukain tab baru ke halaman utama.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
