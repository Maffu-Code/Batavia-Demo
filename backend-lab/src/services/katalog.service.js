/** Katalog memakai allowlist model, field, tipe dan ukuran, bukan nama tabel dari input. */
const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

const JENIS = Object.freeze({
  surat: { model: 'jenisSurat', label: 'Jenis Surat', resource: 'jenis_surat' },
  arsip: { model: 'jenisArsip', label: 'Jenis Arsip', resource: 'jenis_arsip' },
  unit: { model: 'bagian', label: 'Unit Kerja', resource: 'bagian', superadmin: true },
});
const FIELD = new Set(['kode', 'nama', 'keterangan', 'aktif']);
const FIELD_UNIT = new Set(['singkatan', 'nama', 'aktif']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pastikanJenis(jenis) {
  if (typeof jenis !== 'string' || !Object.hasOwn(JENIS, jenis)) {
    throw new AppError(400, 'Jenis katalog tidak dikenal. Pilih surat, arsip, atau unit.');
  }
  return JENIS[jenis];
}

function normalkanKode(input) {
  return typeof input === 'string' ? input.trim().toLowerCase().replace(/[\s_]+/g, '-') : '';
}

function validasi(data, wajib) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError(400, 'Isian harus berupa objek JSON.');
  }
  if (Object.keys(data).some((k) => !FIELD.has(k))) {
    throw new AppError(400, 'Isian berisi field yang tidak dikenal.');
  }
  const hasil = {};
  if (Object.hasOwn(data, 'nama') || wajib) {
    if (typeof data.nama !== 'string' || !data.nama.trim() || data.nama.trim().length > 120) {
      throw new AppError(400, 'Nama wajib berupa teks, maksimal 120 karakter.');
    }
    hasil.nama = data.nama.trim();
  }
  if (Object.hasOwn(data, 'kode') || wajib) {
    const mentah = Object.hasOwn(data, 'kode') ? data.kode : data.nama;
    const kode = normalkanKode(mentah);
    if (!kode || kode.length > 40 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kode)) {
      throw new AppError(400, 'Kode wajib huruf, angka atau tanda hubung, maksimal 40 karakter.');
    }
    hasil.kode = kode;
  }
  if (Object.hasOwn(data, 'keterangan')) {
    if (data.keterangan !== null && typeof data.keterangan !== 'string') {
      throw new AppError(400, 'Keterangan harus berupa teks.');
    }
    if ((data.keterangan || '').trim().length > 500) {
      throw new AppError(400, 'Keterangan maksimal 500 karakter.');
    }
    hasil.keterangan = (data.keterangan || '').trim() || null;
  }
  if (Object.hasOwn(data, 'aktif')) {
    if (typeof data.aktif !== 'boolean') throw new AppError(400, 'Aktif harus true atau false.');
    hasil.aktif = data.aktif;
  }
  if (!Object.keys(hasil).length) throw new AppError(400, 'Tidak ada perubahan yang dikirim.');
  return hasil;
}

function validasiUnit(data, wajib) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError(400, 'Isian harus berupa objek JSON.');
  if (Object.keys(data).some((k) => !FIELD_UNIT.has(k))) throw new AppError(400, 'Isian berisi field yang tidak dikenal.');
  const hasil = {};
  if (Object.hasOwn(data, 'nama') || wajib) {
    if (typeof data.nama !== 'string' || !data.nama.trim() || data.nama.trim().length > 120) throw new AppError(400, 'Nama unit wajib berupa teks, maksimal 120 karakter.');
    hasil.nama = data.nama.trim().replace(/\s+/g, ' ');
  }
  if (Object.hasOwn(data, 'singkatan') || wajib) {
    const singkatan = typeof data.singkatan === 'string' ? data.singkatan.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(singkatan) || singkatan.length > 20) throw new AppError(400, 'Singkatan wajib huruf, angka atau tanda hubung, maksimal 20 karakter.');
    hasil.singkatan = singkatan;
  }
  if (Object.hasOwn(data, 'aktif')) {
    if (typeof data.aktif !== 'boolean') throw new AppError(400, 'Aktif harus true atau false.');
    hasil.aktif = data.aktif;
  }
  if (!Object.keys(hasil).length) throw new AppError(400, 'Tidak ada perubahan yang dikirim.');
  return hasil;
}

async function namaUnitUnik(nama, id) {
  if (!nama) return;
  const baris = await prisma.bagian.findMany({ where: { deleted_at: null, ...(id ? { id: { not: id } } : {}) }, select: { nama: true } });
  if (baris.some((b) => b.nama.toLocaleLowerCase('id-ID') === nama.toLocaleLowerCase('id-ID'))) throw new AppError(409, 'Unit Kerja dengan nama tersebut sudah ada.');
}

async function daftar(jenis, { aktifSaja = false } = {}) {
  const def = pastikanJenis(jenis);
  return prisma[def.model].findMany({
    where: { ...(aktifSaja ? { aktif: true } : {}), ...(jenis === 'unit' ? { deleted_at: null } : {}) },
    orderBy: [{ aktif: 'desc' }, jenis === 'unit' ? { nama: 'asc' } : { kode: 'asc' }],
  });
}

async function buat(jenis, data) {
  const def = pastikanJenis(jenis);
  const isian = jenis === 'unit' ? validasiUnit(data, true) : validasi(data, true);
  try {
    if (jenis === 'unit') await namaUnitUnik(isian.nama);
    return await prisma[def.model].create({ data: isian });
  } catch (e) {
    if (e.code === 'P2002') throw new AppError(409, `${def.label} dengan ${jenis === 'unit' ? 'nama atau singkatan' : 'kode'} tersebut sudah ada.`);
    throw e;
  }
}

async function ubah(jenis, id, data) {
  const def = pastikanJenis(jenis);
  if (typeof id !== 'string' || !UUID.test(id)) throw new AppError(400, 'ID tidak valid.');
  const isian = jenis === 'unit' ? validasiUnit(data, false) : validasi(data, false);
  try {
    if (jenis === 'unit') {
      await namaUnitUnik(isian.nama, id);
      const changed = await prisma.bagian.updateMany({ where: { id, deleted_at: null }, data: isian });
      if (!changed.count) throw new AppError(404, `${def.label} tidak ditemukan.`);
      return prisma.bagian.findUnique({ where: { id } });
    }
    return await prisma[def.model].update({ where: { id }, data: isian });
  } catch (e) {
    if (e.code === 'P2025') throw new AppError(404, `${def.label} tidak ditemukan.`);
    if (e.code === 'P2002') throw new AppError(409, `${def.label} dengan ${jenis === 'unit' ? 'nama atau singkatan' : 'kode'} tersebut sudah ada.`);
    throw e;
  }
}

/** Hanya entri yang sama sekali belum dirujuk boleh dibuang, termasuk riwayat terhapus. */
async function hapus(jenis, id, data) {
  const def = pastikanJenis(jenis);
  if (typeof id !== 'string' || !UUID.test(id)) throw new AppError(400, 'ID tidak valid.');
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).length !== 1 || !Object.hasOwn(data, 'konfirmasi')
    || data.konfirmasi !== 'KONFIRMASI HAPUS') {
    throw new AppError(400, 'Ketik KONFIRMASI HAPUS persis untuk menghapus; field lain tidak diperbolehkan.');
  }
  const terpakai = () => new AppError(409, `${def.label} masih digunakan. Nonaktifkan entri ini agar riwayat dan referensinya tetap tersimpan.`);
  try {
    return await prisma.$transaction(async (tx) => {
      // Jangan menyaring aktif/status/deleted_at: riwayat akun, surat, dan disposisi tetap merujuk katalog.
      // Pemeriksaan dan delete satu transaksi juga melindungi FK opsional yang memakai SetNull di SQLite.
      const count = jenis === 'surat' ? { surat_masuk: true, surat_keluar: true }
        : jenis === 'unit' ? { users: true, disposisi: true, surat_masuk: true } : null;
      const row = await tx[def.model].findUnique({ where: { id }, ...(count ? { include: { _count: { select: count } } } : {}) });
      if (!row) throw new AppError(404, `${def.label} tidak ditemukan.`);
      if (row._count && Object.values(row._count).some((n) => n > 0)) throw terpakai();
      // JenisArsip saat ini belum memiliki relasi; jangan menambah deleted_at hanya untuk penghapusan.
      await tx[def.model].delete({ where: { id } });
      return { id: row.id, nama: row.nama };
    });
  } catch (e) {
    if (e.code === 'P2003') throw terpakai(); // FK baru yang masuk bersamaan tidak boleh menjadi 500.
    if (e.code === 'P2025') throw new AppError(404, `${def.label} tidak ditemukan.`);
    throw e;
  }
}

module.exports = { JENIS, daftar, buat, ubah, hapus, pastikanJenis, normalkanKode };
