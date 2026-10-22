// Fungsi bersama untuk urusan token notifikasi (dipakai sinkron-token.js,
// test-notifikasi.js, dan sebaiknya juga cek-pengingat.js).
//
// ATURAN INTI (supaya tidak ada notifikasi dobel):
// 1. Setiap token diberi label jenis: 'android' (APK), 'web' (Chrome/browser),
//    atau 'unknown' (token lama yang belum berlabel).
// 2. Saat mengirim, tiap akun HANYA dikirimi ke SATU jenis, dengan prioritas:
//    android > web > unknown. Jadi kalau seseorang punya APK, Chrome-nya tidak
//    ikut menerima notifikasi.
// 3. Kalau semua token di jenis teratas ternyata sudah mati (misal APK sudah
//    di-uninstall), otomatis dicoba jenis berikutnya supaya orangnya tetap
//    mendapat notifikasi, lalu token mati dibersihkan.
// 4. Tiap jenis dibatasi paling banyak 2 token per akun (yang terbaru).

const crypto = require('crypto');

const URUTAN = ['android', 'web', 'unknown'];
const MAKS_PER_JENIS = 2;
const KODE_TOKEN_MATI = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
];

function hashToken(token) {
  return crypto.createHash('sha1').update(String(token)).digest('hex').slice(0, 20);
}

function normalisasiPlatform(p) {
  return p === 'android' || p === 'web' ? p : 'unknown';
}

function ambilMillis(ts) {
  return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
}

// Kelompokkan token satu akun berdasarkan jenis, yang terbaru di depan.
function kelompokkan(data) {
  const tokens = Array.isArray(data && data.fcmTokens) ? data.fcmTokens : [];
  const info = (data && data.fcmTokenInfo) || {};
  const grup = { android: [], web: [], unknown: [] };
  for (const t of tokens) {
    const meta = info[hashToken(t)];
    const jenis = meta && grup[meta.platform] ? meta.platform : 'unknown';
    grup[jenis].push({ token: t, waktu: ambilMillis(meta && meta.updatedAt) });
  }
  for (const j of URUTAN) grup[j].sort((a, b) => b.waktu - a.waktu);
  return grup;
}

// Daftar kelompok yang akan dicoba untuk satu akun, berurutan.
function susunAntrian(data) {
  const grup = kelompokkan(data);
  return URUTAN
    .map((j) => ({
      jenis: j,
      tokens: (j === 'unknown' ? grup[j] : grup[j].slice(0, MAKS_PER_JENIS)).map((x) => x.token),
    }))
    .filter((g) => g.tokens.length > 0);
}

// Tambah/perbarui satu token pada data akun, lalu rapikan batas per jenis.
function tambahToken(data, token, platform, stempel) {
  let tokens = Array.isArray(data && data.fcmTokens) ? data.fcmTokens.slice() : [];
  const info = Object.assign({}, (data && data.fcmTokenInfo) || {});
  if (!tokens.includes(token)) tokens.push(token);
  info[hashToken(token)] = { platform: normalisasiPlatform(platform), updatedAt: stempel };

  const grup = kelompokkan({ fcmTokens: tokens, fcmTokenInfo: info });
  for (const j of ['android', 'web']) {
    grup[j].slice(MAKS_PER_JENIS).forEach((x) => {
      tokens = tokens.filter((t) => t !== x.token);
      delete info[hashToken(x.token)];
    });
  }
  return { tokens, info };
}

// Kirim ke semua akun dengan aturan di atas. Mengembalikan ringkasan.
async function kirimNotifikasi({ admin, messaging, usersSnap, pesan }) {
  const akunList = [];
  usersSnap.forEach((doc) => {
    const urut = susunAntrian(doc.data());
    if (urut.length) akunList.push({ ref: doc.ref, urut, idx: 0, selesai: false, terkirim: false });
  });

  const hasil = { terkirim: 0, akunDilayani: 0, gagal: 0, dibersihkan: 0, rincian: { android: 0, web: 0, unknown: 0 } };
  const mati = new Map(); // token -> akun pemiliknya

  for (let ronde = 0; ronde < URUTAN.length; ronde++) {
    const aktif = akunList.filter((a) => !a.selesai && a.idx < a.urut.length);
    if (!aktif.length) break;

    const pemilik = new Map();
    aktif.forEach((a) => {
      const g = a.urut[a.idx];
      hasil.rincian[g.jenis] += g.tokens.length;
      g.tokens.forEach((t) => pemilik.set(t, a));
    });

    const semua = [...pemilik.keys()];
    const status = new Map();
    for (let i = 0; i < semua.length; i += 500) {
      const potong = semua.slice(i, i + 500);
      const resp = await messaging.sendEachForMulticast(Object.assign({}, pesan, { tokens: potong }));
      resp.responses.forEach((r, k) => {
        const t = potong[k];
        if (r.success) status.set(t, 'ok');
        else if (r.error && KODE_TOKEN_MATI.includes(r.error.code)) status.set(t, 'mati');
        else status.set(t, 'gagal');
      });
    }

    aktif.forEach((a) => {
      const g = a.urut[a.idx];
      const st = g.tokens.map((t) => status.get(t));
      st.forEach((s, k) => {
        if (s === 'ok') hasil.terkirim++;
        else if (s === 'mati') mati.set(g.tokens[k], a);
        else hasil.gagal++;
      });
      if (st.includes('ok')) { a.terkirim = true; a.selesai = true; }
      else if (st.every((s) => s === 'mati')) { a.idx++; }   // semua mati -> coba jenis berikutnya
      else { a.selesai = true; }                              // gagal sebab lain -> jangan kirim ke jenis lain (hindari dobel)
    });
  }

  hasil.akunDilayani = akunList.filter((a) => a.terkirim).length;

  // Bersihkan token yang sudah mati.
  const perAkun = new Map();
  for (const [token, akun] of mati) {
    const kunci = akun.ref.path;
    if (!perAkun.has(kunci)) perAkun.set(kunci, { ref: akun.ref, tokens: [] });
    perAkun.get(kunci).tokens.push(token);
  }
  const ops = [];
  for (const { ref, tokens } of perAkun.values()) {
    const ubah = { fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokens) };
    tokens.forEach((t) => { ubah['fcmTokenInfo.' + hashToken(t)] = admin.firestore.FieldValue.delete(); });
    ops.push(ref.update(ubah));
  }
  await Promise.all(ops);
  hasil.dibersihkan = mati.size;
  return hasil;
}

module.exports = { hashToken, normalisasiPlatform, kelompokkan, susunAntrian, tambahToken, kirimNotifikasi, URUTAN, MAKS_PER_JENIS };
