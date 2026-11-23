/** Uji izin dan API akun pada Express dan SQLite sementara, tanpa app.js atau .env kerja. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const scratch = process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || require('node:os').homedir(), 'batavia-tests');
fs.mkdirSync(scratch, { recursive: true });
const dir = fs.mkdtempSync(path.join(scratch, 'batavia-pengguna-'));
Object.assign(process.env, {
  MODE: 'lab', PORT: '6092', JWT_SECRET: randomBytes(32).toString('hex'),
  DATABASE_URL: `file:${path.join(dir, 'uji.db').replaceAll('\\', '/')}`,
});
// Prisma juga mencari .env di dekat skema; jangan membaca konfigurasi kerja.
const isEnv = (file) => typeof file === 'string' && /^\.env(?:\.|$)/.test(path.basename(file));
const exists = fs.existsSync; const read = fs.readFileSync;
fs.existsSync = (file) => !isEnv(file) && exists(file);
fs.readFileSync = function (file, ...args) {
  if (isEnv(file)) { const error = new Error('Environment file unavailable in isolated test.'); error.code = 'ENOENT'; throw error; }
  return read.call(this, file, ...args);
};
const previousCwd = process.cwd();
const db = new DatabaseSync(path.join(dir, 'uji.db'));
try {
  const migrations = path.join(root, 'prisma/migrations');
  for (const name of fs.readdirSync(migrations).sort()) {
    const file = path.join(migrations, name, 'migration.sql');
    if (fs.existsSync(file)) db.exec(fs.readFileSync(file, 'utf8'));
  }
} finally { db.close(); }
process.chdir(dir);
const prisma = require('../src/config/database');
const { izinEfektif, bolehkah } = require('../src/services/izin.service');
const { drainAudit } = require('../src/middleware/logActivity');
const jwt = require('jsonwebtoken');
let server;

test('Akun dan izin: peran, kendali nyata, validasi, audit dan rahasia', async (t) => {
  try {
    const unit = await prisma.bagian.create({ data: { nama: 'Unit Uji', singkatan: 'UJI' } });
    const user = async (peran, nama = peran) => prisma.user.create({ data: {
      nama_lengkap: nama, email: `${randomUUID()}@uji.invalid`, password_hash: 'hash-rahasia-uji',
      totp_secret_enc: 'totp-rahasia-uji', peran, bagian_id: unit.id, password_changed_at: new Date(0),
    } });
    const admin = await user('superadmin');
    const admin2 = await user('superadmin');
    const tu = await user('tata_usaha', 'Operator TU');
    const principal = await user('kepala_sekolah');
    const head = await user('kepala_bagian');
    const staff = await user('guru_staf');
    const unknown = await user('peran_tidak_dikenal');
    const grant = (u, resource, action, allowed) => prisma.userPermission.upsert({
      where: { user_id_resource_action: { user_id: u.id, resource, action } },
      create: { user_id: u.id, resource, action, allowed }, update: { allowed },
    });

    await t.test('Default mengikuti tugas peran, bukan semua peran menjadi pengelola', async () => {
      for (const [u, resource, action, want] of [
        [tu, 'surat_masuk', 'create', true], [tu, 'jenis_surat', 'create', false],
        [tu, 'disposisi', 'create', false], [principal, 'surat_masuk', 'create', false],
        [principal, 'disposisi', 'create', true], [head, 'surat_masuk', 'create', false],
        [head, 'tindak_lanjut', 'update', true], [staff, 'disposisi', 'create', false],
        [staff, 'tindak_lanjut', 'create', true], [unknown, 'surat_masuk', 'read', false],
      ]) assert.equal(await bolehkah(prisma, u, resource, action), want, `${u.peran} ${resource}.${action}`);
      for (const u of [tu, principal, head, staff]) {
        await grant(u, 'user', 'read', true);
        await grant(u, 'izin', 'update', true);
        await grant(u, 'activity_log', 'read', true);
        for (const [r, a] of [['user', 'read'], ['izin', 'update'], ['activity_log', 'read']]) {
          assert.equal(await bolehkah(prisma, { ...u, bisa_hapus: true }, r, a), false);
        }
        assert.equal(await bolehkah(prisma, { ...u, bisa_hapus: true }, 'user', 'delete'), false);
      }
    });
    await t.test('Deny mengalahkan bisa_hapus; induk mengalahkan grant laporan', async () => {
      await grant(tu, 'surat_masuk', 'delete', false);
      assert.equal(await bolehkah(prisma, { ...tu, bisa_hapus: true }, 'surat_masuk', 'delete'), false);
      await grant(tu, 'surat_masuk', 'read', false);
      await grant(tu, 'laporan_surat_masuk', 'read', true);
      const matrix = await izinEfektif(prisma, tu);
      assert.equal(matrix.laporan_surat_masuk.read.boleh, false);
      assert.equal(matrix.laporan_surat_masuk.read.sumber, 'induk');
      assert.equal(matrix.laporan_surat_masuk.read.boleh_asli, true);
      assert.equal(await bolehkah(prisma, principal, 'surat_masuk', 'delete'), false);
      await prisma.userPermission.deleteMany({ where: { user_id: tu.id, resource: { in: ['surat_masuk', 'laporan_surat_masuk'] } } });
    });

    const express = require('express');
    const { penggunaRoutes, aktivitasRoutes } = require('../src/routes/pengguna.routes');
    const authenticate = require('../src/middleware/authenticate');
    const requirePermission = require('../src/middleware/requirePermission');
    const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');
    const app = express();
    app.use(express.json());
    app.use('/api/pengguna', penggunaRoutes);
    app.use('/api/aktivitas', aktivitasRoutes);
    app.use('/api/auth', require('../src/routes/auth.routes'));
    app.use('/api/katalog', require('../src/routes/katalog.routes'));
    app.get('/api/probe', authenticate, requirePermission('jenis_surat', 'create'), (req, res) => res.json({ success: true }));
    app.get('/api/probe-surat', authenticate, requirePermission('surat_masuk', 'read'), (req, res) => res.json({ success: true }));
    app.use(notFoundHandler);
    app.use(errorHandler);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const token = (u, extra = {}) => jwt.sign({ sub: u.id, ...extra }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const req = async (method, url, body, actor = admin, rawToken) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
        method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${rawToken || token(actor)}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = await response.json();
      const text = JSON.stringify(json);
      for (const secret of ['password_hash', 'totp_secret', 'password_changed_at', 'hash-rahasia-uji', 'totp-rahasia-uji', 'UjiSandiBaru123!', 'UjiSandiAwal123!']) assert.ok(!text.includes(secret), secret);
      return { status: response.status, body: json };
    };
    const endpoint = (u) => `/api/pengguna/${u.id}/izin`;

    await t.test('Semua endpoint administrasi menolak anonim dan non-superadmin walau diberi grant', async () => {
      for (const actor of [null, tu, principal, head, staff]) {
        for (const [method, url, body] of [
          ['GET', '/api/pengguna'], ['POST', '/api/pengguna', {}],
          ['PATCH', `/api/pengguna/${admin.id}`, { aktif: false }],
          ['GET', endpoint(tu)], ['PATCH', endpoint(tu), { resource: 'surat_masuk', action: 'read', allowed: true }],
          ['GET', '/api/aktivitas'],
        ]) assert.equal((await req(method, url, body, actor)).status, actor ? 403 : 401, `${method} ${url}`);
      }
    });
    await t.test('Daftar memilih field aman, filter dan paginasi nyata', async () => {
      const r = await req('GET', '/api/pengguna?q=Operator&peran=tata_usaha&aktif=true&page=1&limit=1');
      assert.equal(r.status, 200); assert.equal(r.body.data.length, 1);
      assert.equal(r.body.data[0].id, tu.id); assert.equal(r.body.meta.total, 1);
      assert.equal(r.body.meta.page, 1); assert.equal(r.body.meta.limit, 1);
      assert.equal((await req('GET', '/api/pengguna?page=2&limit=100')).body.data.length, 0);
    });
    let created;
    const payload = { nama_lengkap: 'Akun Baru', email: 'AKUN.BARU@UJI.INVALID', password: 'UjiSandiAwal123!', peran: 'guru_staf', bagian_id: unit.id };
    await t.test('Pembuatan akun memakai bcrypt, email normal dan konflik 409', async () => {
      const r = await req('POST', '/api/pengguna', payload);
      assert.equal(r.status, 201); created = r.body.data;
      assert.equal(created.email, 'akun.baru@uji.invalid'); assert.equal(created.aktif, true);
      const stored = await prisma.user.findUnique({ where: { id: created.id } });
      assert.ok(await require('bcryptjs').compare(payload.password, stored.password_hash));
      assert.notEqual(stored.password_hash, payload.password);
      assert.equal((await req('POST', '/api/pengguna', payload)).status, 409);
    });
    await t.test('Body dan query menolak tipe salah, field asing, aksi dan UUID tidak sah', async () => {
      for (const body of [[], {}, { ...payload, aktif: 'false' }, { ...payload, bisa_hapus: 1 },
        { ...payload, password: 'pendek' }, { ...payload, password: 'a'.repeat(73) }, { ...payload, peran: 'owner' },
        { ...payload, email: 'tidak-valid' }, { ...payload, nama_lengkap: 7 },
        { ...payload, password_hash: 'tidak' }, { ...payload, bagian_id: 7 }, { ...payload, bagian_id: randomUUID() },
      ]) assert.equal((await req('POST', '/api/pengguna', body)).status, 400);
      for (const body of [{}, [], { aktif: 'false' }, { password_changed_at: '2000-01-01' }, { deleted_at: new Date() }, { peran: null }]) {
        assert.equal((await req('PATCH', `/api/pengguna/${tu.id}`, body)).status, 400);
      }
      for (const q of ['page=0', 'page=1.2', 'limit=101', 'peran=owner', 'aktif=ya', 'q[x]=1', 'asing=1', 'page=1&page=2']) {
        assert.equal((await req('GET', `/api/pengguna?${q}`)).status, 400, q);
      }
      for (const body of [{ resource: 'izin', action: 'delete', allowed: true },
        { resource: 'surat_masuk', action: 'read', allowed: 'true' },
        { resource: 'surat_masuk', action: 'read' }, { resource: '__proto__', action: 'read', allowed: true },
        { resource: 'surat_masuk', action: 'read', allowed: true, user_id: admin.id },
      ]) assert.equal((await req('PATCH', endpoint(tu), body)).status, 400);
      for (const allowed of [true, false]) {
        const denied = await req('PATCH', endpoint(tu), { resource: 'user', action: 'read', allowed });
        assert.equal(denied.status, 403, 'Administrasi dikunci; pilihan tidak boleh terlihat sukses lalu kembali Bawaan.');
        assert.equal((await prisma.userPermission.findUnique({ where: { user_id_resource_action: { user_id: tu.id, resource: 'user', action: 'read' } } })).allowed, true, 'Percobaan ditolak tidak mengubah aturan lama.');
      }
      assert.equal((await req('GET', '/api/pengguna/bukan-uuid/izin')).status, 400);
      assert.equal((await req('GET', `/api/pengguna/${randomUUID()}/izin`)).status, 404);
      assert.equal((await req('PATCH', `/api/pengguna/${randomUUID()}`, { aktif: false })).status, 404);
    });
    const izinSesi = token(tu);
    await t.test('Panel mengembalikan metadata dan grant/revoke/reset langsung mengubah sesi aktif dan guard HTTP', async () => {
      const initial = await req('GET', endpoint(tu));
      assert.equal(initial.status, 200); assert.equal(initial.body.data.user.id, tu.id);
      assert.ok(initial.body.data.aksi.jenis_surat.includes('create'));
      assert.ok(initial.body.data.label_resource.jenis_surat); assert.ok(initial.body.data.label_aksi.create);
      assert.equal((await req('GET', '/api/probe', undefined, tu)).status, 403);
      for (const [allowed, status, source] of [[true, 200, 'eksplisit'], [false, 403, 'eksplisit'], [null, 403, 'default']]) {
        const r = await req('PATCH', endpoint(tu), { resource: 'jenis_surat', action: 'create', allowed });
        assert.equal(r.status, 200); assert.equal(r.body.data.izin.jenis_surat.create.sumber, source);
        assert.equal(r.body.data.izin.jenis_surat.create.boleh, allowed === true);
        const persisted = await req('GET', endpoint(tu));
        assert.deepEqual(persisted.body.data.izin.jenis_surat.create, r.body.data.izin.jenis_surat.create);
        const session = await req('GET', '/api/auth/izin-saya', undefined, tu, izinSesi);
        assert.equal(session.status, 200);
        assert.deepEqual(session.body.data.izin.jenis_surat.create, r.body.data.izin.jenis_surat.create);
        assert.equal((await req('GET', '/api/probe', undefined, tu, izinSesi)).status, status);
        const katalog = await req('POST', '/api/katalog/surat', { kode: `izin-${String(allowed)}`, nama: 'Katalog Delegasi' }, tu);
        assert.equal(katalog.status, allowed === true ? 201 : 403);
      }
      assert.equal(await prisma.userPermission.count({ where: { user_id: tu.id, resource: 'jenis_surat', action: 'create' } }), 0);
      assert.equal((await req('PATCH', endpoint(principal), { resource: 'surat_masuk', action: 'read', allowed: false })).status, 200);
      assert.equal((await req('GET', '/api/probe-surat', undefined, principal)).status, 403);
      const cascade = await req('PATCH', endpoint(tu), { resource: 'surat_masuk', action: 'read', allowed: false });
      assert.equal(cascade.body.data.izin.laporan_surat_masuk.read.sumber, 'induk');
      assert.equal(cascade.body.data.izin.laporan_surat_masuk.read.sumber_asli, 'default');
      await req('PATCH', endpoint(tu), { resource: 'laporan_surat_masuk', action: 'read', allowed: true });
      const cascaded = await req('GET', endpoint(tu));
      assert.equal(cascaded.body.data.izin.laporan_surat_masuk.read.boleh, false);
      assert.equal(cascaded.body.data.izin.laporan_surat_masuk.read.boleh_asli, true);
      assert.equal(cascaded.body.data.izin.laporan_surat_masuk.read.sumber_asli, 'eksplisit');
      const reopened = await req('PATCH', endpoint(tu), { resource: 'surat_masuk', action: 'read', allowed: null });
      assert.equal(reopened.body.data.izin.laporan_surat_masuk.read.boleh, true);
      assert.equal(reopened.body.data.izin.laporan_surat_masuk.read.sumber, 'eksplisit');
    });
    await t.test('Akun pengelola terlindung; perubahan peran berlaku tanpa token baru', async () => {
      const sendiri = await req('PATCH', `/api/pengguna/${admin.id}`, {
        nama_lengkap: 'Superadmin Diperbarui', peran: 'superadmin', aktif: true,
      });
      assert.equal(sendiri.status, 200);
      assert.equal(sendiri.body.data.nama_lengkap, 'Superadmin Diperbarui');
      assert.equal(sendiri.body.data.bagian.id, unit.id);
      assert.equal((await req('PATCH', `/api/pengguna/${admin.id}`, { aktif: false })).status, 400);
      assert.equal((await req('PATCH', `/api/pengguna/${admin.id}`, { peran: 'guru_staf' })).status, 400);
      assert.equal((await req('PATCH', endpoint(admin2), { resource: 'surat_masuk', action: 'read', allowed: false })).status, 400);
      const old = token(admin2);
      assert.equal((await req('PATCH', `/api/pengguna/${admin2.id}`, { peran: 'guru_staf' })).status, 200);
      assert.equal((await req('GET', '/api/pengguna', undefined, admin2, old)).status, 403);
      assert.equal(await prisma.user.count({ where: { peran: 'superadmin', aktif: true, deleted_at: null } }), 1);
      assert.equal((await req('PATCH', `/api/pengguna/${admin.id}`, { peran: 'tata_usaha' })).status, 400);
    });
    await t.test('Nonaktif bukan hapus; reset sandi mengakhiri sesi lama', async () => {
      assert.equal((await req('PATCH', `/api/pengguna/${created.id}`, { password: 'UjiSandiBaru123!', nama_lengkap: 'Diubah' })).status, 200);
      const stored = await prisma.user.findUnique({ where: { id: created.id } });
      assert.ok(await require('bcryptjs').compare('UjiSandiBaru123!', stored.password_hash));
      assert.equal((await req('GET', '/api/probe-surat', undefined, created, token(created, { iat: 1 }))).status, 401);
      assert.equal((await req('PATCH', `/api/pengguna/${created.id}`, { aktif: false })).status, 200);
      assert.equal((await req('GET', '/api/probe-surat', undefined, created)).status, 403);
      assert.equal((await prisma.user.findUnique({ where: { id: created.id } })).deleted_at, null);
      assert.equal((await req('DELETE', `/api/pengguna/${created.id}`)).status, 404);
      assert.equal((await req('GET', '/api/pengguna?aktif=false')).body.meta.total, 1);
    });
    await t.test('Audit hanya perubahan sukses, tanpa sandi, filter dan pagination', async () => {
      await drainAudit();
      const logs = await prisma.activityLog.findMany();
      assert.ok(logs.some((log) => log.aksi === 'create' && log.entitas === 'user' && log.entitas_id === created.id));
      assert.equal(logs.filter((log) => log.aksi === 'perubahan_izin').length, 7);
      for (const secret of ['UjiSandiAwal123!', 'UjiSandiBaru123!', 'password_hash', 'totp-rahasia-uji']) assert.ok(!JSON.stringify(logs).includes(secret));
      const result = await req('GET', `/api/aktivitas?user_id=${admin.id}&entitas=user&page=1&limit=1`);
      assert.equal(result.status, 200); assert.equal(result.body.data.length, 1);
      assert.ok(result.body.meta.total >= 4); assert.equal(result.body.data[0].entitas, 'user');
      const searched = await req('GET', '/api/aktivitas?q=Membuat%20akun&dari=2000-01-01&sampai=2099-12-31');
      assert.equal(searched.status, 200); assert.equal(searched.body.meta.total, 1);
      assert.equal(searched.body.data[0].entitas_id, created.id);
      assert.equal((await req('GET', '/api/aktivitas?dari=2000-01-01&sampai=2000-01-01')).body.meta.total, 0);
      assert.equal((await req('GET', '/api/aktivitas?user_id=invalid')).status, 400);
      assert.equal((await req('GET', '/api/aktivitas?dari=kemarin')).status, 400);
      assert.equal((await req('GET', '/api/aktivitas?dari=2026-11-10&sampai=2026-11-01')).status, 400);
    });
    await t.test('Unit wajib pada POST: kosong, null, hilang, tidak aktif, terhapus ditolak untuk ketiga peran', async () => {
      const inactive = await prisma.bagian.create({ data: { nama: 'Unit Nonaktif', singkatan: 'NON', aktif: false } });
      const deleted = await prisma.bagian.create({ data: { nama: 'Unit Terhapus', singkatan: 'HPS', deleted_at: new Date() } });
      for (const peran of ['tata_usaha', 'kepala_bagian', 'guru_staf']) {
        for (const bagian_id of [undefined, null, '', inactive.id, deleted.id]) {
          const body = { ...payload, email: `${randomUUID()}@uji.invalid`, peran, bagian_id };
          const r = await req('POST', '/api/pengguna', body);
          assert.equal(r.status, 400, `${peran}: ${String(bagian_id)}`);
        }
        const r = await req('POST', '/api/pengguna', { ...payload, email: `${randomUUID()}@uji.invalid`, peran });
        assert.equal(r.status, 201); assert.equal(r.body.data.bagian_id, unit.id);
      }
      for (const peran of ['superadmin', 'kepala_sekolah']) {
        for (const bagian_id of [undefined, null]) {
          const r = await req('POST', '/api/pengguna', { ...payload, email: `${randomUUID()}@uji.invalid`, peran, bagian_id });
          assert.equal(r.status, 201); assert.equal(r.body.data.bagian_id, null);
        }
      }
    });
    await t.test('PATCH menilai hasil gabungan: unit tetap, transisi peran, reaktivasi, unit nonaktif dan akun lama', async () => {
      const other = await prisma.bagian.create({ data: { nama: 'Unit Lain', singkatan: 'LAIN' } });
      const inactive = await prisma.bagian.findFirst({ where: { aktif: false } });
      const target = await user('guru_staf');
      const patch = (body) => req('PATCH', `/api/pengguna/${target.id}`, body);
      assert.equal((await patch({ nama_lengkap: 'Nama Baru' })).body.data.bagian_id, unit.id);
      for (const bagian_id of [null, '', inactive.id, randomUUID()]) assert.equal((await patch({ bagian_id })).status, 400);
      assert.equal((await patch({ bagian_id: other.id })).body.data.bagian_id, other.id);
      assert.equal((await patch({ peran: 'tata_usaha' })).body.data.bagian_id, other.id);
      const cleared = await patch({ peran: 'kepala_sekolah' });
      assert.equal(cleared.status, 200); assert.equal(cleared.body.data.bagian_id, null);
      assert.equal((await patch({ peran: 'kepala_bagian' })).status, 400);
      assert.equal((await patch({ peran: 'kepala_bagian', bagian_id: unit.id })).status, 200);
      await prisma.bagian.update({ where: { id: unit.id }, data: { aktif: false } });
      assert.equal((await patch({ nama_lengkap: 'Unit Lama Tetap', bagian_id: unit.id })).status, 200, 'Unrelated PATCH preserves historical inactive unit even if it repeats the current ID.');
      assert.equal((await patch({ peran: 'guru_staf' })).status, 400);
      assert.equal((await patch({ aktif: false })).status, 200);
      assert.equal((await patch({ aktif: true })).status, 400);
      assert.equal((await patch({ aktif: true, bagian_id: other.id })).status, 200);
      await prisma.bagian.update({ where: { id: unit.id }, data: { aktif: true } });
      await prisma.user.update({ where: { id: target.id }, data: { bagian_id: null } });
      for (const body of [{ nama_lengkap: 'Tanpa Unit' }, { bagian_id: null }, { aktif: true }, { bisa_hapus: true }]) {
        assert.equal((await patch(body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await patch({ aktif: false })).status, 200, 'A legacy invalid account can still be deactivated safely.');
      assert.equal((await patch({ aktif: true })).status, 400);
      assert.equal((await patch({ aktif: true, bagian_id: other.id })).status, 200);
      const stored = await prisma.user.findUnique({ where: { id: target.id } });
      assert.equal(stored.bagian_id, other.id); assert.equal(stored.aktif, true);
    });
  } finally {
    await drainAudit();
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
    process.chdir(previousCwd);
    fs.existsSync = exists; fs.readFileSync = read;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
