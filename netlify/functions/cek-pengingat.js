const admin = require('firebase-admin');

// Kredensial diambil dari Environment Variable di Netlify (FIREBASE_SERVICE_ACCOUNT),
// BUKAN ditulis langsung di kode ini — biar aman.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

const KOMSOS_COLLECTION = 'komsos-data';
const USERS_COLLECTION = 'komsos-users';
const LOG_COLLECTION = 'reminder-log';

// Netlify otomatis menjalankan fungsi ini tiap 15 menit (lihat netlify.toml).
// Cek semua jadwal, kirim notifikasi HANYA ke petugas yang namanya ada
// di slot itu, pas 3 momen: tengah malam hari-H, 3 jam sebelum, 1 jam sebelum.
exports.handler = async function () {
  try {
    const now = new Date();
    const doc = await db.collection(KOMSOS_COLLECTION).doc('jadwal-list').get();
    const jadwalList = doc.exists ? (doc.data().payload || []) : [];

    const JENDELA = 15 * 60 * 1000; // toleransi 15 menit, samain sama jadwal cron
    let terkirim = 0;

    for (const j of jadwalList) {
      for (const s of (j.slots || [])) {
        if (!s.petugas || s.petugas.length === 0) continue;

        const waktuTugas = new Date(s.tanggal);
        const [h, m] = (s.jam || '00:00').split(':').map(Number);
        waktuTugas.setHours(h, m, 0, 0);

        const tengahMalam = new Date(waktuTugas);
        tengahMalam.setHours(0, 0, 0, 0);

        const target = [
          {
            key: 'midnight',
            waktu: tengahMalam,
            judul: 'Hari ini kamu bertugas 🙏',
            pesan: `Jangan lupa, hari ini kamu bertugas jam ${s.jam} (${j.namaMisa}).`,
          },
          {
            key: 'h3',
            waktu: new Date(waktuTugas.getTime() - 3 * 3600 * 1000),
            judul: 'Pengingat: 3 jam lagi',
            pesan: `3 jam lagi kamu bertugas jam ${s.jam} (${j.namaMisa}).`,
          },
          {
            key: 'h1',
            waktu: new Date(waktuTugas.getTime() - 1 * 3600 * 1000),
            judul: 'Pengingat: 1 jam lagi ⏰',
            pesan: `1 jam lagi kamu bertugas jam ${s.jam} (${j.namaMisa}). Siap-siap ya!`,
          },
        ];

        for (const t of target) {
          const selisih = now - t.waktu;
          if (selisih < 0 || selisih > JENDELA) continue; // belum waktunya / kelewat jendela

          const logId = `${j.id}_${s.id}_${t.key}`;
          const logRef = db.collection(LOG_COLLECTION).doc(logId);
          const logSnap = await logRef.get();
          if (logSnap.exists) continue; // sudah pernah dikirim, skip

          for (const pid of s.petugas) {
            const usersSnap = await db.collection(USERS_COLLECTION).where('petugasId', '==', pid).get();
            for (const userDoc of usersSnap.docs) {
              const tokens = userDoc.data().fcmTokens || [];
              if (tokens.length === 0) continue;
              try {
                await admin.messaging().sendEachForMulticast({
                  tokens,
                  notification: { title: t.judul, body: t.pesan },
                });
                terkirim++;
              } catch (sendErr) {
                console.error('Gagal kirim ke', pid, sendErr);
              }
            }
          }
          await logRef.set({ terkirimPada: admin.firestore.FieldValue.serverTimestamp() });
        }
      }
    }

    return { statusCode: 200, body: `OK, ${terkirim} notifikasi terkirim.` };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: 'Error: ' + e.message };
  }
};
