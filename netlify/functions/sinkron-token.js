const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();
const USERS_COLLECTION = 'komsos-users';

// Dipanggil dari tombol "Aktifkan Notifikasi". Tujuannya: pastikan SATU token
// (= satu HP/browser) cuma nempel ke SATU akun yang lagi aktif di HP itu.
//
// Kenapa ini perlu: kalau HP yang sama pernah dipakai login akun lain, dan token
// push-nya (yang levelnya per-browser, bukan per-akun) masih tersimpan di akun
// lama itu, server pengingat akan mengirim notifikasi ke KEDUA akun sekaligus
// untuk satu kejadian yang sama — makanya orang bisa dapat notifikasi dobel.
//
// Jadi tiap kali "Aktifkan Notifikasi" ditekan: hapus dulu token ini dari semua
// akun LAIN (bukan akun yang sedang login), baru simpan ke akun yang aktif ini.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const idToken = authHeader.replace('Bearer ', '').trim();
    if (!idToken) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Kamu belum login.' }) };
    }
    const decoded = await admin.auth().verifyIdToken(idToken);

    const body = JSON.parse(event.body || '{}');
    const token = body.token;
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Token kosong.' }) };
    }

    // Cari SEMUA akun yang kebetulan masih menyimpan token ini.
    const snap = await db.collection(USERS_COLLECTION).where('fcmTokens', 'array-contains', token).get();
    const ops = [];
    snap.forEach((doc) => {
      if (doc.id !== decoded.uid) {
        ops.push(
          db.collection(USERS_COLLECTION).doc(doc.id).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(token),
          })
        );
      }
    });
    await Promise.all(ops);

    // Baru simpan ke akun yang sedang login sekarang.
    await db.collection(USERS_COLLECTION).doc(decoded.uid).set(
      { fcmTokens: admin.firestore.FieldValue.arrayUnion(token) },
      { merge: true }
    );

    return { statusCode: 200, body: JSON.stringify({ ok: true, dibersihkanDariAkunLain: ops.length }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
