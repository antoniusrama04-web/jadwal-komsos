const admin = require('firebase-admin');
const { hashToken, normalisasiPlatform, tambahToken } = require('./lib/tokens');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();
const USERS_COLLECTION = 'komsos-users';

// Dipanggil dari aplikasi (APK maupun browser) untuk menyimpan token notifikasi.
// Body: { token, platform }  ->  platform = 'android' (APK) atau 'web' (browser).
//
// 1. Satu token (= satu HP/browser) hanya boleh nempel ke SATU akun: dihapus dulu
//    dari akun lain.
// 2. Token disimpan lengkap dengan label jenisnya, dan tiap jenis dibatasi paling
//    banyak 2 token terbaru per akun, supaya token lama tidak menumpuk.
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
    if (!token || typeof token !== 'string') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Token kosong.' }) };
    }
    const platform = normalisasiPlatform(body.platform);

    // 1. Lepaskan token ini dari akun LAIN.
    const snap = await db.collection(USERS_COLLECTION).where('fcmTokens', 'array-contains', token).get();
    const ops = [];
    snap.forEach((doc) => {
      if (doc.id !== decoded.uid) {
        ops.push(
          doc.ref.update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(token),
            ['fcmTokenInfo.' + hashToken(token)]: admin.firestore.FieldValue.delete(),
          })
        );
      }
    });
    await Promise.all(ops);

    // 2. Simpan ke akun yang sedang login, beserta labelnya, lalu rapikan.
    const ref = db.collection(USERS_COLLECTION).doc(decoded.uid);
    let jumlahToken = 0;
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const data = doc.exists ? doc.data() : {};
      const { tokens, info } = tambahToken(data, token, platform, admin.firestore.Timestamp.now());
      jumlahToken = tokens.length;
      if (doc.exists) tx.update(ref, { fcmTokens: tokens, fcmTokenInfo: info });
      else tx.set(ref, { fcmTokens: tokens, fcmTokenInfo: info }, { merge: true });
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, platform, dibersihkanDariAkunLain: ops.length, jumlahTokenAkunIni: jumlahToken }),
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
