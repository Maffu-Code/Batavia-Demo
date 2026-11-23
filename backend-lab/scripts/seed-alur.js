/** Fixture sintetis idempoten. Tidak mengubah akun atau surat yang sudah ada. */
const bcrypt = require('bcryptjs');
const DEFAULT_DEMO_PASSWORD = 'DemoBatavia123!';
async function seedAlur(prisma, options = {}) {
  const password = options.password ?? process.env.DEMO_PASSWORD;
  if (typeof password !== 'string' || password.length < 12) throw new Error('DEMO_PASSWORD minimal 12 karakter wajib disediakan, tidak ada password bawaan.');
  const hash = await bcrypt.hash(password, 12);
  const unit = await prisma.bagian.upsert({ where: { singkatan: 'DEMO-TU' }, update: {}, create: { nama: '[SINTETIS] Tata Usaha Demo', singkatan: 'DEMO-TU' } });
  const unit2 = await prisma.bagian.upsert({ where: { singkatan: 'DEMO-KUR' }, update: {}, create: { nama: '[SINTETIS] Kurikulum Demo', singkatan: 'DEMO-KUR' } });
  const klasifikasi = await prisma.klasifikasi.upsert({ where: { kode: 'DEMO.01' }, update: {}, create: { kode: 'DEMO.01', nama: '[SINTETIS] Operasional Demo', urutan: 99 } });
  const jenis = await prisma.jenisSurat.upsert({ where: { kode: 'demo-undangan' }, update: {}, create: { kode: 'demo-undangan', nama: '[SINTETIS] Undangan Demo' } });
  const users = {};
  for (const [key, peran, bagian_id, nama] of [
    ['admin', 'superadmin', unit.id, 'Pengelola Sistem'], ['tu', 'tata_usaha', unit.id, 'Operator TU'],
    ['pimpinan', 'kepala_sekolah', unit.id, 'Kepala Sekolah'], ['bagian', 'kepala_bagian', unit2.id, 'Kepala Kurikulum'],
    ['staf', 'guru_staf', unit2.id, 'Staf Pelaksana'], ['staf-lain', 'guru_staf', unit2.id, 'Staf Tanpa Penugasan'],
  ]) users[key] = await prisma.user.upsert({ where: { email: `${key}@demo.batavia.invalid` }, update: {}, create: { email: `${key}@demo.batavia.invalid`, nama_lengkap: `[SINTETIS] ${nama}`, password_hash: hash, peran, bagian_id, password_changed_at: new Date(0) } });
  const now = new Date(); now.setUTCHours(0, 0, 0, 0);
  for (let i = 1; i <= 6; i++) {
    const date = new Date(now); date.setUTCDate(date.getUTCDate() - [1, 3, 5, 12, 42, 75][i - 1]);
    const status = ['diterima', 'dibaca_pimpinan', 'didisposisi', 'didisposisi', 'selesai', 'diarsipkan'][i - 1];
    const letter = await prisma.suratMasuk.upsert({ where: { nomor_registrasi: `DEMO-SM-${String(i).padStart(3, '0')}` }, update: {}, create: {
      nomor_registrasi: `DEMO-SM-${String(i).padStart(3, '0')}`, nomor_surat: `SINTETIS/MASUK/${i}`, pengirim: `[SINTETIS] Mitra Sekolah ${i}`,
      perihal: ['Undangan rapat koordinasi', 'Permohonan data pendidikan', 'Koordinasi kegiatan siswa', 'Pelatihan tenaga pendidik', 'Laporan kegiatan selesai', 'Arsip pertemuan sekolah'][i - 1] + ' [SINTETIS]',
      tanggal_surat: date, tanggal_terima: date, klasifikasi_id: klasifikasi.id, jenis_surat_id: jenis.id, dibuat_oleh: users.tu.id, status, sensitif: i === 2,
    } });
    if (i >= 3) {
      const taskStatus = i === 3 ? 'baru' : i === 4 ? 'diproses' : 'selesai';
      const deadline = new Date(now); deadline.setUTCDate(deadline.getUTCDate() + (i === 4 ? -2 : 2));
      const task = await prisma.disposisi.upsert({ where: { id: `demo-disposisi-${i}` }, update: {}, create: {
        id: `demo-disposisi-${i}`, surat_masuk_id: letter.id, dari_user_id: users.pimpinan.id, ke_bagian_id: unit2.id, ke_user_id: users.staf.id,
        instruksi: '[SINTETIS] Telaah surat dan laporkan hasil tindak lanjut.', deadline, status: taskStatus,
        catatan: taskStatus === 'selesai' ? '[SINTETIS] Koordinasi telah diselesaikan.' : null,
      } });
      if (taskStatus !== 'baru') await prisma.tindakLanjut.upsert({ where: { id: `demo-tindak-lanjut-${i}` }, update: {}, create: { id: `demo-tindak-lanjut-${i}`, disposisi_id: task.id, oleh_user_id: users.staf.id, catatan: taskStatus === 'selesai' ? '[SINTETIS] Koordinasi telah diselesaikan.' : '[SINTETIS] Menghubungi mitra terkait.' } });
    }
  }
  for (let i = 1; i <= 5; i++) {
    const date = new Date(now); date.setUTCDate(date.getUTCDate() - i * 9);
    await prisma.suratKeluar.upsert({ where: { nomor_registrasi: `DEMO-SK-${String(i).padStart(3, '0')}` }, update: {}, create: {
      nomor_registrasi: `DEMO-SK-${String(i).padStart(3, '0')}`, nomor_surat: `SINTETIS/KELUAR/${i}`, tujuan: `[SINTETIS] Tujuan ${i}`, perihal: `[SINTETIS] Balasan kegiatan ${i}`,
      tanggal_surat: date, klasifikasi_id: klasifikasi.id, jenis_surat_id: jenis.id, dibuat_oleh: users.tu.id,
      status: ['draft', 'menunggu_tanda_tangan', 'disetujui', 'terkirim', 'diarsipkan'][i - 1],
    } });
  }
  return { pengguna: Object.values(users).map(({ id, email, peran }) => ({ id, email, peran })), surat_masuk: 6, surat_keluar: 5, disposisi: 4 };
}
// Contoh sekolah terpisah dari fixture regresi lama; idempoten dan tidak menimpa edit.
async function seedSekolah(db, options = {}) {
  const password = options.password ?? process.env.DEMO_PASSWORD;
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Password contoh minimal 12 karakter, maksimal 72 byte.');
  const hash = await bcrypt.hash(password, 12);
  let units = await db.bagian.findMany({ where: { aktif: true, deleted_at: null }, orderBy: [{ nama: 'asc' }, { id: 'asc' }] });
  if (!units.length) {
    for (const [singkatan, nama] of [['TU', 'Tata Usaha'], ['KUR', 'Kurikulum'], ['KSW', 'Kesiswaan'], ['HMS', 'Humas'], ['SAR', 'Sarana dan Prasarana']]) {
      await db.bagian.upsert({ where: { singkatan }, update: {}, create: { singkatan, nama } });
    }
    units = await db.bagian.findMany({ where: { aktif: true, deleted_at: null }, orderBy: [{ nama: 'asc' }, { id: 'asc' }] });
  }
  if (!units.length) throw new Error('Unit aktif belum tersedia.');
  const names = ['Ahmad Fauzan', 'Siti Nurhaliza', 'Budi Prasetyo', 'Dewi Lestari', 'Muhammad Rizky', 'Nur Aisyah', 'Agus Setiawan', 'Ratna Puspita', 'Fajar Ramadhan', 'Intan Permata', 'Hendra Saputra', 'Rina Kurniawati', 'Dimas Firmansyah', 'Putri Maharani', 'Arif Wibowo', 'Maya Safitri', 'Reza Maulana', 'Fitri Handayani', 'Yoga Pratama', 'Nadia Rahmawati', 'Andi Hermawan', 'Laila Zahra', 'Rizal Hidayat', 'Novi Anggraini', 'Eko Susanto', 'Wulan Kartika', 'Bayu Aditya', 'Sri Wahyuni', 'Rangga Saputra', 'Anisa Putri', 'Taufik Rahman', 'Melati Kusuma'];
  let counter = 0;
  const nextName = () => names[counter % names.length] + (counter++ >= names.length ? ` ${['Wijaya', 'Santoso', 'Utami', 'Nugraha', 'Pertiwi'][Math.floor((counter - 1) / names.length) % 5]}` : '');
  const users = [];
  async function account(key, nama_lengkap, peran, bagian_id) {
    const email = `${key}@contoh.batavia.invalid`;
    let row = await db.user.findUnique({ where: { email } });
    if (!row && options.reuseExisting) {
      row = await db.user.findFirst({ where: { peran, deleted_at: null, email: { not: { endsWith: '@contoh.batavia.invalid' } }, ...(peran === 'superadmin' ? { aktif: true } : {}) }, orderBy: [{ aktif: 'desc' }, { created_at: 'asc' }] });
      if (row) row = await db.user.update({ where: { id: row.id }, data: { email, nama_lengkap, peran, bagian_id, aktif: true, password_hash: hash, password_changed_at: new Date() } });
    }
    row ??= await db.user.create({ data: { email, nama_lengkap, peran, bagian_id, password_hash: hash } });
    users.push(row);
    return row;
  }
  let admin = await db.user.findFirst({ where: { peran: 'superadmin', aktif: true, deleted_at: null }, orderBy: { created_at: 'asc' } });
  if (!admin) admin = await account('pengelola', 'Ilham Pradana', 'superadmin', null);
  else users.push(admin);
  const principal = await account('randy.septo.anggara', 'Randy Septo Anggara', 'kepala_sekolah', null);
  const tuUnit = units.find((u) => /tata usaha/i.test(u.nama)) || units[0];
  const tu = await account('dewi.lestari.tu', 'Dewi Lestari', 'tata_usaha', tuUnit.id);
  const groups = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const slug = unit.singkatan.toLowerCase();
    const head = await account(`kepala.${slug}`, nextName(), 'kepala_bagian', unit.id);
    const staff = [];
    for (let j = 0; j < Math.max(2, Math.ceil(10 / units.length)); j++) staff.push(await account(`staf.${slug}.${j + 1}`, nextName(), 'guru_staf', unit.id));
    groups.push({ unit, head, staff });
  }
  const klasifikasi = await db.klasifikasi.upsert({ where: { kode: 'ADM.01' }, update: {}, create: { kode: 'ADM.01', nama: 'Administrasi Sekolah', urutan: 1 } });
  const types = [];
  for (const [kode, nama] of [['undangan', 'Surat Undangan'], ['permohonan', 'Surat Permohonan'], ['pemberitahuan', 'Surat Pemberitahuan'], ['laporan-kegiatan', 'Laporan Kegiatan'], ['keputusan', 'Surat Keputusan']]) {
    types.push(await db.jenisSurat.upsert({ where: { kode }, update: {}, create: { kode, nama } }));
  }
  const now = new Date();
  const today = new Date(new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const offsetDate = (days) => new Date(today.getTime() + days * 86400000);
  const topics = ['Rapat koordinasi pembelajaran', 'Pendataan peserta didik', 'Pelatihan administrasi digital', 'Evaluasi kegiatan semester', 'Koordinasi kegiatan orang tua', 'Pembaruan sarana pembelajaran', 'Sosialisasi program literasi', 'Persiapan asesmen sekolah', 'Koordinasi layanan perpustakaan', 'Rapat tindak lanjut program kerja'];
  const issuers = ['Forum Pendidikan Jakarta', 'Lembaga Pelatihan Nusantara', 'Komite Sekolah', 'Pusat Pengembangan Pendidikan', 'Mitra Literasi Indonesia'];
  const created = now;
  const fixtureId = (kind, index) => {
    const hex = require('node:crypto').createHash('sha256').update(`batavia-sekolah-${kind}-${index}`).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  const numberFor = async (jenis, stamp, roman) => {
    const tahun = stamp.getUTCFullYear();
    const { nomor } = await db.nomorSuratSequence.upsert({
      where: { tahun_jenis: { tahun, jenis } }, update: { nomor: { increment: 1 } }, create: { tahun, jenis, nomor: 1 },
    });
    return `${jenis === 'masuk' ? 'SM' : 'SK'}/${String(nomor).padStart(3, '0')}/${roman}/${tahun}`;
  };
  for (let i = 0; i < 50; i++) {
    const group = groups[i % groups.length];
    const stamp = offsetDate(-(i < 12 ? i % 7 : i * 5));
    const year = stamp.getUTCFullYear();
    const roman = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][stamp.getUTCMonth()];
    const status = ['diterima', 'dibaca_pimpinan', 'didisposisi', 'didisposisi', 'selesai', 'diarsipkan'][i % 6];
    let letter = await db.suratMasuk.findUnique({ where: { id: fixtureId('masuk', i) } });
    if (!letter) {
      const number = await numberFor('masuk', stamp, roman);
      letter = await db.suratMasuk.create({ data: { id: fixtureId('masuk', i), nomor_registrasi: number, nomor_surat: `${String(i + 101).padStart(3, '0')}/ADM/${year}`, pengirim: issuers[i % issuers.length], perihal: `${topics[i % topics.length]} ${i + 1}`, tanggal_surat: stamp, tanggal_terima: stamp, klasifikasi_id: klasifikasi.id, jenis_surat_id: types[i % types.length].id, bagian_id: group.unit.id, status, sensitif: i % 13 === 0, dibuat_oleh: tu.id, created_at: stamp } });
      if (['didisposisi', 'selesai', 'diarsipkan'].includes(status)) {
        for (const staff of group.staff.slice(0, 2)) {
          const done = status !== 'didisposisi';
          const task = await db.disposisi.create({ data: { surat_masuk_id: letter.id, dari_user_id: principal.id, ke_bagian_id: group.unit.id, ke_user_id: staff.id, instruksi: 'Pelajari surat, koordinasikan kegiatan, dan catat hasil tindak lanjut.', deadline: offsetDate(i % 2 ? 2 : -2), status: done ? 'selesai' : i % 2 ? 'baru' : 'diproses', catatan: done ? 'Koordinasi kegiatan dan pencatatan hasil telah diselesaikan.' : null, created_at: stamp, dibaca_at: done || i % 2 === 0 ? stamp : null, notifikasi: { create: { created_at: created } } } });
          if (done) await db.tindakLanjut.create({ data: { disposisi_id: task.id, oleh_user_id: staff.id, catatan: task.catatan, selesai_at: stamp, created_at: stamp } });
        }
      }
    }
    if (!(await db.suratKeluar.findUnique({ where: { id: fixtureId('keluar', i) }, select: { id: true } }))) {
      const outNumber = await numberFor('keluar', stamp, roman);
      await db.suratKeluar.create({ data: { id: fixtureId('keluar', i), nomor_registrasi: outNumber, nomor_surat: `${String(i + 1).padStart(3, '0')}/SMKIT-SN/${roman}/${year}`, tujuan: issuers[(i + 1) % issuers.length], perihal: `Tindak lanjut ${topics[i % topics.length].toLowerCase()} ${i + 1}`, tanggal_surat: stamp, klasifikasi_id: klasifikasi.id, jenis_surat_id: types[(i + 1) % types.length].id, status: ['draft', 'menunggu_tanda_tangan', 'disetujui', 'terkirim', 'diarsipkan'][i % 5], dibuat_oleh: tu.id, created_at: stamp } });
    }
  }
  return { pengguna: users.map(({ id, email, peran, bagian_id }) => ({ id, email, peran, bagian_id })), superadmin_id: admin.id, surat_masuk: 50, surat_keluar: 50 };
}
module.exports = { seedAlur, seedSekolah };
if (require.main === module) {
  if (process.env.MODE !== 'lab' || !process.env.DATABASE_URL || process.env.SEED_ALUR_CONFIRM !== 'SINTETIS') {
    console.error('Dibatalkan. Jalankan --demo dari runner lab untuk menambah fixture sintetis.');
    process.exitCode = 1;
  } else {
    const env = require('../src/config/env');
    if (!env.LAB) process.exit(1);
    const prisma = require('../src/config/database');
    // Hanya CLI demo lokal yang menyediakan sandi publik; fixture uji memberi sandi sendiri.
    const password = process.env.DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD;
    prisma.$transaction((tx) => seedSekolah(tx, { password }), { timeout: 60000 }).then((data) => console.log(JSON.stringify(data, null, 2))).catch((err) => { console.error(err.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
  }
}
