const admin = require('firebase-admin');

// Kredensial diambil dari Environment Variable di Netlify (FIREBASE_SERVICE_ACCOUNT),
// sama seperti yang dipakai cek-pengingat.js — tidak ditulis langsung di kode ini.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();
const USERS_COLLECTION = 'komsos-users';

// Dipanggil dari tombol "Kirim Sekarang" di halaman utama (khusus PJ).
// Fungsinya: kirim SATU notifikasi uji coba ke SEMUA HP yang sudah pernah
// menekan "Aktifkan Notifikasi" — dipakai untuk demo/presentasi supaya
// tidak perlu menunggu jam pengingat asli.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // 1. Pastikan yang memanggil ini benar-benar sudah login (verifikasi token Firebase Auth).
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const idToken = authHeader.replace('Bearer ', '').trim();
    if (!idToken) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Kamu belum login.' }) };
    }
    const decoded = await admin.auth().verifyIdToken(idToken);

    // 2. Pastikan yang memanggil ini memang PJ (role: 'editor'), bukan viewer biasa.
    const callerDoc = await db.collection(USERS_COLLECTION).doc(decoded.uid).get();
    const callerData = callerDoc.exists ? callerDoc.data() : null;
    if (!callerData || callerData.role !== 'editor') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Hanya PJ yang boleh mengirim notifikasi uji coba.' }) };
    }

    // 3. Kumpulkan semua token HP dari semua akun yang pernah aktifkan notifikasi.
    const usersSnap = await db.collection(USERS_COLLECTION).get();
    let tokens = [];
    usersSnap.forEach(doc => {
      const t = doc.data().fcmTokens || [];
      tokens = tokens.concat(t);
    });
    tokens = [...new Set(tokens)]; // buang duplikat

    if (tokens.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ terkirim: 0, pesan: 'Belum ada satu pun HP yang mengaktifkan notifikasi.' }),
      };
    }

    // 4. Kirim ke semua sekaligus.
    // "webpush.notification" menjaga perilaku notifikasi web (getar & tetap tampil
    // sampai disentuh) walau sekarang yang menampilkan adalah Firebase SDK, bukan
    // service worker kita (supaya tidak dobel).
    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: '🔔 Uji Coba Notifikasi KOMSOS',
        body: 'Kalau HP kamu bunyi & notifikasi ini muncul, sistemnya berhasil! 🎉',
      },
      android: {
        notification: { channelId: 'komsos-pengingat' },
      },
      webpush: {
        notification: {
          requireInteraction: true,
          vibrate: [200, 100, 200],
          tag: 'komsos-uji-coba', // notifikasi uji coba berikutnya menggantikan yang lama
        },
      },
    });

    // 5. Bersihkan token HP yang sudah mati (aplikasi dihapus / izin dicabut /
    //    token lama setelah diperbarui), supaya daftar token tidak menumpuk.
    const tokenMati = [];
    resp.responses.forEach((r, i) => {
      if (!r.success && r.error) {
        const kode = r.error.code;
        if (kode === 'messaging/registration-token-not-registered' ||
            kode === 'messaging/invalid-registration-token') {
          tokenMati.push(tokens[i]);
        }
      }
    });
    if (tokenMati.length) {
      const ops = [];
      usersSnap.forEach(doc => {
        const punya = (doc.data().fcmTokens || []).filter(t => tokenMati.includes(t));
        if (punya.length) {
          ops.push(doc.ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...punya) }));
        }
      });
      await Promise.all(ops);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ terkirim: resp.successCount, gagal: resp.failureCount, dibersihkan: tokenMati.length }),
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
