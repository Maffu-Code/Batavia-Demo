/**
 * logAudit: SATU titik tulis ke activity_logs.
 *
 * Fire-and-forget untuk request pengguna: kegagalan tulis log TIDAK boleh
 * menggagalkan response yang sudah dikirim. Error ditulis ke stderr.
 *
 * Setiap penulisan dilacak supaya uji bisa menunggu lewat `drainAudit()`.
 * Tanpa ini, assertion jumlah baris balapan dengan penulis async.
 *
 * Audit lab: append serial per proses, dengan baca dan tulis dalam satu
 * transaksi. Tidak memperbaiki rantai historis atau menjamin koordinasi
 * antarproses pada semua database.
 */
const crypto = require('crypto');
const prisma = require('../config/database');

function hitungRowHash(fields, prevHash) {
  // Urutan field tetap supaya hash stabil.
  const kanonik = JSON.stringify([
    fields.user_id,
    fields.nama_user,
    fields.aksi,
    fields.entitas,
    fields.entitas_id ?? null,
    fields.detail ?? null,
    fields.ip ?? null,
    fields.created_at.toISOString(),
    prevHash ?? '',
  ]);
  return crypto.createHash('sha256').update(kanonik).digest('hex');
}

let tail = Promise.resolve();

async function _tulis(opt) {
  const user = opt.user || null;
  const detail = opt.detail
    ?? (opt.aksi === 'login_gagal' && opt.emailJikaGagalLogin
          ? `Percobaan login gagal untuk email "${opt.emailJikaGagalLogin}".`
          : null);

  await prisma.$transaction(async (tx) => {
    const prev = await tx.activityLog.findFirst({
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { row_hash: true, created_at: true },
    });
    const prevHash = prev?.row_hash ?? null;
    // Urutan append tetap tegas saat jam mundur atau timestamp bertabrakan.
    const created_at = new Date(Math.max(Date.now(), prev ? prev.created_at.getTime() + 1 : 0));
    const fields = {
      user_id:    user?.id || null,
      nama_user:  user?.nama || user?.nama_lengkap || 'Sistem',
      aksi:       opt.aksi,
      entitas:    opt.entitas,
      entitas_id: opt.entitasId || null,
      detail,
      ip:         opt.req?.ip || null,
      created_at,
    };
    const row_hash = hitungRowHash(fields, prevHash);
    await tx.activityLog.create({
      data: { ...fields, prev_hash: prevHash, row_hash },
    });
  });
}

/**
 * @param {Object} opt
 * @param {Object|null} opt.user   req.user atau null untuk sistem
 * @param {string} opt.aksi        misal 'create', 'login_sukses', 'login_gagal'
 * @param {string} opt.entitas     'surat_masuk', 'katalog', 'user', dsb.
 * @param {string|null} opt.entitasId
 * @param {string|null} opt.detail kalimat untuk dibaca manusia
 * @param {Object|null} opt.req    untuk mengambil IP (opsional)
 * @param {string|null} opt.emailJikaGagalLogin untuk login_gagal tanpa user
 */
function logAudit(opt) {
  tail = tail.then(() => _tulis(opt)).catch(() => {
    // Prisma error detail can contain audit data. Keep stderr diagnostic generic.
    console.error('[activity_logs] gagal mencatat audit.');
  });
  return tail;
}

/** Menunggu semua penulisan audit yang masih berjalan. Dipakai uji. */
async function drainAudit() {
  let pending;
  do {
    pending = tail;
    await pending;
  } while (pending !== tail);
}

/**
 * Middleware route: mencatat SETELAH response 2xx terkirim.
 * Controller mengisi detail lewat res.locals:
 *   res.locals.entitas_id = x.id;
 *   res.locals.detail     = `Mencatat surat masuk "${x.nomor_registrasi}"`;
 */
function logActivity(aksi, entitas) {
  return function (req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const result = originalJson(body);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logAudit({
          user: req.user || null,
          aksi,
          entitas,
          entitasId: res.locals.entitas_id || null,
          detail:    res.locals.detail || null,
          req,
        });
      }
      return result;
    };
    next();
  };
}

module.exports = { logAudit, logActivity, hitungRowHash, drainAudit };
