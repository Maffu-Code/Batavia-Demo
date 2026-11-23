/**
 * Satu evaluasi izin untuk seluruh aplikasi. Hanya superadmin melewati matriks.
 * Grant operasional tidak memperluas lingkup baris, unit, atau penugasan.
 */

// Daftar resource yang DIAKUI sistem. Nama cocok dengan tabel/entitas.
// Nilai dalam array adalah aksi yang DIDUKUNG untuk resource itu.
// Guard route yang menyebut (resource, aksi) di luar daftar di bawah
// akan crash saat boot -- itu disengaja (lihat requirePermission.js).
const AKSI_DIDUKUNG = Object.freeze({
  surat_masuk:        ['create', 'read', 'update', 'delete'],
  surat_keluar:       ['create', 'read', 'update', 'delete'],
  disposisi:          ['create', 'read', 'update', 'delete'],
  tindak_lanjut:      ['create', 'read', 'update'],
  lampiran:           ['create', 'read', 'delete'],
  klasifikasi:        ['create', 'read', 'update', 'delete'],
  bagian:             ['create', 'read', 'update', 'delete'],
  jenis_surat:        ['create', 'read', 'update', 'delete'],
  jenis_arsip:        ['create', 'read', 'update', 'delete'],
  user:               ['create', 'read', 'update', 'delete'],
  izin:               ['read', 'update'],
  activity_log:       ['read'],
  terhapus:           ['read', 'update'],   // 'update' = restore
  // Resource turunan (derived views). Dibatasi hanya 'read'.
  laporan_surat_masuk:  ['read'],
  laporan_surat_keluar: ['read'],
});

// INDUK: child -> parent. Child.read dipaksa false kalau parent.read false.
const INDUK = Object.freeze({
  laporan_surat_masuk:  'surat_masuk',
  laporan_surat_keluar: 'surat_keluar',
});

const RESOURCE = Object.freeze(Object.keys(AKSI_DIDUKUNG));

const LABEL_RESOURCE = Object.freeze({
  surat_masuk:          'Surat Masuk',
  surat_keluar:         'Surat Keluar',
  disposisi:            'Disposisi',
  tindak_lanjut:        'Tindak Lanjut',
  lampiran:             'Lampiran',
  klasifikasi:          'Klasifikasi',
  bagian:               'Bagian',
  jenis_surat:          'Jenis Surat',
  jenis_arsip:          'Jenis Arsip',
  user:                 'User',
  izin:                 'Izin',
  activity_log:         'Log Aktivitas',
  terhapus:             'Riwayat Terhapus',
  laporan_surat_masuk:  'Laporan Surat Masuk',
  laporan_surat_keluar: 'Laporan Surat Keluar',
});

const LABEL_AKSI = Object.freeze({
  create: 'menambah',
  read:   'melihat',
  update: 'mengubah',
  delete: 'menghapus',
});

// Administrasi akun tetap tertutup meskipun baris grant tersimpan dari versi lama.
const KHUSUS_SUPERADMIN = new Set(['user', 'izin', 'activity_log', 'terhapus']);
const SELALU_BOLEH = Object.freeze(['superadmin']);
const BACA_REFERENSI = ['bagian', 'klasifikasi', 'jenis_surat', 'jenis_arsip'];
const BACA_SURAT = ['surat_masuk', 'surat_keluar', 'lampiran', 'laporan_surat_masuk', 'laporan_surat_keluar'];
const DEFAULT_PERAN = Object.freeze({
  tata_usaha: {
    read: [...BACA_REFERENSI, ...BACA_SURAT, 'disposisi', 'tindak_lanjut'],
    create: ['surat_masuk', 'surat_keluar', 'lampiran'],
    update: ['surat_masuk', 'surat_keluar'],
    delete: ['surat_masuk', 'surat_keluar', 'lampiran'],
  },
  kepala_sekolah: {
    read: [...BACA_REFERENSI, ...BACA_SURAT, 'disposisi', 'tindak_lanjut'],
    create: ['disposisi'], update: ['surat_masuk', 'surat_keluar', 'disposisi'], delete: [],
  },
  kepala_bagian: {
    read: [...BACA_REFERENSI, ...BACA_SURAT, 'disposisi', 'tindak_lanjut'],
    create: ['tindak_lanjut', 'lampiran'], update: ['disposisi', 'tindak_lanjut'], delete: [],
  },
  guru_staf: {
    read: [...BACA_REFERENSI, 'surat_masuk', 'surat_keluar', 'disposisi', 'tindak_lanjut', 'lampiran'],
    create: ['tindak_lanjut', 'lampiran'], update: ['disposisi', 'tindak_lanjut'], delete: [],
  },
});

/**
 * Membangun matriks izin efektif untuk SATU user.
 *
 * Return bentuk:
 *   {
 *     surat_masuk: {
 *       read:   { boleh: true,  sumber: 'default' },
 *       create: { boleh: false, sumber: 'eksplisit' },
 *       update: { boleh: false, sumber: 'induk', induk: '...', boleh_asli: true, sumber_asli: 'default' },
 *       delete: { boleh: false, sumber: 'default' },
 *     },
 *     ...
 *   }
 *
 * `sumber` berguna untuk UI panel: 'eksplisit' = baris tersimpan,
 * 'default' = tidak ada baris (pakai aturan default), 'role' = bypass
 * karena peran, 'induk' = ditutup oleh parent.
 */
async function izinEfektif(prisma, user) {
  if (!user || !user.id) {
    throw new Error('izinEfektif: user wajib ada dengan id.');
  }

  // Shortcut: peran bypass -> semua boleh.
  if (SELALU_BOLEH.includes(user.peran)) {
    const semua = {};
    for (const r of RESOURCE) {
      semua[r] = {};
      for (const a of AKSI_DIDUKUNG[r]) {
        semua[r][a] = { boleh: true, sumber: 'role' };
      }
    }
    return semua;
  }

  // Ambil semua baris eksplisit sekali -- hindari N+1.
  const baris = await prisma.userPermission.findMany({
    where: { user_id: user.id },
    select: { resource: true, action: true, allowed: true },
  });

  const peta = new Map();
  for (const b of baris) peta.set(`${b.resource}::${b.action}`, b.allowed);

  // Default berupa daftar putih per peran. Aksi baru selalu mulai tertutup.
  const peranDikenal = Object.hasOwn(DEFAULT_PERAN, user.peran);
  const nilaiDefault = (resource, aksi) => {
    const daftar = peranDikenal ? DEFAULT_PERAN[user.peran][aksi] : null;
    return Boolean(daftar?.includes(resource) && (aksi !== 'delete' || user.bisa_hapus === true));
  };

  const matriks = {};
  for (const r of RESOURCE) {
    matriks[r] = {};
    for (const a of AKSI_DIDUKUNG[r]) {
      const key = `${r}::${a}`;
      if (KHUSUS_SUPERADMIN.has(r) || !peranDikenal || (r === 'bagian' && a !== 'read')
        || (['jenis_surat', 'jenis_arsip'].includes(r) && a === 'delete')) {
        // Batas bisnis juga tampil pada panel; grant tersimpan tidak boleh mengaku berwenang.
        matriks[r][a] = { boleh: false, sumber: 'role' };
      } else if (peta.has(key)) {
        const grant = peta.get(key);
        matriks[r][a] = a === 'delete' && grant && user.bisa_hapus !== true
          ? { boleh: false, sumber: 'batas_hapus', boleh_asli: true, sumber_asli: 'eksplisit' }
          : { boleh: grant, sumber: 'eksplisit' };
      } else {
        matriks[r][a] = { boleh: nilaiDefault(r, a), sumber: 'default' };
      }
    }
  }

  // Terapkan INDUK cascade: kalau parent.read tertutup, child.read dipaksa
  // tertutup -- SIMPAN nilai asli supaya kalau parent dibuka lagi, child
  // kembali ke keadaan "sebelum ditutup paksa".
  for (const [child, parent] of Object.entries(INDUK)) {
    const parentRead = matriks[parent]?.read;
    if (parentRead && parentRead.boleh === false) {
      const asli = matriks[child].read;
      matriks[child].read = {
        boleh:       false,
        sumber:      'induk',
        induk:       parent,
        boleh_asli:  asli.boleh,
        sumber_asli: asli.sumber,
      };
    }
  }

  return matriks;
}

/** Guard dan panel memakai keputusan yang sama, termasuk deny dan induk. */
async function bolehkah(prisma, user, resource, aksi) {
  if (!user || !user.id) return false;
  if (!Object.hasOwn(AKSI_DIDUKUNG, resource) || !AKSI_DIDUKUNG[resource].includes(aksi)) return false;
  const matriks = await izinEfektif(prisma, user);
  return matriks[resource][aksi].boleh === true;
}

module.exports = {
  izinEfektif,
  bolehkah,
  AKSI_DIDUKUNG,
  INDUK,
  RESOURCE,
  LABEL_RESOURCE,
  LABEL_AKSI,
  SELALU_BOLEH,
};
