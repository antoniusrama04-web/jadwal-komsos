// Netlify Function: absen QR KOMSOS
// Env yang dibutuhkan (Site configuration > Environment variables):
//   QR_SECRET                  -> teks acak panjang (bebas), rahasia server
//   FIREBASE_SERVICE_ACCOUNT   -> isi JSON service account Firebase (boleh base64)
//   GEREJA_LAT, GEREJA_LNG     -> (opsional) koordinat gereja, mis. -0.0263 dan 109.3425
const crypto = require('crypto');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  let sa;
  try { sa = JSON.parse(raw); } catch (e) { sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();
const SLOT = 30000;   // QR berganti tiap 30 detik
const BATCH = 20;     // kiosk menerima 20 kode sekaligus (10 menit) supaya hemat pemanggilan
const sig = (n) => crypto.createHmac('sha256', process.env.QR_SECRET || 'ubah-saya').update(String(n)).digest('hex').slice(0, 20);
const res = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

// Semua hitungan hari/jam memakai WIB (UTC+7), sama seperti tampilan di aplikasi.
function waktuSlot(s) {
  const w = new Date(new Date(s.tanggal).getTime() + 7 * 3600e3);
  const [h, m] = (s.jam || '00:00').split(':').map(Number);
  const y = w.getUTCFullYear(), mo = w.getUTCMonth(), d = w.getUTCDate();
  return {
    mulai: Date.UTC(y, mo, d, (h || 0) - 7, m || 0),
    akhirHari: Date.UTC(y, mo, d, 23 - 7, 59, 59),
  };
}
function jarakM(a, b, c, d) {
  const R = 6371000, r = (x) => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return res(405, { error: 'Metode tidak didukung.' });
  let uid;
  try {
    const t = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '');
    uid = (await admin.auth().verifyIdToken(t)).uid;
  } catch (e) { return res(401, { error: 'Sesi login tidak valid. Login ulang.' }); }
  const user = (await db.collection('komsos-users').doc(uid).get()).data() || {};
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return res(400, { error: 'Permintaan rusak.' }); }
  const now = Date.now();

  if (body.action === 'token') {
    if (user.role !== 'kiosk') return res(403, { error: 'Bukan akun penampil QR.' });
    const base = Math.floor(now / SLOT);
    return res(200, { now, base, kode: Array.from({ length: BATCH }, (_, i) => sig(base + i)) });
  }

  if (body.action === 'scan') {
    if (!user.petugasId) return res(403, { error: 'Akunmu belum terhubung ke data petugas.' });
    const [nStr, kode] = String(body.kode || '').split(':');
    const n = Number(nStr), cur = Math.floor(now / SLOT);
    const okSig = kode && kode.length === 20 && crypto.timingSafeEqual(Buffer.from(kode), Buffer.from(sig(n)));
    if (!okSig || !(n === cur || n === cur - 1)) return res(400, { error: 'QR tidak valid atau sudah kedaluwarsa' });

    const ref = db.collection('komsos-data').doc('jadwal-list');
    try {
      const out = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const payload = (snap.data() || {}).payload || [];
        const j = payload.find((x) => x.id === body.jadwalId);
        const s = j && j.slots.find((x) => x.id === body.slotId);
        if (!s || !s.petugas.includes(user.petugasId)) throw new Error('Kamu tidak bertugas di slot ini.');
        const w = waktuSlot(s);
        if (now < w.mulai - 2 * 3600e3 || now > w.akhirHari) throw new Error('Di luar jam absen.');
        const telat = now > w.mulai;
        const alasan = String(body.alasan || '').slice(0, 200);
        if (telat && !alasan) throw new Error('Alasan keterlambatan wajib diisi.');
        const lk = body.lokasi && typeof body.lokasi.lat === 'number' && typeof body.lokasi.lng === 'number' ? body.lokasi : null;
        const gl = parseFloat(process.env.GEREJA_LAT), gg = parseFloat(process.env.GEREJA_LNG);
        s.absensi = s.absensi || {};
        s.absensi[user.petugasId] = {
          status: 'hadir', waktu: new Date(now).toISOString(), telat, alasan, metode: 'qr',
          ...(lk ? { lat: lk.lat, lng: lk.lng, akurasi: Math.round(lk.akurasi || 0),
                     jarak: (isNaN(gl) || isNaN(gg)) ? null : jarakM(gl, gg, lk.lat, lk.lng) } : {}),
        };
        tx.update(ref, { payload });
        return { ok: true, telat };
      });
      return res(200, out);
    } catch (e) { return res(400, { error: e.message }); }
  }
  return res(400, { error: 'Aksi tidak dikenal.' });
};
