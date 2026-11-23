/** Uji HTTP katalog memakai SQLite sementara, bukan database kerja. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const scratch = process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || require('node:os').homedir(), 'batavia-tests');
mkdirSync(scratch, { recursive: true });
const dir = mkdtempSync(path.join(scratch, 'batavia-uji-'));
process.env.MODE = 'lab';
process.env.PORT = '6089';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const file = path.join(dir, 'uji.db').replaceAll('\\', '/');
process.env.DATABASE_URL = `file:${file}`;
process.env.STORAGE_DIR = path.join(dir, 'storage');
process.env.PRIVATE_STORAGE_DIR = path.join(dir, 'private');
process.env.CORS_ORIGIN = '';
process.env.LOGIN_RATE_LIMIT_MAX = '100';
const migrations = path.join(root, 'prisma/migrations');
const sqlite = new DatabaseSync(file);
try {
  for (const name of readdirSync(migrations, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    sqlite.exec(readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
  }
} finally { sqlite.close(); }
const previousCwd = process.cwd();
process.chdir(dir);
const prisma = require('../src/config/database');
const app = require('../src/app');
const { drainAudit } = require('../src/middleware/logActivity');
const jwt = require('jsonwebtoken');
let server;

const token = (user) => jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

test('Katalog demo: CRUD aman, izin, audit, seed dan validasi', async (t) => {
  try {
    const admin = await prisma.user.create({ data: {
      email: 'admin@uji.invalid', nama_lengkap: 'Admin Sintetis', password_hash: 'bukan-login',
      peran: 'superadmin', password_changed_at: new Date(0),
    } });
    const tu = await prisma.user.create({ data: {
      email: 'tu@uji.invalid', nama_lengkap: 'TU Sintetis', password_hash: 'bukan-login',
      peran: 'tata_usaha', password_changed_at: new Date(0),
    } });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const req = async (method, url, body, user = admin) => {
      const r = await fetch(base + url, {
        method, headers: {
          ...(user ? { Authorization: `Bearer ${token(user)}` } : {}),
          'Content-Type': 'application/json',
        }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() };
    };
    await t.test('origin loopback lab diterima, origin asing ditolak 403', async () => {
      for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173']) {
        const r = await fetch(base + '/health', { headers: { Origin: origin } });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('access-control-allow-origin'), origin);
      }
      assert.equal((await fetch(base + '/health', { headers: { Origin: 'https://asing.invalid' } })).status, 403);
    });
    await t.test('tanpa login 401; TU tidak boleh menulis 403', async () => {
      assert.equal((await req('GET', '/katalog/surat', undefined, null)).status, 401);
      assert.equal((await req('POST', '/katalog/surat', { kode: 'uji', nama: 'Uji' }, tu)).status, 403);
    });
    await t.test('nama tabel tidak boleh berasal dari input bebas', async () => {
      for (const j of ['user', '__proto__', 'constructor']) {
        assert.equal((await req('GET', `/katalog/${j}`)).status, 400, j);
      }
    });
    for (const jenis of ['surat', 'arsip']) {
      await t.test(`${jenis}: tambah, duplikat, ubah, nonaktif dan baca`, async () => {
        const r = await req('POST', `/katalog/${jenis}`, { kode: 'uji-jenis', nama: 'Contoh Uji' });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        const id = r.body.data.id;
        assert.equal((await req('POST', `/katalog/${jenis}`, { kode: 'UJI-JENIS', nama: 'Lain' })).status, 409);
        assert.equal((await req('PATCH', `/katalog/${jenis}/${id}`, { nama: 'Diperbarui', aktif: false })).status, 200);
        const daftar = await req('GET', `/katalog/${jenis}`, undefined, tu);
        assert.equal(daftar.status, 200);
        assert.equal(daftar.body.data.find((x) => x.id === id).nama, 'Diperbarui');
        const aktif = await req('GET', `/katalog/${jenis}?aktif=1`);
        assert.equal(aktif.body.data.some((x) => x.id === id), false);
        assert.equal((await req('PATCH', `/katalog/${jenis}/${id}`, { aktif: true })).status, 200);
      });
    }
    await t.test('isian invalid ditolak; tidak ada mass assignment', async () => {
      const invalid = [null, [], { nama: 42 }, { nama: 'x', kode: 'x', aktif: 'false' },
        { nama: 'x'.repeat(121), kode: 'panjang' }, { nama: 'x', kode: '../user' },
        { nama: 'x', kode: 'x', peran: 'superadmin' }];
      for (const body of invalid) {
        assert.equal((await req('POST', '/katalog/surat', body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await req('PATCH', '/katalog/surat/bukan-uuid', { nama: 'x' })).status, 400);
      assert.equal((await req('PATCH', '/katalog/surat/00000000-0000-4000-8000-000000000001', { nama: 'x' })).status, 404);
    });
    await t.test('matriks TU mempertahankan identitas dan tidak mengaku punya hak tulis katalog', async () => {
      const r = await req('GET', '/auth/izin-saya', undefined, tu);
      assert.equal(r.body.data.user.id, tu.id);
      assert.equal(r.body.data.user.nama, 'TU Sintetis');
      assert.equal(r.body.data.izin.jenis_surat.create.boleh, false);
      assert.equal(r.body.data.izin.jenis_arsip.update.boleh, false);
    });
    await t.test('grant, revoke, reset katalog sesuai matriks pada request berikutnya', async () => {
      const where = { user_id_resource_action: { user_id: tu.id, resource: 'jenis_surat', action: 'create' } };
      await prisma.userPermission.upsert({ where, create: { user_id: tu.id, resource: 'jenis_surat', action: 'create', allowed: true }, update: { allowed: true } });
      assert.equal((await req('POST', '/katalog/surat', { kode: 'delegasi', nama: 'Delegasi TU' }, tu)).status, 201);
      await prisma.userPermission.update({ where, data: { allowed: false } });
      assert.equal((await req('POST', '/katalog/surat', { kode: 'dicabut', nama: 'Tidak Boleh' }, tu)).status, 403);
      await prisma.userPermission.delete({ where });
      assert.equal((await req('POST', '/katalog/surat', { kode: 'bawaan', nama: 'Kembali Bawaan' }, tu)).status, 403);
    });
    await t.test('izin baca eksplisit ditolak di server', async () => {
      await prisma.userPermission.create({ data: { user_id: tu.id, resource: 'jenis_surat', action: 'read', allowed: false } });
      assert.equal((await req('GET', '/katalog/surat', undefined, tu)).status, 403);
      assert.equal((await req('GET', '/katalog/arsip', undefined, tu)).status, 200);
    });
    await t.test('tulis bersamaan berkode sama: satu berhasil, satu 409', async () => {
      const res = await Promise.all([1, 2].map(() => req('POST', '/katalog/surat', { kode: 'serentak', nama: 'Serentak' })));
      assert.deepEqual(res.map((r) => r.status).sort(), [201, 409]);
      assert.equal(await prisma.jenisSurat.count({ where: { kode: 'serentak' } }), 1);
    });
    await t.test('audit mencatat perubahan sukses, tetapi bukan perubahan gagal', async () => {
      await drainAudit();
      const sebelum = await prisma.activityLog.count();
      const r = await req('POST', '/katalog/surat', { kode: 'diaudit', nama: 'Audit Uji' });
      assert.equal(r.status, 201);
      await drainAudit();
      assert.equal(await prisma.activityLog.count(), sebelum + 1);
      assert.equal(await prisma.activityLog.count({ where: { entitas_id: r.body.data.id } }), 1);
      await req('POST', '/katalog/surat', { kode: 'diaudit', nama: 'Duplikat' });
      await drainAudit();
      assert.equal(await prisma.activityLog.count(), sebelum + 1);
    });
    await t.test('Unit Kerja memakai Bagian yang sama, hanya Superadmin dapat mengelola', async () => {
      const body = { singkatan: '  lab-uji  ', nama: 'Unit Laboratorium' };
      await prisma.userPermission.create({ data: { user_id: tu.id, resource: 'bagian', action: 'create', allowed: true } });
      assert.equal((await req('POST', '/katalog/unit', body, tu)).status, 403);
      const made = await req('POST', '/katalog/unit', body);
      assert.equal(made.status, 201);
      const { id } = made.body.data;
      assert.equal(made.body.data.singkatan, 'LAB-UJI');
      assert.equal((await req('POST', '/katalog/unit', { ...body, nama: 'Nama lain' })).status, 409);
      assert.equal((await req('POST', '/katalog/unit', { ...body, nama: 'UNIT LABORATORIUM', singkatan: 'BEDA' })).status, 409);
      assert.equal((await req('POST', '/katalog/unit', { ...body, deleted_at: null })).status, 400);
      assert.ok((await req('GET', '/referensi')).body.data.bagian.some((b) => b.id === id));
      const account = await req('PATCH', `/pengguna/${tu.id}`, { bagian_id: id });
      assert.equal(account.status, 200);
      assert.equal(account.body.data.bagian_id, id);
      assert.equal((await req('PATCH', `/katalog/unit/${id}`, { aktif: false })).status, 200);
      assert.equal((await prisma.user.findUnique({ where: { id: tu.id } })).bagian_id, id);
      assert.ok(!(await req('GET', '/referensi')).body.data.bagian.some((b) => b.id === id));
      assert.ok((await req('GET', '/katalog/unit', undefined, tu)).body.data.some((b) => b.id === id && !b.aktif));
      assert.equal((await req('PATCH', `/katalog/unit/${id}`, { aktif: true }, tu)).status, 403);
      await prisma.userPermission.create({ data: { user_id: tu.id, resource: 'surat_masuk', action: 'delete', allowed: true } });
      assert.equal((await req('GET', '/auth/izin-saya', undefined, tu)).body.data.izin.surat_masuk.delete.boleh, false);
    });
    const konfirmasi = { konfirmasi: 'KONFIRMASI HAPUS' };
    const modelKatalog = { surat: 'jenisSurat', arsip: 'jenisArsip', unit: 'bagian' };
    const buatKatalog = async (jenis, extra = {}) => prisma[modelKatalog[jenis]].create({ data: {
      nama: `Katalog ${randomUUID()}`, ...(jenis === 'unit' ? { singkatan: randomUUID().slice(0, 8) } : { kode: randomUUID() }), ...extra,
    } });
    await t.test('DELETE wajib login, UUID sah, jenis dikenal dan frasa persis tanpa field asing', async () => {
      const row = await buatKatalog('surat');
      const url = `/katalog/surat/${row.id}`;
      assert.equal((await req('DELETE', url, konfirmasi, null)).status, 401);
      assert.equal((await req('DELETE', '/katalog/tidak-dikenal/' + row.id, konfirmasi)).status, 400);
      assert.equal((await req('DELETE', '/katalog/surat/bukan-uuid', konfirmasi)).status, 400);
      assert.equal((await req('DELETE', '/katalog/surat/' + randomUUID(), konfirmasi)).status, 404);
      for (const body of [undefined, null, [], {}, { konfirmasi: true }, { konfirmasi: 'konfirmasi hapus' },
        { konfirmasi: ' KONFIRMASI HAPUS' }, { konfirmasi: 'KONFIRMASI HAPUS ' }, { konfirmasi: 'KONFIRMASI HAPUS\n' },
        { konfirmasi: 'KONFIRMASI  HAPUS' }, { ...konfirmasi, paksa: true }]) {
        assert.equal((await req('DELETE', url, body)).status, 400, JSON.stringify(body));
        assert.ok(await prisma.jenisSurat.findUnique({ where: { id: row.id } }));
      }
    });
    for (const jenis of Object.keys(modelKatalog)) {
      await t.test(`${jenis}: hapus permanen hanya entri tidak terpakai, kode/nama dapat dipakai ulang dan audit sukses`, async () => {
        const row = await buatKatalog(jenis, { aktif: false });
        const url = `/katalog/${jenis}/${row.id}`;
        await drainAudit();
        const before = await prisma.activityLog.count();
        assert.equal((await req('DELETE', url, { konfirmasi: 'SALAH' })).status, 400);
        const result = await req('DELETE', url, konfirmasi);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.deepEqual(result.body.data, { id: row.id });
        assert.equal(await prisma[modelKatalog[jenis]].findUnique({ where: { id: row.id } }), null);
        assert.equal((await req('DELETE', url, konfirmasi)).status, 404);
        await drainAudit();
        assert.equal(await prisma.activityLog.count(), before + 1);
        const logs = await prisma.activityLog.findMany({ where: { entitas: 'katalog', entitas_id: row.id, aksi: 'delete' } });
        assert.equal(logs.length, 1);
        assert.equal(logs[0].user_id, admin.id);
        assert.ok(logs[0].detail.includes(row.nama));
        assert.ok(logs[0].detail.includes(jenis));
        assert.ok(!logs[0].detail.includes(konfirmasi.konfirmasi));
        await prisma[modelKatalog[jenis]].create({ data: { nama: row.nama, ...(jenis === 'unit' ? { singkatan: row.singkatan } : { kode: row.kode }) } });
      });
    }
    await t.test('panel izin nyata mendukung delete; grant tidak menjadikan nonadmin penghapus katalog', async () => {
      await prisma.user.update({ where: { id: tu.id }, data: { bisa_hapus: true } });
      for (const [jenis, resource] of [['surat', 'jenis_surat'], ['arsip', 'jenis_arsip'], ['unit', 'bagian']]) {
        const row = await buatKatalog(jenis);
        const panel = `/pengguna/${tu.id}/izin`;
        assert.ok((await req('GET', panel)).body.data.aksi[resource].includes('delete'));
        for (const allowed of [false, true, null]) {
          const result = await req('PATCH', panel, { resource, action: 'delete', allowed });
          assert.equal(result.status, 200, JSON.stringify(result.body));
          assert.equal(result.body.data.izin[resource].delete.boleh, false);
          const mine = await req('GET', '/auth/izin-saya', undefined, tu);
          assert.equal(mine.body.data.izin[resource].delete.boleh, false);
          assert.equal((await req('DELETE', `/katalog/${jenis}/${row.id}`, konfirmasi, tu)).status, 403);
          assert.ok(await prisma[modelKatalog[jenis]].findUnique({ where: { id: row.id } }));
        }
        assert.equal(await prisma.userPermission.count({ where: { user_id: tu.id, resource, action: 'delete' } }), 0);
      }
      for (const action of ['create', 'update']) {
        const result = await req('PATCH', `/pengguna/${tu.id}/izin`, { resource: 'bagian', action, allowed: true });
        assert.equal(result.status, 200);
        assert.equal(result.body.data.izin.bagian[action].boleh, false);
      }
      // Pulihkan fixture batas_hapus yang juga dipakai uji sebelumnya.
      await prisma.user.update({ where: { id: tu.id }, data: { bisa_hapus: false } });
    });
    await t.test('jenis surat terpakai oleh masuk/keluar aktif, arsip, dan terhapus tetap 409 tanpa audit hapus', async () => {
      const klasifikasi = await prisma.klasifikasi.create({ data: { kode: 'HAPUS-UJI', nama: 'Uji Referensi' } });
      for (const model of ['suratMasuk', 'suratKeluar']) {
        for (const state of ['aktif', 'arsip', 'terhapus']) {
          const row = await buatKatalog('surat');
          const letter = await prisma[model].create({ data: {
            nomor_registrasi: randomUUID(), nomor_surat: 'Surat Uji', perihal: 'Referensi historis', tanggal_surat: new Date(),
            klasifikasi_id: klasifikasi.id, dibuat_oleh: admin.id, jenis_surat_id: row.id,
            ...(model === 'suratMasuk' ? { pengirim: 'Pengirim', tanggal_terima: new Date() } : { tujuan: 'Penerima' }),
            ...(state === 'arsip' ? { status: 'diarsipkan' } : {}), ...(state === 'terhapus' ? { deleted_at: new Date() } : {}),
          } });
          const result = await req('DELETE', `/katalog/surat/${row.id}`, konfirmasi);
          assert.equal(result.status, 409, `${model} ${state}: ${JSON.stringify(result.body)}`);
          assert.match(result.body.message, /Nonaktifkan/);
          assert.equal((await prisma[model].findUnique({ where: { id: letter.id } })).jenis_surat_id, row.id);
          assert.ok(await prisma.jenisSurat.findUnique({ where: { id: row.id } }));
          await drainAudit();
          assert.equal(await prisma.activityLog.count({ where: { entitas_id: row.id, aksi: 'delete' } }), 0);
        }
      }
    });
    await t.test('unit terkait akun (termasuk nonaktif/terhapus), surat, dan disposisi tidak dapat dihapus', async () => {
      const klasifikasi = await prisma.klasifikasi.findUnique({ where: { kode: 'HAPUS-UJI' } });
      for (const state of ['aktif', 'nonaktif', 'terhapus']) {
        const row = await buatKatalog('unit');
        const account = await prisma.user.create({ data: { nama_lengkap: 'Akun Referensi', email: `${randomUUID()}@uji.invalid`,
          password_hash: 'bukan-login', peran: 'guru_staf', bagian_id: row.id,
          ...(state === 'nonaktif' ? { aktif: false } : {}), ...(state === 'terhapus' ? { deleted_at: new Date() } : {}),
        } });
        const result = await req('DELETE', `/katalog/unit/${row.id}`, konfirmasi);
        assert.equal(result.status, 409, `akun ${state}`); assert.match(result.body.message, /Nonaktifkan/);
        assert.equal((await prisma.user.findUnique({ where: { id: account.id } })).bagian_id, row.id);
      }
      const makeLetter = (extra) => prisma.suratMasuk.create({ data: { nomor_registrasi: randomUUID(), nomor_surat: 'Uji',
        perihal: 'Uji', tanggal_surat: new Date(), tanggal_terima: new Date(), pengirim: 'Uji', klasifikasi_id: klasifikasi.id, dibuat_oleh: admin.id, ...extra,
      } });
      for (const state of ['aktif', 'arsip', 'terhapus']) {
        const row = await buatKatalog('unit');
        const letter = await makeLetter({ bagian_id: row.id, ...(state === 'arsip' ? { status: 'diarsipkan' } : {}), ...(state === 'terhapus' ? { deleted_at: new Date() } : {}) });
        const result = await req('DELETE', `/katalog/unit/${row.id}`, konfirmasi);
        assert.equal(result.status, 409, `surat ${state}`); assert.match(result.body.message, /Nonaktifkan/);
        assert.equal((await prisma.suratMasuk.findUnique({ where: { id: letter.id } })).bagian_id, row.id);
      }
      const letter = await makeLetter({});
      for (const state of ['aktif', 'terhapus']) {
        const row = await buatKatalog('unit');
        const disposition = await prisma.disposisi.create({ data: { surat_masuk_id: letter.id, dari_user_id: admin.id,
          ke_bagian_id: row.id, instruksi: 'Uji', ...(state === 'terhapus' ? { deleted_at: new Date() } : {}),
        } });
        const result = await req('DELETE', `/katalog/unit/${row.id}`, konfirmasi);
        assert.equal(result.status, 409, `disposisi ${state}`); assert.match(result.body.message, /Nonaktifkan/);
        assert.equal((await prisma.disposisi.findUnique({ where: { id: disposition.id } })).ke_bagian_id, row.id);
      }
    });
    await t.test('seed katalog idempoten dan mempertahankan edit admin', async () => {
      const { seedKatalog } = require('./seed-katalog');
      await seedKatalog(prisma);
      await prisma.jenisSurat.update({ where: { kode: 'izin' }, data: { nama: 'Diubah Admin', aktif: false } });
      const jumlah = await prisma.jenisSurat.count();
      await seedKatalog(prisma);
      assert.equal(await prisma.jenisSurat.count(), jumlah);
      const izin = await prisma.jenisSurat.findUnique({ where: { kode: 'izin' } });
      assert.equal(izin.nama, 'Diubah Admin');
      assert.equal(izin.aktif, false);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
    await drainAudit();
    await prisma.$disconnect();
    process.chdir(previousCwd);
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
