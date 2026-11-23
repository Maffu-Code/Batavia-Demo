const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { bolehkah } = require('./izin.service');
const { logAudit } = require('../middleware/logActivity');
const { hariJakarta, deadlineWhere, timeline } = require('./alur-waktu');

const USER = { id: true, nama_lengkap: true, email: true, peran: true, bagian_id: true };
const SURAT = { klasifikasi: true, jenis_surat: true, pembuat: { select: USER } };
const SURAT_MASUK = { ...SURAT, bagian: true };
const PELAKSANA = ['guru_staf', 'kepala_bagian'];
const LAMPIRAN = { id: true, nama_asli: true, mime: true, ukuran_byte: true, created_at: true };
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
  return penerimaScope(user);
}
// Penerima berbeda dari pengawas. Kepala bagian boleh mengelola progres
// lembarnya, tetapi permintaan "tugasku" tidak mencakup PIC lain.
function penerimaScope(user) {
  const OR = [{ ke_user_id: user.id }];
  if (PELAKSANA.includes(user.peran) && user.bagian_id)
    OR.push({ ke_bagian_id: user.bagian_id, ke_user_id: null, surat_masuk: { sensitif: false } });
  return { OR };
}
function pelaksana(user, row) {
  if (user.peran === 'kepala_bagian') return Boolean(user.bagian_id) && row.ke_bagian_id === user.bagian_id;
  return user.peran === 'guru_staf' && (
    row.ke_user_id === user.id ||
    (row.ke_user_id === null && user.bagian_id === row.ke_bagian_id && !row.surat_masuk.sensitif)
  );
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
async function permission(user, name, action, db = prisma) {
  if (!(await bolehkah(db, user, name, action)))
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
function filterId(q, clauses, field, column = field) {
  if (q[field] !== undefined && q[field] !== '') clauses.push({ [column]: text(q[field], field, true, 300) });
}
function flag(q, field) {
  if (q[field] === undefined) return false;
  if (q[field] !== '1') throw new AppError(400, `${field} harus bernilai 1.`);
  return true;
}
async function listSurat(user, jenis, q) {
  const p = query(q, jenis === 'masuk' ? MASUK : KELUAR, jenis === 'masuk' ? 'tanggal_terima' : 'tanggal_surat', [
    'nomor_registrasi',
    'nomor_surat',
    'perihal',
    jenis === 'masuk' ? 'pengirim' : 'tujuan',
  ]);
  const clauses = p.where.AND;
  if (flag(q, 'arsip')) {
    if (!global(user) && user.peran !== 'kepala_bagian') throw new AppError(403, 'Daftar arsip tidak tersedia untuk peran ini.');
    if (q.status && q.status !== 'diarsipkan') throw new AppError(400, 'Filter status tidak sesuai daftar arsip.');
    clauses.push({ status: 'diarsipkan' });
  }
  for (const field of ['jenis_surat_id', 'klasifikasi_id']) filterId(q, clauses, field);
  if (jenis === 'masuk') filterId(q, clauses, 'bagian_id');
  else if (q.bagian_id !== undefined) throw new AppError(400, 'Filter bagian hanya untuk surat masuk.');
  if (q.sensitif !== undefined && q.sensitif !== '') {
    if (!['true', 'false'].includes(q.sensitif)) throw new AppError(400, 'Filter sensitif harus true atau false.');
    clauses.push({ sensitif: q.sensitif === 'true' });
  }
  const where = { deleted_at: null, AND: [suratScope(user, jenis), p.where] };
  const [data, total] = await prisma.$transaction([
    model(jenis).findMany({
      where,
      include: jenis === 'masuk' ? SURAT_MASUK : SURAT,
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
    include: jenis === 'masuk' ? SURAT_MASUK : SURAT,
  });
  if (!row) throw new AppError(404, 'Surat tidak ditemukan.');
  return row;
}
async function detailSurat(user, jenis, id) {
  const row = await findSurat(user, jenis, id);
  if (jenis === 'masuk' && (await bolehkah(prisma, user, 'disposisi', 'read')))
    row.disposisi = await projectedDisposisi(user, await prisma.disposisi.findMany({
      where: { surat_masuk_id: id, deleted_at: null, AND: [disposisiScope(user)] },
      select: await disposisiSelect(user, false),
      orderBy: { created_at: 'asc' },
    }), row);
  row.lampiran = await listLampiran(user, resource(jenis), id);
  return row;
}
async function listLampiran(user, entitas_jenis, entitas_id) {
  if (!(await bolehkah(prisma, user, 'lampiran', 'read'))) return [];
  return prisma.lampiran.findMany({
    where: { entitas_jenis, entitas_id, deleted_at: null },
    select: LAMPIRAN,
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
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
  if (jenis === 'masuk' && body.bagian_id !== undefined) {
    data.bagian_id = body.bagian_id === null ? null : text(body.bagian_id, 'bagian_id', true, 300);
    if (data.bagian_id) await activeRef(db, 'bagian', data.bagian_id);
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
  'bagian_id',
];
const suratInput = (jenis) => INPUT.filter((f) => !(jenis === 'masuk'
  ? ['tujuan'].includes(f) : ['pengirim', 'tanggal_terima', 'bagian_id'].includes(f)));
async function createSurat(user, jenis, body) {
  fields(body, suratInput(jenis));
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
      return model(jenis, tx).create({ data, include: jenis === 'masuk' ? SURAT_MASUK : SURAT });
    },
    { maxWait: 20000, timeout: 20000 },
  );
}
async function patchSurat(user, jenis, id, body) {
  fields(body, [...suratInput(jenis), 'status']);
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
    if (jenis === 'masuk' && data.sensitif === true && !row.sensitif && await tx.disposisi.count({
      where: { surat_masuk_id: id, deleted_at: null, ke_user_id: null },
    })) throw new AppError(409, 'Surat dengan disposisi kolektif tidak dapat dijadikan sensitif.');
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
      if (jenis === 'masuk' && body.status === 'dibaca_pimpinan' && user.peran !== 'kepala_sekolah')
        throw new AppError(403, 'Telaah surat masuk hanya untuk Kepala Sekolah.');
      if (jenis === 'keluar' && ['disetujui', 'draft'].includes(body.status) && !['superadmin', 'kepala_sekolah'].includes(user.peran))
        throw new AppError(403, 'Persetujuan hanya untuk pimpinan.');
      data.status = body.status;
    }
    const result = await model(jenis, tx).updateMany({
          where: { id, deleted_at: null, status: row.status, updated_at: row.updated_at },
      data,
    });
    if (!result.count) throw new AppError(409, 'Data telah berubah. Muat ulang.');
    return findSurat(user, jenis, id, tx);
  });
}
// Satu proyeksi publik: deny catatan menutup scalar dan relasinya sekaligus.
async function disposisiSelect(user, denganSurat = true, db = prisma) {
  const bacaCatatan = await bolehkah(db, user, 'tindak_lanjut', 'read');
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
    surat_masuk: denganSurat ? { include: SURAT_MASUK } : false,
    dari: { select: USER },
    ke_bagian: true,
    ke_user: { select: USER },
    catatan: bacaCatatan,
    tindak_lanjut: bacaCatatan ? { include: { oleh: { select: USER } }, orderBy: { created_at: 'asc' } } : false,
  };
}
async function projectedDisposisi(user, rows, parent, db = prisma) {
  const canUpdate = await bolehkah(db, user, 'disposisi', 'update');
  return rows.map((row) => {
    const surat = parent || row.surat_masuk;
    return {
      ...row,
      can_tindak_lanjut: canUpdate && row.status !== 'selesai' && surat.status !== 'diarsipkan' &&
        pelaksana(user, { ...row, surat_masuk: surat }),
    };
  });
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
  const row = await db.disposisi.findFirst({ where: disposisiWhere(user, id), select: await disposisiSelect(user, true, db) });
  if (!row) throw new AppError(404, 'Disposisi tidak ditemukan.');
  return (await projectedDisposisi(user, [row], null, db))[0];
}
async function hasAssignedSurat(user, id) {
  return Boolean(await prisma.disposisi.findFirst({
    where: { AND: [disposisiWhere(user), penerimaScope(user), { surat_masuk_id: id }] },
    select: { id: true },
  }));
}
async function detailDisposisi(user, id) {
  const row = await findDisposisi(user, id);
  const canReadSurat = await bolehkah(prisma, user, 'surat_masuk', 'read');
  row.lampiran = canReadSurat || await hasAssignedSurat(user, row.surat_masuk_id)
    ? await listLampiran(user, 'surat_masuk', row.surat_masuk_id) : [];
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
  filterId(q, p.where.AND, 'bagian_id', 'ke_bagian_id');
  if (flag(q, 'tugasku')) p.where.AND.push(penerimaScope(user));
  if (q.tenggat !== undefined && q.tenggat !== '') p.where.AND.push(tugasBertenggat(q.tenggat, hariJakarta()));
  const where = { AND: [disposisiWhere(user), p.where] };
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
  return { data: await projectedDisposisi(user, data), meta: { page: p.page, limit: p.limit, total, total_pages: Math.ceil(total / p.limit) } };
}
function tugasAktif() {
  return { status: { not: 'selesai' }, surat_masuk: { status: { notIn: ['selesai', 'diarsipkan'] } } };
}
function tugasBertenggat(mode, today) {
  return { ...tugasAktif(), ...deadlineWhere(mode, today) };
}
async function assignee(db, bagianId, userIds) {
  await activeRef(db, 'bagian', bagianId);
  const ids = Array.isArray(userIds) ? userIds : userIds === null ? [] : [userIds];
  if (ids.length && await db.user.count({ where: {
    id: { in: ids }, bagian_id: bagianId, aktif: true, deleted_at: null, peran: { in: PELAKSANA },
  } }) !== ids.length)
    throw new AppError(400, 'Penerima harus kepala bagian atau guru/staf aktif dalam unit tujuan.');
}
function explicitRecipients(body) {
  if (!Object.hasOwn(body, 'ke_user_ids'))
    return body.ke_user_id == null ? [] : [text(body.ke_user_id, 'ke_user_id', true, 300)];
  if (Object.hasOwn(body, 'ke_user_id'))
    throw new AppError(400, 'Gunakan ke_user_ids atau ke_user_id, bukan keduanya.');
  if (!Array.isArray(body.ke_user_ids) || !body.ke_user_ids.length || body.ke_user_ids.length > 100)
    throw new AppError(400, 'ke_user_ids wajib berupa daftar 1-100 penerima. Untuk tugas kolektif, jangan sertakan daftar penerima.');
  const ids = body.ke_user_ids.map((id) => {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim()))
      throw new AppError(400, 'Setiap ke_user_ids wajib berupa UUID penerima yang valid.');
    return id.trim().toLowerCase();
  });
  if (new Set(ids).size !== ids.length) throw new AppError(400, 'Daftar penerima tidak boleh berisi duplikat.');
  return ids;
}
async function createDisposisi(user, body) {
  fields(body, ['surat_masuk_id', 'ke_bagian_id', 'ke_user_id', 'ke_user_ids', 'instruksi', 'deadline']);
  if (user.peran !== 'kepala_sekolah') throw new AppError(403, 'Disposisi baru hanya untuk Kepala Sekolah.');
  const suratId = text(body.surat_masuk_id, 'surat_masuk_id', true, 300);
  const bagianId = text(body.ke_bagian_id, 'ke_bagian_id', true, 300);
  const userIds = explicitRecipients(body);
  const instruksi = text(body.instruksi, 'instruksi');
  const deadline = body.deadline == null || body.deadline === '' ? null : date(body.deadline, 'deadline');
  return prisma.$transaction(async (tx) => {
    const surat = await findSurat(user, 'masuk', suratId, tx);
    if (!['dibaca_pimpinan', 'didisposisi'].includes(surat.status))
      throw new AppError(409, 'Surat harus ditelaah Kepala Sekolah dan belum ditutup.');
    const broadcast = bagianId === 'SEMUA';
    if (surat.sensitif && (broadcast || !userIds.length))
      throw new AppError(400, 'Surat sensitif wajib ditujukan ke penerima tertentu.');
    let targets;
    if (broadcast) {
      if (userIds.length) throw new AppError(400, 'Disposisi semua unit tidak menerima PIC tertentu.');
      const units = await tx.bagian.findMany({
        where: { aktif: true, deleted_at: null }, select: { id: true }, orderBy: { nama: 'asc' },
      });
      targets = units.map((unit) => ({ ke_bagian_id: unit.id, ke_user_id: null }));
      if (!targets.length) throw new AppError(400, 'Belum ada unit kerja aktif dalam sistem.');
    } else {
      // Validate the complete target set inside the write transaction, before any mutation.
      await assignee(tx, bagianId, userIds);
      targets = (userIds.length ? userIds : [null]).map((id) => ({ ke_bagian_id: bagianId, ke_user_id: id }));
    }
    const changed = await tx.suratMasuk.updateMany({
      where: { id: suratId, deleted_at: null, status: surat.status, updated_at: surat.updated_at },
      data: { status: 'didisposisi' },
    });
    if (!changed.count) throw new AppError(409, 'Data telah berubah. Muat ulang.');
    const created_ids = [];
    for (const target of targets) {
      const row = await tx.disposisi.create({
        data: {
          surat_masuk_id: suratId, dari_user_id: user.id, ...target,
          instruksi, deadline, notifikasi: { create: {} },
        },
        select: { id: true },
      });
      created_ids.push(row.id);
    }
    // Preserve the primary-row response used by legacy callers, adding fanout metadata.
    return { ...await findDisposisi(user, created_ids[0], tx), created_ids, jumlah_dibuat: created_ids.length };
  }, { maxWait: 20000, timeout: 20000 });
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
      if (!pelaksana(user, row))
        throw new AppError(
          403,
          'Hanya penerima tugas atau anggota unit tujuan yang dapat mengubah progres dan catatan.',
        );
      if (body.catatan !== undefined || body.status === 'selesai') await permission(user, 'tindak_lanjut', 'create', tx);
    }
    if (row.surat_masuk.status === 'diarsipkan' || row.status === 'selesai')
      throw new AppError(409, 'Disposisi selesai atau diarsipkan tidak dapat diubah.');
    const data = {};
    if (body.ke_user_id !== undefined) {
      if (!['superadmin', 'kepala_sekolah', 'kepala_bagian'].includes(user.peran))
        throw new AppError(403, 'Hanya pimpinan atau kepala bagian dapat menetapkan pelaksana.');
      data.ke_user_id = body.ke_user_id === null ? null : text(body.ke_user_id, 'ke_user_id', true, 300);
      if (row.surat_masuk.sensitif && !data.ke_user_id)
        throw new AppError(400, 'Surat sensitif wajib ditujukan ke penerima tertentu.');
      await assignee(tx, row.ke_bagian_id, data.ke_user_id);
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
          where: { id, deleted_at: null, status: row.status, updated_at: row.updated_at },
      data,
    });
    if (!changed.count) throw new AppError(409, 'Data telah berubah. Muat ulang.');
    if (data.ke_user_id !== undefined && data.ke_user_id !== row.ke_user_id) {
      await tx.notifikasiPenugasan.deleteMany({ where: { disposisi_id: id } });
      await tx.notifikasiPenugasan.create({ data: { disposisi_id: id } });
    }
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
      select: await disposisiSelect(user, true, tx),
    });
    // Delegasi sensitif sah boleh melepas akses pelaku. Jangan batalkan transaksi
    // atau mengembalikan isi surat yang kini sudah di luar lingkupnya.
    return result ? (await projectedDisposisi(user, [result], null, tx))[0]
      : { id, status: data.status || row.status, ke_user_id: data.ke_user_id, akses_dilepas: true };
  });
}
async function referensi(user) {
  const [canBagian, canKlasifikasi, canJenis, canCreate, canUpdate] = await Promise.all([
    ['bagian', 'read'], ['klasifikasi', 'read'], ['jenis_surat', 'read'],
    ['disposisi', 'create'], ['disposisi', 'update'],
  ].map(([resource, action]) => bolehkah(prisma, user, resource, action)));
  let userScope = { id: user.id };
  if ((user.peran === 'kepala_sekolah' && canCreate) || (global(user) && user.peran !== 'tata_usaha' && canUpdate)) userScope = {};
  else if (user.peran === 'kepala_bagian' && user.bagian_id && canUpdate) userScope = { bagian_id: user.bagian_id };
  const [bagian, klasifikasi, jenis_surat, pengguna] = await Promise.all([
    canBagian ? prisma.bagian.findMany({ where: { aktif: true, deleted_at: null }, orderBy: { nama: 'asc' } }) : [],
    canKlasifikasi ? prisma.klasifikasi.findMany({
      where: { aktif: true, deleted_at: null }, orderBy: [{ urutan: 'asc' }, { kode: 'asc' }],
    }) : [],
    canJenis ? prisma.jenisSurat.findMany({ where: { aktif: true }, orderBy: { nama: 'asc' } }) : [],
    prisma.user.findMany({
      where: { aktif: true, deleted_at: null, ...userScope },
      select: { id: true, nama_lengkap: true, peran: true, bagian_id: true },
      orderBy: { nama_lengkap: 'asc' },
    }),
  ]);
  return { bagian, klasifikasi, jenis_surat, pengguna };
}
function notificationScope(user) {
  return { disposisi: { AND: [disposisiWhere(user), penerimaScope(user), tugasAktif()] } };
}
async function listNotifikasi(user) {
  if (!(await bolehkah(prisma, user, 'disposisi', 'read'))) return { total: 0, items: [] };
  const where = { ...notificationScope(user), dibaca: { none: { user_id: user.id } } };
  const [total, rows] = await prisma.$transaction([
    prisma.notifikasiPenugasan.count({ where }),
    prisma.notifikasiPenugasan.findMany({
      where, take: 10, orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { id: true, disposisi_id: true, created_at: true, disposisi: { select: {
        surat_masuk: { select: { perihal: true } },
      } } },
    }),
  ]);
  return { total, items: rows.map(({ disposisi, ...item }) => ({ ...item, judul: disposisi.surat_masuk.perihal })) };
}
async function bacaNotifikasi(user, id, body) {
  if (body !== undefined) fields(body, []);
  return prisma.$transaction(async (tx) => {
    await permission(user, 'disposisi', 'read', tx);
    const event = await tx.notifikasiPenugasan.findFirst({ where: { id, ...notificationScope(user) }, select: { id: true } });
    if (!event) throw new AppError(404, 'Notifikasi tidak ditemukan.');
    await tx.notifikasiDibaca.upsert({
      where: { user_id_notifikasi_id: { user_id: user.id, notifikasi_id: id } },
      create: { user_id: user.id, notifikasi_id: id }, update: {},
    });
    return { id };
  });
}
async function dashboard(user, { periode = 'minggu' } = {}) {
  const [canMasuk, canKeluar, canTask] = await Promise.all(
    ['surat_masuk', 'surat_keluar', 'disposisi'].map((r) => bolehkah(prisma, user, r, 'read')),
  );
  const masukWhere = { deleted_at: null, AND: [canMasuk ? suratScope(user, 'masuk') : NEVER] };
  const keluarWhere = { deleted_at: null, AND: [canKeluar ? suratScope(user, 'keluar') : NEVER] };
  const today = hariJakarta();
  const { range, buckets, key } = timeline(periode, today);
  const taskWhere = { AND: [canTask ? disposisiWhere(user) : NEVER] };
  const whereDeadline = (mode) => ({ AND: [taskWhere, tugasBertenggat(mode, today)] });
  const [surat_masuk, surat_keluar, disposisi_aktif, terlambat, dekat_tenggat, prioritas, masuk, keluar, aktivitas] = await Promise.all([
    prisma.suratMasuk.count({ where: masukWhere }),
    prisma.suratKeluar.count({ where: keluarWhere }),
    prisma.disposisi.count({ where: { AND: [taskWhere, tugasAktif()] } }),
    prisma.disposisi.count({ where: whereDeadline('lewat') }),
    prisma.disposisi.count({ where: whereDeadline('dekat') }),
    prisma.disposisi.findMany({
      where: whereDeadline('aktif'),
      select: await disposisiSelect(user),
      orderBy: [{ deadline: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
      take: 8,
    }),
    prisma.suratMasuk.findMany({ where: { ...masukWhere, tanggal_terima: range }, select: { tanggal_terima: true } }),
    prisma.suratKeluar.findMany({ where: { ...keluarWhere, tanggal_surat: range }, select: { tanggal_surat: true } }),
    aktivitasTerbaru({
      ...(canMasuk ? { surat_masuk: [prisma.suratMasuk, masukWhere] } : {}),
      ...(canKeluar ? { surat_keluar: [prisma.suratKeluar, keluarWhere] } : {}),
      ...(canTask ? { disposisi: [prisma.disposisi, taskWhere] } : {}),
    }),
  ]);
  for (const row of masuk) buckets.get(key(row.tanggal_terima)).masuk++;
  for (const row of keluar) buckets.get(key(row.tanggal_surat)).keluar++;
  return {
    lingkup: global(user) ? 'sekolah' : user.peran === 'kepala_bagian' ? 'unit' : 'penugasan',
    ringkasan: { surat_masuk, surat_keluar, disposisi_aktif, terlambat, dekat_tenggat },
    periode,
    tren: [...buckets.values()],
    prioritas: await projectedDisposisi(user, prioritas),
    aktivitas,
  };
}
// Log polimorfik: periksa cakupan entitas per batch, tanpa memuat semua ID surat.
async function aktivitasTerbaru(sources) {
  const types = Object.keys(sources);
  const result = [];
  if (!types.length) return result;
  let previous;
  while (result.length < 10) {
    const rows = await prisma.activityLog.findMany({
      where: {
        entitas: { in: types }, entitas_id: { not: null },
        ...(previous ? { OR: [
          { created_at: { lt: previous.created_at } },
          { created_at: previous.created_at, id: { lt: previous.id } },
        ] } : {}),
      },
      select: { id: true, aksi: true, entitas: true, entitas_id: true, nama_user: true, created_at: true },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    const visible = Object.fromEntries(await Promise.all(types.map(async (type) => {
      const [table, where] = sources[type];
      const ids = rows.filter((row) => row.entitas === type).map((row) => row.entitas_id);
      const found = ids.length ? await table.findMany({ where: { ...where, id: { in: ids } }, select: { id: true } }) : [];
      return [type, new Set(found.map(({ id }) => id))];
    })));
    result.push(...rows.filter((row) => visible[row.entitas].has(row.entitas_id)));
    if (rows.length < 50) break;
    previous = rows.at(-1);
  }
  return result.slice(0, 10);
}
function audit(req, aksi, entitas, row) {
  logAudit({ user: req.user, req, aksi, entitas, entitasId: row.id, detail: `${aksi} ${entitas}` });
}
module.exports = {
  permission,
  findSurat,
  detailSurat,
  listSurat,
  createSurat,
  patchSurat,
  detailDisposisi,
  hasAssignedSurat,
  listDisposisi,
  createDisposisi,
  patchDisposisi,
  referensi,
  dashboard,
  listNotifikasi,
  bacaNotifikasi,
  audit,
};
