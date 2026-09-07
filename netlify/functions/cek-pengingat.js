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

// PENTING soal zona waktu: server (Netlify Functions) biasanya jalan dengan jam
// sistem UTC, BUKAN WIB (Asia/Jakarta, UTC+7). Kalau kita pakai waktuTugas.setHours(...)
// begitu saja, itu artinya "jam 19:00 menurut jam SERVER" — yang kalau server-nya UTC,
// itu sama dengan jam 02:00 dini hari WIB, alias meleset 7 jam dari yang dimaksud!
// Makanya di bawah ini waktu dibangun eksplisit pakai offset "+07:00", supaya hasilnya
// benar persis jam WIB berapa pun timezone si server sebenarnya.
function tanggalWIB(isoString) {
  // Ambil tanggal kalender (YYYY-MM-DD) SESUAI ZONA WAKTU JAKARTA dari sebuah
  // timestamp, apa pun timezone server yang menjalankan kode ini.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date(isoString)); // -> "2026-09-07"
}
function waktuJakarta(tanggalYMD, jamHM) {
  // Bangun instant absolut yang benar untuk "tanggal X jam Y WIB" — Indonesia
  // (WIB) tidak kenal DST, jadi offset +07:00 ini aman dipakai sepanjang tahun.
  return new Date(`${tanggalYMD}T${jamHM}:00+07:00`);
}

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

        const tglWIB = tanggalWIB(s.tanggal);
        const jamStr = s.jam || '00:00';
        const waktuTugas = waktuJakarta(tglWIB, jamStr);
        const tengahMalam = waktuJakarta(tglWIB, '00:00');

        const target = [
          {
            key: 'midnight',
            waktu: tengahMalam,
            judul: 'Hari ini kamu bertugas 🙏',
            pesan: `Jangan lupa, hari ini kamu bertugas jam ${jamStr} (${j.namaMisa}).`,
          },
          {
            key: 'h3',
            waktu: new Date(waktuTugas.getTime() - 3 * 3600 * 1000),
            judul: 'Pengingat: 3 jam lagi',
            pesan: `3 jam lagi kamu bertugas jam ${jamStr} (${j.namaMisa}).`,
          },
          {
            key: 'h1',
            waktu: new Date(waktuTugas.getTime() - 1 * 3600 * 1000),
            judul: 'Pengingat: 1 jam lagi ⏰',
            pesan: `1 jam lagi kamu bertugas jam ${jamStr} (${j.namaMisa}). Siap-siap ya!`,
          },
        ];

        for (const t of target) {
          const selisih = now - t.waktu;
          if (selisih < 0 || selisih > JENDELA) continue; // belum waktunya / kelewat jendela

          const logId = `${j.id}_${s.id}_${t.key}`;
          const logRef = db.collection(LOG_COLLECTION).doc(logId);
          const logSnap = await logRef.get();
          if (logSnap.exists) continue; // sudah pernah dikirim, skip

          // Kumpulkan dulu SEMUA token dari semua petugas di slot ini jadi satu
          // set unik, baru kirim SEKALI per token — supaya kalau ada 1 HP yang
          // (secara tidak sengaja) tercatat di lebih dari satu akun, dia tetap
          // cuma dapat SATU notifikasi, bukan dobel.
          const tokenSet = new Set();
          for (const pid of s.petugas) {
            const usersSnap = await db.collection(USERS_COLLECTION).where('petugasId', '==', pid).get();
            usersSnap.forEach((userDoc) => {
              (userDoc.data().fcmTokens || []).forEach((tok) => tokenSet.add(tok));
            });
          }

          if (tokenSet.size > 0) {
            try {
              const resp = await admin.messaging().sendEachForMulticast({
                tokens: [...tokenSet],
                notification: { title: t.judul, body: t.pesan },
              });
              terkirim += resp.successCount;
            } catch (sendErr) {
              console.error('Gagal kirim reminder', logId, sendErr);
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
