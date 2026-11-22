const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { bolehkah } = require('./izin.service');
const { logAudit } = require('../middleware/logActivity');

const USER = { id: true, nama_lengkap: true, email: true, peran: true, bagian_id: true };
const SURAT = { klasifikasi: true, jenis_surat: true, pembuat: { select: USER } };
const GLOBAL = ['superadmin', 'tata_usaha', 'kepala_sekolah'];
const NEVER = { id: { in: [] } };
const MASUK = ['diterima', 'dibaca_pimpinan', 'didisposisi', 'selesai', 'diarsipkan'];
const KELUAR = ['draft', 'menunggu_tanda_tangan', 'disetujui', 'terkirim', 'diarsipkan'];
const DISPOSISI = ['baru', 'dibaca', 'diproses', 'selesai'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function global(user) {
  return GLOBAL.includes(user.peran);
}
function text(value, field, required = true, max = 2000) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new AppError(400, `${field} wajib berupa teks 1-${max} karakter.`);
  return value.trim();
}
function date(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new AppError(400, `${field} harus berformat YYYY-MM-DD.`);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value)
    throw new AppError(400, `${field} tidak valid.`);
  return d;
}
function object(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'Isian harus berupa objek.');
}
function fields(body, allowed) {
  object(body);
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new AppError(400, 'Terdapat field yang tidak didukung.');
}
function disposisiScope(user) {
  if (global(user)) return {};
  if (user.peran === 'kepala_bagian' && user.bagian_id)
    return {
      ke_bagian_id: user.bagian_id,
      OR: [{ surat_masuk: { sensitif: false } }, { ke_user_id: user.id }, { surat_masuk: { dibuat_oleh: user.id } }],
    };
  if (user.bagian_id) {
    return {
      OR: [
        { ke_user_id: user.id },
        { ke_bagian_id: user.bagian_id, ke_user_id: null, surat_masuk: { sensitif: false } },
      ],
    };
  }
  return { ke_user_id: user.id };
}
function suratScope(user, jenis) {
  if (global(user)) return {};
  if (jenis === 'masuk') return { disposisi: { some: { deleted_at: null, ...disposisiScope(user) } } };
  if (user.peran === 'kepala_bagian' && user.bagian_id)
    return {
      OR: [{ dibuat_oleh: user.id }, { sensitif: false, pembuat: { bagian_id: user.bagian_id } }],
    };
  return { dibuat_oleh: user.id };
}
function model(jenis, db = prisma) {
  return jenis === 'masuk' ? db.suratMasuk : db.suratKeluar;
}
function resource(jenis) {
  return `surat_${jenis}`;
}
async function permission(user, name, action) {
  if (!(await bolehkah(prisma, user, name, action)))
    throw new AppError(403, 'Izin untuk operasi ini tidak aktif. Hubungi Superadmin.');
}
function query(q, statuses, dateField, searchFields) {
  const integer = (v, fallback) => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < 1)
      throw new AppError(400, 'page dan limit harus bilangan positif.');
    return Number(v);
  };
  const page = integer(q.page, 1);
  const limit = Math.min(integer(q.limit, 20), 100);
  if (!Number.isSafeInteger((page - 1) * limit) || (page - 1) * limit > 2147483647)
    throw new AppError(400, 'Halaman terlalu jauh. Persempit pencarian.');
  const clauses = [];
  if (q.status !== undefined && q.status !== '') {
    if (!statuses.includes(q.status)) throw new AppError(400, 'Filter status tidak valid.');
    clauses.push({ status: q.status });
  }
  const range = {};
  if (q.dari) range.gte = date(q.dari, 'dari');
  if (q.sampai) range.lt = new Date(date(q.sampai, 'sampai').getTime() + 86400000);
  if (range.gte && range.lt && range.gte >= range.lt) throw new AppError(400, 'Rentang tanggal tidak valid.');
  if (Object.keys(range).length) clauses.push({ [dateField]: range });
  if (q.q !== undefined && q.q !== '') {
    const value = text(q.q, 'q', true, 200);
    clauses.push({ OR: searchFields.map((field) => ({ [field]: { contains: value } })) });
  }
  return { page, limit, where: { AND: clauses } };
}
async function listSurat(user, jenis, q) {
  const p = query(q, jenis === 'masuk' ? MASUK : KELUAR, jenis === 'masuk' ? 'tanggal_terima' : 'tanggal_surat', [
    'nomor_registrasi',
    'nomor_surat',
    'perihal',
    jenis === 'masuk' ? 'pengirim' : 'tujuan',
  ]);
  const where = { deleted_at: null, AND: [suratScope(user, jenis), p.where] };
  const [data, total] = await prisma.$transaction([
    model(jenis).findMany({
      where,
      include: SURAT,
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    model(jenis).count({ where }),
  ]);
  return { data, meta: { page: p.page, limit: p.limit, total, total_pages: Math.ceil(total / p.limit) } };
}
async function findSurat(user, jenis, id, db = prisma) {
  const row = await model(jenis, db).findFirst({
    where: { id, deleted_at: null, AND: [suratScope(user, jenis)] },
    include: SURAT,
  });
  if (!row) throw new AppError(404, 'Surat tidak ditemukan.');
  return row;
}
async function detailSurat(user, jenis, id) {
  const row = await findSurat(user, jenis, id);
  if (jenis === 'masuk' && (await bolehkah(prisma, user, 'disposisi', 'read')))
    row.disposisi = await prisma.disposisi.findMany({
      where: { surat_masuk_id: id, deleted_at: null, AND: [disposisiScope(user)] },
      select: await disposisiSelect(user, false),
      orderBy: { created_at: 'asc' },
    });
  row.lampiran = (await bolehkah(prisma, user, 'lampiran', 'read'))
    ? await prisma.lampiran.findMany({
        where: { entitas_jenis: resource(jenis), entitas_id: id, deleted_at: null },
        select: { id: true, nama_asli: true, mime: true, ukuran_byte: true, created_at: true },
      })
    : [];
  return row;
}
async function activeRef(db, name, id) {
  if (
    !(await db[name].findFirst({ where: { id, aktif: true, ...(name === 'jenisSurat' ? {} : { deleted_at: null }) } }))
  )
    throw new AppError(400, `${name} tidak aktif atau tidak ditemukan.`);
}
async function metadata(db, jenis, body, partial = false) {
  const data = {};
  for (const field of [
    'nomor_surat',
    jenis === 'masuk' ? 'pengirim' : 'tujuan',
    'perihal',
    'klasifikasi_id',
    'jenis_surat_id',
  ]) {
    const value = text(
      body[field],
      field,
      !partial && !(jenis === 'keluar' && field === 'nomor_surat'),
      field === 'perihal' ? 2000 : 300,
    );
    if (value !== undefined) data[field] = value;
  }
  for (const field of jenis === 'masuk' ? ['tanggal_surat', 'tanggal_terima'] : ['tanggal_surat'])
    if (!partial || body[field] !== undefined) data[field] = date(body[field], field);
  if (body.sensitif !== undefined) {
    if (typeof body.sensitif !== 'boolean') throw new AppError(400, 'sensitif harus boolean.');
    data.sensitif = body.sensitif;
  }
  if (data.klasifikasi_id) await activeRef(db, 'klasifikasi', data.klasifikasi_id);
  if (data.jenis_surat_id) await activeRef(db, 'jenisSurat', data.jenis_surat_id);
  return data;
}
const INPUT = [
  'nomor_surat',
  'pengirim',
  'tujuan',
  'perihal',
  'klasifikasi_id',
  'jenis_surat_id',
  'tanggal_surat',
  'tanggal_terima',
  'sensitif',
];
async function createSurat(user, jenis, body) {
  fields(
    body,
    INPUT.filter(
      (f) =>
        !((jenis === 'masuk' && f === 'tujuan') || (jenis === 'keluar' && ['pengirim', 'tanggal_terima'].includes(f))),
    ),
  );
  if (!['superadmin', 'tata_usaha'].includes(user.peran))
    throw new AppError(403, 'Input surat hanya untuk Tata Usaha atau Superadmin.');
  return prisma.$transaction(
    async (tx) => {
      const data = await metadata(tx, jenis, body);
      if (jenis === 'masuk' && data.tanggal_terima < data.tanggal_surat)
        throw new AppError(400, 'Tanggal terima tidak boleh sebelum tanggal surat.');
      const stamp = jenis === 'masuk' ? data.tanggal_terima : data.tanggal_surat;
      const tahun = stamp.getUTCFullYear();
      // Atomic write before allocation. Counter is global per year and direction.
      const sequence = await tx.nomorSuratSequence.upsert({
        where: { tahun_jenis: { tahun, jenis } },
        update: { nomor: { increment: 1 } },
        create: { tahun, jenis, nomor: 1 },
      });
      data.nomor_registrasi = `${jenis === 'masuk' ? 'SM' : 'SK'}/${String(sequence.nomor).padStart(3, '0')}/${ROMAN[stamp.getUTCMonth()]}/${tahun}`;
      if (jenis === 'keluar' && !data.nomor_surat) data.nomor_surat = data.nomor_registrasi;
      data.dibuat_oleh = user.id;
      return model(jenis, tx).create({ data, include: SURAT });
    },
    { maxWait: 20000, timeout: 20000 },
  );
}
async function patchSurat(user, jenis, id, body) {
  fields(body, [
    ...INPUT.filter(
      (f) =>
        !((jenis === 'masuk' && f === 'tujuan') || (jenis === 'keluar' && ['pengirim', 'tanggal_terima'].includes(f))),
    ),
    'status',
  ]);
  if (!Object.keys(body).length) throw new AppError(400, 'Isian perubahan kosong.');
  return prisma.$transaction(async (tx) => {
    const row = await findSurat(user, jenis, id, tx);
    if (!global(user)) throw new AppError(403, 'Perubahan surat hanya untuk Tata Usaha, pimpinan atau Superadmin.');
    const hasMetadata = Object.keys(body).some((key) => key !== 'status');
    if (
      hasMetadata &&
      (!['superadmin', 'tata_usaha'].includes(user.peran) ||
        (jenis === 'keluar' && row.status !== 'draft') ||
        (jenis === 'masuk' && row.status === 'diarsipkan'))
    )
      throw new AppError(409, 'Metadata tidak dapat diubah pada tahap ini.');
    const data = hasMetadata ? await metadata(tx, jenis, body, true) : {};
    if (jenis === 'masuk' && (data.tanggal_terima || row.tanggal_terima) < (data.tanggal_surat || row.tanggal_surat))
      throw new AppError(400, 'Tanggal terima tidak boleh sebelum tanggal surat.');
    if (body.status !== undefined) {
      const statuses = jenis === 'masuk' ? MASUK : KELUAR;
      if (!statuses.includes(body.status)) throw new AppError(400, 'Status tidak valid.');
      const transitions =
        jenis === 'masuk'
          ? {
              diterima: ['dibaca_pimpinan'],
              dibaca_pimpinan: [],
              didisposisi: [],
              selesai: ['diarsipkan'],
              diarsipkan: [],
            }
          : {
              draft: ['menunggu_tanda_tangan'],
              menunggu_tanda_tangan: ['disetujui', 'draft'],
              disetujui: ['terkirim'],
              terkirim: ['diarsipkan'],
              diarsipkan: [],
            };
      if (!transitions[row.status]?.includes(body.status)) throw new AppError(409, 'Transisi status tidak diizinkan.');
      if (
        (jenis === 'masuk' && body.status === 'dibaca_pimpinan') ||
        (jenis === 'keluar' && ['disetujui', 'draft'].includes(body.status))
      ) {
        if (!['superadmin', 'kepala_sekolah'].includes(user.peran))
          throw new AppError(403, 'Persetujuan atau telaah hanya untuk pimpinan.');
      }
      data.status = body.status;
    }
    const result = await model(jenis, tx).updateMany({
      where: { id, status: row.status, updated_at: row.updated_at },
      data,
    });
    if (!result.count) throw new AppError(409, 'Data telah berubah. Muat ulang.');
    return findSurat(user, jenis, id, tx);
  });
}
// Satu proyeksi publik: deny catatan menutup scalar dan relasinya sekaligus.
async function disposisiSelect(user, denganSurat = true) {
  const bacaCatatan = await bolehkah(prisma, user, 'tindak_lanjut', 'read');
  return {
    id: true,
    surat_masuk_id: true,
    dari_user_id: true,
    ke_bagian_id: true,
    ke_user_id: true,
    instruksi: true,
    deadline: true,
    status: true,
    dibaca_at: true,
    created_at: true,
    updated_at: true,
    surat_masuk: denganSurat ? { include: SURAT } : false,
    dari: { select: USER },
    ke_bagian: true,
    ke_user: { select: USER },
    catatan: bacaCatatan,
    tindak_lanjut: bacaCatatan ? { include: { oleh: { select: USER } }, orderBy: { created_at: 'asc' } } : false,
  };
}
function disposisiWhere(user, id) {
  return {
    ...(id ? { id } : {}),
    deleted_at: null,
    surat_masuk: { deleted_at: null, AND: [suratScope(user, 'masuk')] },
    AND: [disposisiScope(user)],
  };
}
async function findDisposisi(user, id, db = prisma) {
  const row = await db.disposisi.findFirst({ where: disposisiWhere(user, id), select: await disposisiSelect(user) });
  if (!row) throw new AppError(404, 'Disposisi tidak ditemukan.');
  return row;
}
async function listDisposisi(user, q) {
  const bacaCatatan = await bolehkah(prisma, user, 'tindak_lanjut', 'read');
  const p = query(q, DISPOSISI, 'created_at', bacaCatatan ? ['instruksi', 'catatan'] : ['instruksi']);
  if (q.q)
    p.where.AND[p.where.AND.length - 1].OR.push(
      ...['perihal', 'nomor_surat', 'nomor_registrasi'].map((field) => ({
        surat_masuk: { [field]: { contains: q.q.trim() } },
      })),
    );
  const where = {
    deleted_at: null,
    surat_masuk: { deleted_at: null, AND: [suratScope(user, 'masuk')] },
    AND: [disposisiScope(user), p.where],
  };
  const [data, total] = await prisma.$transaction([
    prisma.disposisi.findMany({
      where,
      select: await disposisiSelect(user),
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      skip: (p.page - 1) * p.limit,
      take: p.limit,
    }),
    prisma.disposisi.count({ where }),
  ]);
  return { data, meta: { page: p.page, limit: p.limit, total, total_pages: Math.ceil(total / p.limit) } };
}
async function assignee(db, bagianId, userId) {
  await activeRef(db, 'bagian', text(bagianId, 'ke_bagian_id', true, 300));
  if (userId !== undefined && userId !== null) {
    text(userId, 'ke_user_id', true, 300);
    if (!(await db.user.findFirst({ where: { id: userId, bagian_id: bagianId, aktif: true, deleted_at: null } })))
      throw new AppError(400, 'Penerima harus pengguna aktif dalam bagian tujuan.');
  }
}
async function createDisposisi(user, body) {
  fields(body, ['surat_masuk_id', 'ke_bagian_id', 'ke_user_id', 'instruksi', 'deadline']);
  if (!['superadmin', 'kepala_sekolah'].includes(user.peran))
    throw new AppError(403, 'Disposisi baru hanya untuk pimpinan atau Superadmin.');
  const suratId = text(body.surat_masuk_id, 'surat_masuk_id', true, 300);
  const instruksi = text(body.instruksi, 'instruksi');
  return prisma.$transaction(async (tx) => {
    const surat = await findSurat(user, 'masuk', suratId, tx);
    if (['selesai', 'diarsipkan'].includes(surat.status))
      throw new AppError(409, 'Surat sudah selesai atau diarsipkan.');
    const deadlineVal = body.deadline ? date(body.deadline, 'deadline') : null;
    let primaryId = null;
    if (body.ke_bagian_id === 'SEMUA') {
      const allUnits = await tx.bagian.findMany({
        where: { aktif: true, deleted_at: null },
        orderBy: { nama: 'asc' },
      });
      if (!allUnits.length) throw new AppError(400, 'Belum ada unit kerja aktif dalam sistem.');
      for (const unit of allUnits) {
        const row = await tx.disposisi.create({
          data: {
            surat_masuk_id: suratId,
            dari_user_id: user.id,
            ke_bagian_id: unit.id,
            ke_user_id: null,
            instruksi,
            deadline: deadlineVal,
          },
        });
        if (!primaryId) primaryId = row.id;
      }
    } else {
      await assignee(tx, body.ke_bagian_id, body.ke_user_id);
      const row = await tx.disposisi.create({
        data: {
          surat_masuk_id: suratId,
          dari_user_id: user.id,
          ke_bagian_id: body.ke_bagian_id,
          ke_user_id: body.ke_user_id || null,
          instruksi,
          deadline: deadlineVal,
        },
      });
      primaryId = row.id;
    }
    await tx.suratMasuk.update({ where: { id: suratId }, data: { status: 'didisposisi' } });
    return findDisposisi(user, primaryId, tx);
  });
}
async function patchDisposisi(user, id, body) {
  fields(body, ['status', 'catatan', 'ke_user_id']);
  if (!Object.keys(body).length) throw new AppError(400, 'Isian perubahan kosong.');
  return prisma.$transaction(async (tx) => {
    // Data internal hanya untuk validasi perubahan; response memakai proyeksi publik.
    const row = await tx.disposisi.findFirst({
      where: disposisiWhere(user, id),
      include: { surat_masuk: { include: SURAT } },
    });
    if (!row) throw new AppError(404, 'Disposisi tidak ditemukan.');
    if (body.status !== undefined || body.catatan !== undefined) {
      const pelaksana =
        (user.peran === 'guru_staf' && (
          row.ke_user_id === user.id ||
          (row.ke_user_id === null && user.bagian_id === row.ke_bagian_id)
        )) ||
        (user.peran === 'kepala_bagian' && Boolean(user.bagian_id) && row.ke_bagian_id === user.bagian_id);
      if (!pelaksana)
        throw new AppError(
          403,
          'Hanya penerima tugas atau anggota unit tujuan yang dapat mengubah progres dan catatan.',
        );
      if (body.catatan !== undefined || body.status === 'selesai') await permission(user, 'tindak_lanjut', 'create');
    }
    if (row.surat_masuk.status === 'diarsipkan' || row.status === 'selesai')
      throw new AppError(409, 'Disposisi selesai atau diarsipkan tidak dapat diubah.');
    const data = {};
    if (body.ke_user_id !== undefined) {
      if (!['superadmin', 'kepala_sekolah', 'kepala_bagian'].includes(user.peran))
        throw new AppError(403, 'Hanya pimpinan atau kepala bagian dapat menetapkan pelaksana.');
      await assignee(tx, row.ke_bagian_id, body.ke_user_id);
      data.ke_user_id = body.ke_user_id;
    }
    if (body.status !== undefined) {
      if (!DISPOSISI.includes(body.status)) throw new AppError(400, 'Status disposisi tidak valid.');
      const transitions = { baru: ['dibaca', 'diproses'], dibaca: ['diproses'], diproses: ['selesai'] };
      if (!transitions[row.status]?.includes(body.status))
        throw new AppError(409, 'Transisi status disposisi tidak diizinkan.');
      if (body.status === 'selesai' && !body.catatan && !row.catatan)
        throw new AppError(400, 'Catatan hasil wajib untuk penyelesaian.');
      data.status = body.status;
      if (!row.dibaca_at) data.dibaca_at = new Date();
    }
    if (body.catatan !== undefined) data.catatan = text(body.catatan, 'catatan', true, 5000);
    const changed = await tx.disposisi.updateMany({
      where: { id, status: row.status, updated_at: row.updated_at },
      data,
    });
    if (!changed.count) throw new AppError(409, 'Data telah berubah. Muat ulang.');
    if (data.catatan)
      await tx.tindakLanjut.create({
        data: {
          disposisi_id: id,
          oleh_user_id: user.id,
          catatan: data.catatan,
          selesai_at: data.status === 'selesai' ? new Date() : null,
        },
      });
    if (
      data.status === 'selesai' &&
      !(await tx.disposisi.count({
        where: { surat_masuk_id: row.surat_masuk_id, deleted_at: null, status: { not: 'selesai' } },
      }))
    )
      await tx.suratMasuk.update({ where: { id: row.surat_masuk_id }, data: { status: 'selesai' } });
    const result = await tx.disposisi.findFirst({
      where: disposisiWhere(user, id),
      select: await disposisiSelect(user),
    });
    // Delegasi sensitif sah boleh melepas akses pelaku. Jangan batalkan transaksi
    // atau mengembalikan isi surat yang kini sudah di luar lingkupnya.
    return result || { id, status: data.status || row.status, ke_user_id: data.ke_user_id, akses_dilepas: true };
  });
}
async function referensi(user) {
  const userScope = global(user)
    ? {}
    : user.peran === 'kepala_bagian' && user.bagian_id
      ? { bagian_id: user.bagian_id }
      : { id: user.id };
  const [bagian, klasifikasi, jenis_surat, pengguna] = await Promise.all([
    prisma.bagian.findMany({ where: { aktif: true, deleted_at: null }, orderBy: { nama: 'asc' } }),
    prisma.klasifikasi.findMany({
      where: { aktif: true, deleted_at: null },
      orderBy: [{ urutan: 'asc' }, { kode: 'asc' }],
    }),
    prisma.jenisSurat.findMany({ where: { aktif: true }, orderBy: { nama: 'asc' } }),
    prisma.user.findMany({
      where: { aktif: true, deleted_at: null, ...userScope },
      select: USER,
      orderBy: { nama_lengkap: 'asc' },
    }),
  ]);
  return { bagian, klasifikasi, jenis_surat, pengguna };
}
async function dashboard(user) {
  const [canMasuk, canKeluar, canTask] = await Promise.all(
    ['surat_masuk', 'surat_keluar', 'disposisi'].map((r) => bolehkah(prisma, user, r, 'read')),
  );
  const masukWhere = { deleted_at: null, AND: [canMasuk ? suratScope(user, 'masuk') : NEVER] };
  const keluarWhere = { deleted_at: null, AND: [canKeluar ? suratScope(user, 'keluar') : NEVER] };
  const taskWhere = {
    deleted_at: null,
    AND: [canTask ? disposisiScope(user) : NEVER],
    surat_masuk: { deleted_at: null, AND: [suratScope(user, 'masuk')] },
  };
  const aktif = { ...taskWhere, status: { not: 'selesai' } };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [surat_masuk, surat_keluar, disposisi_aktif, terlambat, prioritas, masuk, keluar, taskIds] = await Promise.all([
    prisma.suratMasuk.count({ where: masukWhere }),
    prisma.suratKeluar.count({ where: keluarWhere }),
    prisma.disposisi.count({ where: aktif }),
    prisma.disposisi.count({ where: { ...aktif, deadline: { lt: today } } }),
    prisma.disposisi.findMany({
      where: aktif,
      select: await disposisiSelect(user),
      orderBy: [{ deadline: 'asc' }, { created_at: 'asc' }],
      take: 8,
    }),
    prisma.suratMasuk.findMany({ where: masukWhere, select: { id: true, tanggal_terima: true } }),
    prisma.suratKeluar.findMany({ where: keluarWhere, select: { id: true, tanggal_surat: true } }),
    prisma.disposisi.findMany({ where: taskWhere, select: { id: true } }),
  ]);
  const buckets = new Map();
  for (const row of masuk) {
    const month = row.tanggal_terima.toISOString().slice(0, 7);
    if (!buckets.has(month)) buckets.set(month, { bulan: month, masuk: 0, keluar: 0 });
    buckets.get(month).masuk++;
  }
  for (const row of keluar) {
    const month = row.tanggal_surat.toISOString().slice(0, 7);
    if (!buckets.has(month)) buckets.set(month, { bulan: month, masuk: 0, keluar: 0 });
    buckets.get(month).keluar++;
  }
  const aktivitas = await prisma.activityLog.findMany({
    where: {
      OR: [
        { entitas: 'surat_masuk', entitas_id: { in: masuk.map((r) => r.id) } },
        { entitas: 'surat_keluar', entitas_id: { in: keluar.map((r) => r.id) } },
        { entitas: 'disposisi', entitas_id: { in: taskIds.map((r) => r.id) } },
      ],
    },
    select: { id: true, aksi: true, entitas: true, entitas_id: true, nama_user: true, created_at: true },
    orderBy: { created_at: 'desc' },
    take: 10,
  });
  return {
    lingkup: global(user) ? 'sekolah' : user.peran === 'kepala_bagian' ? 'unit' : 'penugasan',
    ringkasan: { surat_masuk, surat_keluar, disposisi_aktif, terlambat },
    tren: [...buckets.values()].sort((a, b) => a.bulan.localeCompare(b.bulan)).slice(-12),
    prioritas,
    aktivitas,
  };
}
function audit(req, aksi, entitas, row) {
  logAudit({ user: req.user, req, aksi, entitas, entitasId: row.id, detail: `${aksi} ${entitas}` });
}
module.exports = {
  USER,
  SURAT,
  text,
  date,
  permission,
  findSurat,
  detailSurat,
  listSurat,
  createSurat,
  patchSurat,
  findDisposisi,
  listDisposisi,
  createDisposisi,
  patchDisposisi,
  referensi,
  dashboard,
  audit,
};
