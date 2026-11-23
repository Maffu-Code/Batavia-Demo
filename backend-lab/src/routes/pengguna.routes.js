/**
 * Kendali akun dan matriks tiga keadaan. Pasang penggunaRoutes di /api/pengguna
 * dan aktivitasRoutes di /api/aktivitas. Semua jalur khusus superadmin.
 * Grant operasional tidak mengganti pemeriksaan lingkup data pada route surat.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const { AppError } = require('../middleware/errorHandler');
const { logAudit } = require('../middleware/logActivity');
const { izinEfektif, AKSI_DIDUKUNG, LABEL_RESOURCE, LABEL_AKSI } = require('../services/izin.service');

const penggunaRoutes = express.Router();
const aktivitasRoutes = express.Router();
const PERAN = ['superadmin', 'kepala_sekolah', 'tata_usaha', 'kepala_bagian', 'guru_staf'];
const KHUSUS_SUPERADMIN = new Set(['user', 'izin', 'activity_log', 'terhapus']);
const PILIH_USER = {
  id: true, nama_lengkap: true, email: true, peran: true, bagian_id: true,
  aktif: true, bisa_hapus: true, created_at: true, updated_at: true,
  bagian: { select: { id: true, nama: true, singkatan: true } },
};
const PILIH_AKTIVITAS = {
  id: true, user_id: true, nama_user: true, aksi: true, entitas: true,
  entitas_id: true, detail: true, created_at: true,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_AKUN = ['nama_lengkap', 'email', 'password', 'peran', 'bagian_id', 'aktif', 'bisa_hapus'];

function hanyaSuperadmin(req, res, next) {
  if (req.user.peran !== 'superadmin') return next(new AppError(403, 'Hanya Superadmin yang dapat mengelola akun, izin, dan aktivitas.'));
  next();
}
for (const router of [penggunaRoutes, aktivitasRoutes]) router.use(authenticate, hanyaSuperadmin);

function salah(pesan) { throw new AppError(400, pesan); }
function uuid(value, label = 'ID pengguna') {
  if (typeof value !== 'string' || !UUID.test(value)) salah(`${label} harus berupa UUID yang valid.`);
  return value;
}
function teks(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) {
    salah(`${label} harus berupa teks ${min} sampai ${max} karakter.`);
  }
  return value.trim();
}
function objek(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) salah('Isian harus berupa objek JSON.');
  if (!Object.keys(body).length) salah('Isian tidak boleh kosong.');
  if (Object.keys(body).some((key) => !fields.includes(key))) salah('Isian memuat field yang tidak didukung.');
}
function validasiAkun(body, baru) {
  objek(body, FIELD_AKUN);
  if (baru && ['nama_lengkap', 'email', 'password', 'peran'].some((field) => !Object.hasOwn(body, field))) {
    salah('Nama lengkap, email, password, dan peran wajib diisi.');
  }
  const data = {};
  if (Object.hasOwn(body, 'nama_lengkap')) data.nama_lengkap = teks(body.nama_lengkap, 'Nama lengkap', 2, 120);
  if (Object.hasOwn(body, 'email')) {
    data.email = teks(body.email, 'Email', 3, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) salah('Format email tidak valid.');
  }
  if (Object.hasOwn(body, 'peran')) {
    if (!PERAN.includes(body.peran)) salah('Peran tidak dikenal.');
    data.peran = body.peran;
  }
  for (const field of ['aktif', 'bisa_hapus']) {
    if (Object.hasOwn(body, field)) {
      if (typeof body[field] !== 'boolean') salah(`${field} harus berupa boolean.`);
      data[field] = body[field];
    }
  }
  if (Object.hasOwn(body, 'bagian_id')) data.bagian_id = body.bagian_id === null ? null : uuid(body.bagian_id, 'ID bagian');
  if (Object.hasOwn(body, 'password')) {
    if (typeof body.password !== 'string' || body.password.length < 12 || Buffer.byteLength(body.password, 'utf8') > 72) {
      salah('Password minimal 12 karakter dan maksimal 72 byte.');
    }
  }
  return data;
}
async function validasiBagian(db, data, target) {
  // Perpindahan ke peran lintas unit tidak mewarisi unit lama secara diam-diam.
  if (target && data.peran !== undefined && data.peran !== target.peran &&
      ['superadmin', 'kepala_sekolah'].includes(data.peran) && !Object.hasOwn(data, 'bagian_id')) data.bagian_id = null;
  const akhir = { ...target, ...data };
  const wajib = ['tata_usaha', 'kepala_bagian', 'guru_staf'].includes(akhir.peran);
  // Akun lama yang belum berunit tetap dapat ditutup, bukan diedit/diaktifkan.
  const hanyaNonaktif = target && data.aktif === false && Object.keys(data).length === 1;
  if (wajib && !akhir.bagian_id && !hanyaNonaktif) salah('Unit kerja wajib dipilih untuk Tata Usaha, Kepala Bagian, dan Guru/Staf.');
  const periksaAktif = !target || akhir.bagian_id !== target.bagian_id || akhir.peran !== target.peran || (akhir.aktif && !target.aktif);
  if (akhir.bagian_id && periksaAktif && !await db.bagian.findFirst({ where: { id: akhir.bagian_id, aktif: true, deleted_at: null }, select: { id: true } })) {
    salah('Bagian tidak ditemukan atau tidak aktif.');
  }
}
async function ambilUser(db, id) {
  const user = await db.user.findFirst({ where: { id, deleted_at: null }, select: PILIH_USER });
  if (!user) throw new AppError(404, 'Akun tidak ditemukan.');
  return user;
}
async function pengelolaMasihAktif(db, id) {
  // Periksa lagi di transaksi agar dua sesi admin tidak bisa saling menutup
  // setelah keduanya lolos autentikasi sebelum transaksi pertama selesai.
  if (!await db.user.findFirst({ where: { id, peran: 'superadmin', aktif: true, deleted_at: null }, select: { id: true } })) {
    throw new AppError(403, 'Kewenangan pengelola telah berubah. Silakan login ulang.');
  }
}
function kueri(query, allowed) {
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string') salah('Parameter pencarian tidak didukung atau berulang.');
  }
  const integer = (name, defaultValue, max) => {
    if (query[name] === undefined) return defaultValue;
    if (!/^[1-9]\d*$/.test(query[name]) || !Number.isSafeInteger(Number(query[name])) || Number(query[name]) > max) {
      salah(`${name} harus berupa bilangan bulat antara 1 dan ${max}.`);
    }
    return Number(query[name]);
  };
  return { page: integer('page', 1, 1000000), limit: integer('limit', 20, 100) };
}
function daftar(res, data, total, page, limit) {
  return res.json({ success: true, data, meta: { total, page, limit, total_pages: Math.ceil(total / limit) } });
}
async function panel(db, user) {
  return { user, izin: await izinEfektif(db, user), aksi: AKSI_DIDUKUNG, label_resource: LABEL_RESOURCE, label_aksi: LABEL_AKSI };
}
function audit(req, aksi, entitas, id, detail) {
  logAudit({ user: req.user, aksi, entitas, entitasId: id, detail, req });
}

penggunaRoutes.get('/', requirePermission('user', 'read'), async (req, res, next) => {
  try {
    const { page, limit } = kueri(req.query, ['q', 'peran', 'aktif', 'page', 'limit']);
    const where = { deleted_at: null };
    if (req.query.q !== undefined && req.query.q !== '') {
      const q = teks(req.query.q, 'Pencarian', 1, 150);
      where.OR = [{ nama_lengkap: { contains: q } }, { email: { contains: q } }];
    }
    if (req.query.peran !== undefined && req.query.peran !== '') {
      if (!PERAN.includes(req.query.peran)) salah('Peran tidak dikenal.');
      where.peran = req.query.peran;
    }
    if (req.query.aktif !== undefined && req.query.aktif !== '') {
      if (!['true', 'false', '1', '0'].includes(req.query.aktif)) salah('Filter aktif harus true, false, 1, atau 0.');
      where.aktif = ['true', '1'].includes(req.query.aktif);
    }
    const [data, total] = await prisma.$transaction([
      prisma.user.findMany({ where, select: PILIH_USER, orderBy: [{ nama_lengkap: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
      prisma.user.count({ where }),
    ]);
    daftar(res, data, total, page, limit);
  } catch (err) { next(err); }
});

penggunaRoutes.post('/', requirePermission('user', 'create'), async (req, res, next) => {
  try {
    const data = validasiAkun(req.body, true);
    const password_hash = await bcrypt.hash(req.body.password, 12);
    const user = await prisma.$transaction(async (db) => {
      await pengelolaMasihAktif(db, req.user.id);
      await validasiBagian(db, data);
      return db.user.create({ data: { ...data, password_hash, password_changed_at: new Date() }, select: PILIH_USER });
    });
    audit(req, 'create', 'user', user.id, `Membuat akun ${user.nama_lengkap} dengan peran ${user.peran}.`);
    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
});

penggunaRoutes.patch('/:id', requirePermission('user', 'update'), async (req, res, next) => {
  try {
    const id = uuid(req.params.id);
    const data = validasiAkun(req.body, false);
    if (Object.hasOwn(req.body, 'password')) {
      data.password_hash = await bcrypt.hash(req.body.password, 12);
      data.password_changed_at = new Date();
    }
    const user = await prisma.$transaction(async (db) => {
      await pengelolaMasihAktif(db, req.user.id);
      const target = await ambilUser(db, id);
      if (id === req.user.id && ((data.peran !== undefined && data.peran !== target.peran) || data.aktif === false)) {
        salah('Anda tidak dapat menurunkan peran atau menonaktifkan akun sendiri.');
      }
      if (target.peran === 'superadmin' && target.aktif && (data.aktif === false || (data.peran !== undefined && data.peran !== 'superadmin'))) {
        const jumlah = await db.user.count({ where: { peran: 'superadmin', aktif: true, deleted_at: null } });
        if (jumlah <= 1) salah('Minimal satu Superadmin aktif harus dipertahankan.');
      }
      await validasiBagian(db, data, target);
      return db.user.update({ where: { id }, data, select: PILIH_USER });
    });
    // Nama field saja untuk audit perubahan, tidak pernah menyalin body/sandi.
    const fields = Object.keys(req.body).filter((field) => field !== 'password');
    const sandi = Object.hasOwn(req.body, 'password') ? ' Sandi diatur ulang.' : '';
    audit(req, 'update', 'user', id, `Memperbarui akun ${user.nama_lengkap}. Field: ${fields.join(', ') || 'tidak ada'}.${sandi}`);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

penggunaRoutes.get('/:id/izin', requirePermission('izin', 'read'), async (req, res, next) => {
  try {
    const user = await ambilUser(prisma, uuid(req.params.id));
    res.json({ success: true, data: await panel(prisma, user) });
  } catch (err) { next(err); }
});

penggunaRoutes.patch('/:id/izin', requirePermission('izin', 'update'), async (req, res, next) => {
  try {
    const id = uuid(req.params.id);
    objek(req.body, ['resource', 'action', 'allowed']);
    const { resource, action, allowed } = req.body;
    if (typeof resource !== 'string' || !Object.hasOwn(AKSI_DIDUKUNG, resource) || !AKSI_DIDUKUNG[resource].includes(action)) {
      salah('Pasangan resource dan action tidak didukung.');
    }
    if (allowed !== null && typeof allowed !== 'boolean') salah('allowed harus true, false, atau null untuk kembali ke bawaan.');
    const data = await prisma.$transaction(async (db) => {
      await pengelolaMasihAktif(db, req.user.id);
      const target = await ambilUser(db, id);
      if (target.peran === 'superadmin') salah('Izin Superadmin melekat pada peran dan tidak dapat ditimpa.');
      if (!PERAN.includes(target.peran)) salah('Perbaiki peran akun sebelum mengatur izin.');
      if (KHUSUS_SUPERADMIN.has(resource) && allowed !== null) {
        throw new AppError(403, 'Administrasi akun, izin, aktivitas, dan pemulihan hanya untuk Superadmin.');
      }
      if (allowed === null) {
        await db.userPermission.deleteMany({ where: { user_id: id, resource, action } });
      } else {
        await db.userPermission.upsert({
          where: { user_id_resource_action: { user_id: id, resource, action } },
          create: { user_id: id, resource, action, allowed }, update: { allowed },
        });
      }
      return panel(db, target);
    });
    const keputusan = allowed === null ? 'bawaan' : (allowed ? 'diizinkan' : 'dilarang');
    audit(req, 'perubahan_izin', 'izin', id, `Izin ${resource}.${action} untuk ${data.user.nama_lengkap} diubah menjadi ${keputusan}.`);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

function tanggal(value, label, akhir = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) salah(`${label} harus berformat YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) salah(`${label} tidak valid.`);
  if (akhir) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}
aktivitasRoutes.get('/', requirePermission('activity_log', 'read'), async (req, res, next) => {
  try {
    const { page, limit } = kueri(req.query, ['q', 'user_id', 'entitas', 'aksi', 'dari', 'sampai', 'page', 'limit']);
    const where = {};
    if (req.query.user_id) where.user_id = uuid(req.query.user_id);
    for (const field of ['entitas', 'aksi']) if (req.query[field]) where[field] = teks(req.query[field], field, 1, 80);
    if (req.query.q) {
      const q = teks(req.query.q, 'Pencarian', 1, 150);
      where.OR = [{ nama_user: { contains: q } }, { detail: { contains: q } }];
    }
    if (req.query.dari || req.query.sampai) {
      where.created_at = {};
      if (req.query.dari) where.created_at.gte = tanggal(req.query.dari, 'Tanggal awal');
      if (req.query.sampai) where.created_at.lt = tanggal(req.query.sampai, 'Tanggal akhir', true);
      if (where.created_at.gte && where.created_at.lt && where.created_at.gte >= where.created_at.lt) salah('Tanggal awal tidak boleh melampaui tanggal akhir.');
    }
    const [data, total] = await prisma.$transaction([
      prisma.activityLog.findMany({ where, select: PILIH_AKTIVITAS, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      prisma.activityLog.count({ where }),
    ]);
    daftar(res, data, total, page, limit);
  } catch (err) { next(err); }
});

module.exports = { penggunaRoutes, aktivitasRoutes };
