const admin = require('firebase-admin');
const { kirimNotifikasi } = require('./lib/tokens');

// Kredensial diambil dari Environment Variable di Netlify (FIREBASE_SERVICE_ACCOUNT),
// tidak ditulis langsung di kode ini.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();
const USERS_COLLECTION = 'komsos-users';

// Dipanggil dari tombol "Kirim Sekarang" (khusus PJ). Mengirim SATU notifikasi uji
// coba ke semua orang yang sudah mengaktifkan notifikasi. Tiap orang hanya dikirimi
// ke SATU jenis perangkat (APK diutamakan, lalu browser), supaya tidak dobel.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // 1. Pastikan pemanggil sudah login.
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const idToken = authHeader.replace('Bearer ', '').trim();
    if (!idToken) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Kamu belum login.' }) };
    }
    const decoded = await admin.auth().verifyIdToken(idToken);

    // 2. Pastikan pemanggil adalah PJ (role: 'editor').
    const callerDoc = await db.collection(USERS_COLLECTION).doc(decoded.uid).get();
    const callerData = callerDoc.exists ? callerDoc.data() : null;
    if (!callerData || callerData.role !== 'editor') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Hanya PJ yang boleh mengirim notifikasi uji coba.' }) };
    }

    // 3. Kirim (pemilihan jenis perangkat & pembersihan token mati ada di lib/tokens.js).
    const usersSnap = await db.collection(USERS_COLLECTION).get();
    const hasil = await kirimNotifikasi({
      admin,
      messaging: admin.messaging(),
      usersSnap,
      pesan: {
        notification: {
          title: '🔔 Uji Coba Notifikasi KOMSOS',
          body: 'Kalau HP kamu bunyi & notifikasi ini muncul, sistemnya berhasil! 🎉',
        },
        android: { notification: { channelId: 'komsos-pengingat' } },
        webpush: {
          notification: {
            requireInteraction: true,
            vibrate: [200, 100, 200],
            tag: 'komsos-uji-coba',
          },
        },
      },
    });

    // Catatan ke log Netlify (tanpa menampilkan token).
    console.log('[test-notifikasi] ringkasan:', JSON.stringify(hasil));

    if (hasil.terkirim === 0 && hasil.akunDilayani === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ...hasil, pesan: 'Belum ada satu pun HP yang mengaktifkan notifikasi.' }),
      };
    }
    return { statusCode: 200, body: JSON.stringify(hasil) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
