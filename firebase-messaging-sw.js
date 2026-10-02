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

// Ini yang jalan kalau app lagi ketutup / HP lagi dikunci.
//
// PENYEBAB NOTIFIKASI DOBEL (sudah diperbaiki di sini):
// Kalau pesan dari server punya bagian "notification" (title + body), Firebase SDK
// SUDAH menampilkan notifikasinya sendiri secara otomatis sebelum fungsi ini jalan.
// Kalau di sini kita memanggil showNotification() lagi, hasilnya DUA notifikasi.
// Jadi: kalau pesannya sudah punya "notification", fungsi ini tidak melakukan apa-apa.
// Kita hanya menampilkan manual untuk pesan "data saja" (tanpa bagian notification).
//
// CATATAN soal suara: Web Push API tidak mengizinkan suara custom untuk notifikasi
// saat app tertutup/HP terkunci. Suara bel custom hanya bunyi kalau app sedang
// terbuka (lihat playNotifSound() di index.html).
messaging.onBackgroundMessage((payload) => {
  if (payload && payload.notification) return; // sudah ditampilkan otomatis oleh SDK

  const data = (payload && payload.data) || {};
  const title = data.title || 'Pengingat KOMSOS';
  const body = data.body || '';
  self.registration.showNotification(title, {
    body,
    vibrate: [200, 100, 200],
    tag: data.tag || 'komsos-pengingat',
    requireInteraction: true,
    renotify: true,
  });
});

// Waktu notifikasi di-tap: kalau tab KOMSOS sudah terbuka, fokuskan itu;
// kalau belum ada, buka tab baru ke halaman utama.
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
