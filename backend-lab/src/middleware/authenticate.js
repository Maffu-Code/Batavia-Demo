/**
 * Autentikasi JWT.
 *
 * Memasang req.user dengan data user yang MASIH AKTIF. Token user yang
 * sudah dinonaktifkan ditolak di sini -- tidak sampai middleware izin.
 *
 * Token yang usianya lebih lama dari password_changed_at user juga
 * ditolak: perubahan password mengakhiri sesi lama.
 */
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const env = require('../config/env');
const { AppError } = require('./errorHandler');

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new AppError(401, 'Anda belum login.');

    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
      throw new AppError(401, 'Sesi tidak valid atau sudah kedaluwarsa. Silakan login ulang.');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, nama_lengkap: true, peran: true,
        bagian_id: true, aktif: true, bisa_hapus: true,
        password_changed_at: true, deleted_at: true,
      },
    });

    if (!user || user.deleted_at) throw new AppError(401, 'Akun tidak ditemukan.');
    if (!user.aktif) throw new AppError(403, 'Akun Anda dinonaktifkan. Hubungi Superadmin.');

    // Token diterbitkan sebelum password terakhir diubah -> ditolak.
    // Toleransi 2 detik untuk clock skew saat issue (iat) vs now (DB) --
    // tanpa ini, token yang di-issue sepersekian detik setelah user
    // dibuat kadang gagal karena perbandingan millisecond.
    const TOLERANSI_MS = 2000;
    if (payload.iat * 1000 < new Date(user.password_changed_at).getTime() - TOLERANSI_MS) {
      throw new AppError(401, 'Password telah diubah. Silakan login ulang.');
    }

    req.user = {
      id: user.id,
      email: user.email,
      nama: user.nama_lengkap,
      peran: user.peran,
      bagian_id: user.bagian_id,
      bisa_hapus: user.bisa_hapus,
    };
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = authenticate;
