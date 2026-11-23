/** Uji alur HTTP dengan SQLite dan berkas privat sementara. Tidak memakai app.js. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const scratch = process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'batavia-tests');
const jwt = require('jsonwebtoken');

test('Alur Batavia: registrasi, scope, disposisi, dashboard, lampiran dan seed', async (t) => {
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'batavia-alur-'));
  const previousCwd = process.cwd();
  let prisma, server, drainAudit;
  let checks = 0;
  const existsSync = fs.existsSync;
  const readFileSync = fs.readFileSync;
  const isDotenv = (file) => typeof file === 'string' && /^\.env(?:\.|$)/i.test(path.basename(file));
  try {
    const file = path.join(dir, 'uji.db');
    Object.assign(process.env, {
      MODE: 'lab', PORT: '6091', JWT_SECRET: randomBytes(32).toString('hex'),
      DATABASE_URL: `file:${file.replaceAll('\\', '/')}`,
      PRIVATE_STORAGE_DIR: path.join(dir, 'private'),
    });
    const sqlite = new DatabaseSync(file);
    try {
      const migrations = path.join(root, 'prisma/migrations');
      const dirs = fs.readdirSync(migrations, { withFileTypes: true }).filter((e) => e.isDirectory());
      for (const name of dirs.map((e) => e.name).sort()) {
        sqlite.exec(readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
      }
    } finally {
      sqlite.close();
    }
    process.chdir(dir);
    // Prisma's generated client can look for .env beside the project schema.
    fs.existsSync = (f) => !isDotenv(f) && existsSync(f);
    fs.readFileSync = (f, ...args) => {
      if (isDotenv(f)) throw Object.assign(new Error('.env tidak digunakan oleh uji alur'), { code: 'ENOENT' });
      return readFileSync(f, ...args);
    };
    assert.ok(require('@prisma/client').Prisma.ModelName.NotifikasiPenugasan, 'Jalankan prisma generate untuk skema terbaru.');
    prisma = require('../src/config/database');
    ({ drainAudit } = require('../src/middleware/logActivity'));
    const express = require('express');
    const { errorHandler } = require('../src/middleware/errorHandler');
    const app = express();
    app.use(express.json());
    app.use('/api', require('../src/routes/alur.routes'));
    app.use(errorHandler);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(user, method, url, body) {
      const headers = user ? { Authorization: `Bearer ${jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' })}` } : {};
      if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
      const response = await fetch(base + url, { method, headers, body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined });
      const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.arrayBuffer();
      return { status: response.status, body: data, headers: response.headers };
    }
    function status(result, expected) { checks++; assert.equal(result.status, expected, JSON.stringify(result.body)); return result.body; }
    async function disposisikan(principal, payload) {
      const url = `/surat-masuk/${payload.surat_masuk_id}`;
      const { data } = status(await call(principal, 'GET', url), 200);
      if (data.status === 'diterima') status(await call(principal, 'PATCH', url, { status: 'dibaca_pimpinan' }), 200);
      return call(principal, 'POST', '/disposisi', payload);
    }
    const izin = (u, resource, action, allowed) => prisma.userPermission.upsert({
      where: { user_id_resource_action: { user_id: u.id, resource, action } },
      create: { user_id: u.id, resource, action, allowed }, update: { allowed },
    });
    const tanggalJakarta = (i = 0) => new Date(Date.now() + (7 + 24 * i) * 3600000).toISOString().slice(0, 10);
    const bagian = await prisma.bagian.create({ data: { nama: 'Unit Uji A', singkatan: 'UJA' } });
    const bagian2 = await prisma.bagian.create({ data: { nama: 'Unit Uji B', singkatan: 'UJB' } });
    async function user(peran, suffix = '', unit = bagian.id) {
      return prisma.user.create({ data: { email: `${peran}${suffix}@uji.invalid`, nama_lengkap: `${peran} Sintetis ${suffix}`, password_hash: 'tidak-untuk-login', peran, bagian_id: unit, password_changed_at: new Date(0) } });
    }
    const admin = await user('superadmin', '', null); const tu = await user('tata_usaha'); const principal = await user('kepala_sekolah', '', null);
    const head = await user('kepala_bagian'); const head2 = await user('kepala_bagian', '2', bagian2.id);
    const staff = await user('guru_staf'); const peer = await user('guru_staf', '2');
    // Explicit grants make scope assertions independent from the concurrently developed role defaults.
    for (const u of [tu, principal, head, head2, staff, peer]) {
      for (const [resource, actions] of Object.entries({ surat_masuk: ['read', 'create', 'update'], surat_keluar: ['read', 'create', 'update'], disposisi: ['read', 'create', 'update'], lampiran: ['read', 'create'], tindak_lanjut: ['create'] })) {
        for (const action of actions) await prisma.userPermission.create({ data: { user_id: u.id, resource, action, allowed: true } });
      }
    }
    const klasifikasi = await prisma.klasifikasi.create({ data: { kode: 'UJI.A', nama: 'Uji A' } });
    const klasifikasi2 = await prisma.klasifikasi.create({ data: { kode: 'UJI.B', nama: 'Uji B' } });
    const jenis = await prisma.jenisSurat.create({ data: { kode: 'uji', nama: 'Jenis Uji' } });
    const masukBody = { nomor_surat: 'SINTETIS/001', pengirim: 'Pengirim Sintetis', tanggal_surat: '2026-10-01', tanggal_terima: '2026-10-02', perihal: 'Undangan sintetis', klasifikasi_id: klasifikasi.id, jenis_surat_id: jenis.id };
    let letter; let other; let task; let outgoing; let attachment;

    await t.test('validasi, registrasi lintas klasifikasi dan race-safe', async () => {
      status(await call(null, 'GET', '/surat-masuk'), 401);
      status(await call(tu, 'POST', '/surat-masuk', {}), 400);
      status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, tanggal_surat: '2026-02-31' }), 400);
      status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, tanggal_terima: '2026-09-30' }), 400);
      status(await call(staff, 'POST', '/surat-masuk', masukBody), 403);
      letter = status(await call(tu, 'POST', '/surat-masuk', masukBody), 201).data;
      assert.equal(letter.nomor_registrasi, 'SM/001/X/2026');
      assert.equal(letter.jenis_surat.nama, 'Jenis Uji'); assert.equal(letter.pembuat.password_hash, undefined);
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call(tu, 'POST', '/surat-masuk', { ...masukBody, nomor_surat: `RACE/${i}`, klasifikasi_id: klasifikasi2.id })));
      const numbers = results.map((r) => status(r, 201).data.nomor_registrasi);
      assert.equal(new Set(numbers).size, 8); assert.ok(numbers.includes('SM/009/X/2026'));
      other = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, perihal: 'Rahasia sintetis', sensitif: true }), 201).data;
    });
    await t.test('disposisi pimpinan ke unit/staf dan penolakan ID lintas lingkup', async () => {
      status(await call(tu, 'POST', '/disposisi', { surat_masuk_id: letter.id, ke_bagian_id: bagian.id, instruksi: 'Kerjakan' }), 403);
      task = status(await disposisikan(principal, { surat_masuk_id: letter.id, ke_bagian_id: bagian.id, ke_user_id: staff.id, instruksi: 'Tindak lanjuti undangan', deadline: '2026-01-01' }), 201).data;
      assert.equal(task.ke_user.id, staff.id); assert.equal(task.surat_masuk.id, letter.id);
      for (const u of [peer, head2]) {
        status(await call(u, 'GET', `/surat-masuk/${letter.id}`), 404);
        status(await call(u, 'GET', `/disposisi/${task.id}`), 404);
        assert.equal(status(await call(u, 'GET', '/surat-masuk'), 200).data.length, 0);
      }
      status(await call(head, 'GET', `/surat-masuk/${letter.id}`), 200);
      status(await call(staff, 'GET', `/surat-masuk/${letter.id}`), 200);
      status(await call(head, 'GET', `/surat-masuk/${other.id}`), 404);
      status(await call(staff, 'PATCH', `/disposisi/${task.id}`, { status: 'selesai' }), 409);
      status(await call(staff, 'PATCH', `/disposisi/${task.id}`, { status: 'diproses', catatan: 'Menghubungi pihak terkait' }), 200);
      let dash = status(await call(staff, 'GET', '/dashboard'), 200).data;
      assert.equal(dash.lingkup, 'penugasan'); assert.equal(dash.ringkasan.surat_masuk, 1); assert.equal(dash.ringkasan.terlambat, 1);
      status(await call(staff, 'PATCH', `/disposisi/${task.id}`, { status: 'selesai', catatan: 'Sudah ditindaklanjuti' }), 200);
      assert.equal((await prisma.suratMasuk.findUnique({ where: { id: letter.id } })).status, 'selesai');
      await prisma.userPermission.create({ data: { user_id: staff.id, resource: 'tindak_lanjut', action: 'read', allowed: false } });
      const hiddenNotes = status(await call(staff, 'GET', `/disposisi/${task.id}`), 200).data;
      assert.ok(!hiddenNotes.tindak_lanjut || hiddenNotes.tindak_lanjut.length === 0);
      const hiddenDetail = status(await call(staff, 'GET', `/surat-masuk/${letter.id}`), 200).data;
      assert.ok(hiddenDetail.disposisi.every((d) => !d.tindak_lanjut || d.tindak_lanjut.length === 0));
      assert.equal(await prisma.tindakLanjut.count({ where: { disposisi_id: task.id } }), 2);
      dash = status(await call(peer, 'GET', '/dashboard'), 200).data;
      assert.equal(dash.ringkasan.surat_masuk, 0); assert.equal(dash.prioritas.length, 0);
      assert.ok(dash.aktivitas.every((a) => a.entitas_id !== letter.id));
      status(await call(tu, 'PATCH', `/surat-masuk/${letter.id}`, { status: 'diarsipkan' }), 200);
    });
    await t.test('surat keluar: draft, persetujuan dan kirim', async () => {
      const payload = { nomor_surat: 'KELUAR/SINTETIS', tujuan: 'Tujuan Sintetis', tanggal_surat: '2026-10-10', perihal: 'Balasan sintetis', klasifikasi_id: klasifikasi.id, jenis_surat_id: jenis.id };
      outgoing = status(await call(tu, 'POST', '/surat-keluar', payload), 201).data;
      assert.equal(outgoing.nomor_registrasi, 'SK/001/X/2026');
      status(await call(tu, 'PATCH', `/surat-keluar/${outgoing.id}`, { status: 'terkirim' }), 409);
      status(await call(tu, 'PATCH', `/surat-keluar/${outgoing.id}`, { status: 'menunggu_tanda_tangan' }), 200);
      status(await call(tu, 'PATCH', `/surat-keluar/${outgoing.id}`, { status: 'disetujui' }), 403);
      status(await call(principal, 'PATCH', `/surat-keluar/${outgoing.id}`, { status: 'disetujui' }), 200);
      status(await call(tu, 'PATCH', `/surat-keluar/${outgoing.id}`, { status: 'terkirim' }), 200);
      status(await call(peer, 'GET', `/surat-keluar/${outgoing.id}`), 404);
    });
    await t.test('filter, pagination cap, lookup aman dan dashboard nyata', async () => {
      const list = status(await call(tu, 'GET', '/surat-masuk?q=Rahasia&status=diterima&dari=2026-10-01&sampai=2026-10-31&limit=999'), 200);
      assert.equal(list.meta.limit, 100); assert.equal(list.meta.total, 1); assert.equal(list.data[0].id, other.id);
      status(await call(tu, 'GET', '/surat-masuk?dari=invalid'), 400);
      status(await call(tu, 'GET', '/surat-masuk?page=9007199254740991&limit=100'), 400);
      const refs = status(await call(principal, 'GET', '/referensi'), 200).data;
      assert.ok(refs.bagian.length >= 2); assert.ok(refs.pengguna.some((u) => u.id === staff.id));
      assert.ok(refs.pengguna.every((u) => !('password_hash' in u) && !('totp_secret_enc' in u)));
      const dash = status(await call(admin, 'GET', '/dashboard'), 200).data;
      assert.equal(dash.lingkup, 'sekolah'); assert.equal(dash.ringkasan.surat_masuk, 10); assert.equal(dash.ringkasan.surat_keluar, 1);
      assert.equal(dash.tren.length, 7);
      assert.ok(dash.tren.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.tanggal)));
      await prisma.userPermission.upsert({ where: { user_id_resource_action: { user_id: staff.id, resource: 'surat_masuk', action: 'read' } }, create: { user_id: staff.id, resource: 'surat_masuk', action: 'read', allowed: false }, update: { allowed: false } });
      status(await call(staff, 'GET', '/surat-masuk'), 403);
      const staffTasks = status(await call(staff, 'GET', '/disposisi'), 200).data;
      assert.equal(staffTasks.length, 1);
      const deniedDash = status(await call(staff, 'GET', '/dashboard'), 200).data;
      assert.equal(deniedDash.ringkasan.surat_masuk, 0); assert.equal(deniedDash.ringkasan.disposisi_aktif, 0);
      assert.ok(deniedDash.tren.every((month) => month.masuk === 0)); assert.equal(deniedDash.prioritas.length, 0);
      assert.ok(deniedDash.aktivitas.every((a) => a.entitas !== 'surat_masuk'));
      const noNumber = { tujuan: 'Auto Sintetis', tanggal_surat: '2026-11-01', perihal: 'Nomor otomatis', klasifikasi_id: klasifikasi.id, jenis_surat_id: jenis.id };
      const auto = status(await call(tu, 'POST', '/surat-keluar', noNumber), 201).data;
      assert.equal(auto.nomor_surat, auto.nomor_registrasi); assert.equal(auto.nomor_registrasi, 'SK/002/XI/2026');
    });
    await t.test('lampiran privat, magic bytes dan otorisasi', async () => {
      function file(bytes, name = 'scan.pdf', mime = 'application/pdf') { const form = new FormData(); form.set('file', new Blob([bytes], { type: mime }), name); return form; }
      status(await call(tu, 'POST', `/lampiran/surat_masuk/${other.id}`, file('<html>not pdf</html>')), 400);
      status(await call(tu, 'POST', `/lampiran/surat_masuk/${letter.id}`, file('%PDF-1.4\nsynthetic\n%%EOF')), 409);
      attachment = status(await call(tu, 'POST', `/lampiran/masuk/${other.id}`, file('%PDF-1.4\nsynthetic\n%%EOF')), 201).data;
      assert.equal(attachment.path_storage, undefined); assert.equal(attachment.nama_asli, 'scan.pdf');
      status(await call(peer, 'GET', `/lampiran/${attachment.id}`), 404);
      const download = await call(principal, 'GET', `/lampiran/${attachment.id}`); status(download, 200);
      assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(download.headers.get('content-disposition').startsWith('attachment;'));
      status(await call(tu, 'POST', `/lampiran/surat_masuk/${other.id}`, file(new Uint8Array(10 * 1024 * 1024 + 1))), 413);
      assert.equal(fs.readdirSync(process.env.PRIVATE_STORAGE_DIR).length, 1);
    });
    await t.test('reassign kepala bagian terbatas dan surat sensitif tidak dibuka ke seluruh unit', async () => {
      const sensitiveTask = status(await disposisikan(principal, { surat_masuk_id: other.id, ke_bagian_id: bagian.id, instruksi: 'Tugas unit sensitif', ke_user_id: head.id }), 201).data;
      status(await call(head, 'GET', `/surat-masuk/${other.id}`), 200);
      status(await call(peer, 'GET', `/surat-masuk/${other.id}`), 404);
      status(await call(head, 'PATCH', `/disposisi/${sensitiveTask.id}`, { ke_user_id: head2.id }), 400);
      const regular = status(await disposisikan(principal, { surat_masuk_id: (await prisma.suratMasuk.findFirst({ where: { nomor_surat: 'RACE/0' } })).id, ke_bagian_id: bagian.id, instruksi: 'Bagi tugas dalam unit' }), 201).data;
      status(await call(peer, 'GET', `/surat-masuk/${regular.surat_masuk_id}`), 200);
      status(await call(head, 'PATCH', `/disposisi/${regular.id}`, { ke_user_id: peer.id }), 200);
      status(await call(peer, 'GET', `/surat-masuk/${regular.surat_masuk_id}`), 200);
      status(await call(head2, 'PATCH', `/disposisi/${regular.id}`, { ke_user_id: head2.id }), 404);
      const refs = status(await call(peer, 'GET', '/referensi'), 200).data;
      assert.deepEqual(refs.pengguna.map((u) => u.id), [peer.id]);
      const sibling = status(await disposisikan(principal, { surat_masuk_id: regular.surat_masuk_id, ke_bagian_id: bagian.id, ke_user_id: head.id, instruksi: 'Instruksi hanya untuk kepala bagian' }), 201).data;
      const peerDetail = status(await call(peer, 'GET', `/surat-masuk/${regular.surat_masuk_id}`), 200).data;
      assert.deepEqual(peerDetail.disposisi.map((d) => d.id), [regular.id]);
      status(await call(peer, 'GET', `/disposisi/${sibling.id}`), 404);
    });
    await t.test('alur inti bekerja dengan bawaan peran tanpa grant uji', async () => {
      await prisma.userPermission.deleteMany({ where: { user_id: { in: [tu.id, principal.id, staff.id, head.id] } } });
      const fresh = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, perihal: 'Alur bawaan nyata' }), 201).data;
      status(await call(principal, 'PATCH', `/surat-masuk/${fresh.id}`, { status: 'dibaca_pimpinan' }), 200);
      const assigned = status(await disposisikan(principal, { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, ke_user_id: staff.id, instruksi: 'Kerjakan dengan izin bawaan' }), 201).data;
      status(await call(staff, 'PATCH', `/disposisi/${assigned.id}`, { status: 'dibaca' }), 200);
      status(await call(staff, 'PATCH', `/disposisi/${assigned.id}`, { status: 'diproses' }), 200);
      status(await call(staff, 'PATCH', `/disposisi/${assigned.id}`, { status: 'selesai', catatan: 'Selesai dari akun staf bawaan' }), 200);
      const sent = status(await call(tu, 'POST', '/surat-keluar', { tujuan: 'Tujuan uji', tanggal_surat: '2026-11-01', perihal: 'Persetujuan bawaan', klasifikasi_id: klasifikasi.id, jenis_surat_id: jenis.id }), 201).data;
      status(await call(tu, 'PATCH', `/surat-keluar/${sent.id}`, { status: 'menunggu_tanda_tangan' }), 200);
      status(await call(principal, 'PATCH', `/surat-keluar/${sent.id}`, { status: 'disetujui' }), 200);
      status(await call(tu, 'PATCH', `/surat-keluar/${sent.id}`, { status: 'terkirim' }), 200);
      await require('../src/middleware/logActivity').drainAudit();
      assert.ok(await prisma.activityLog.findFirst({ where: { entitas_id: fresh.id, aksi: 'create' } }), 'Audit harus menyimpan ID surat agar jejak dan scope dashboard bekerja');
    });
    await t.test('pencarian disposisi mencakup nomor surat dan nomor registrasi', async () => {
      const row = await prisma.disposisi.findFirst({ include: { surat_masuk: true } });
      for (const q of [row.surat_masuk.nomor_surat, row.surat_masuk.nomor_registrasi]) {
        const result = status(await call(admin, 'GET', `/disposisi?q=${encodeURIComponent(q)}`), 200);
        assert.ok(result.data.some((r) => r.id === row.id), `Disposisi harus dapat dicari melalui ${q}`);
      }
    });
    await t.test('penerusan surat sensitif berhasil walau akses pengirim dilepas', async () => {
      const sensitive = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, sensitif: true, perihal: 'Delegasi sensitif khusus' }), 201).data;
      const assigned = status(await disposisikan(principal, { surat_masuk_id: sensitive.id, ke_bagian_id: bagian.id, ke_user_id: head.id, instruksi: 'Teruskan ke staf dalam unit' }), 201).data;
      status(await call(head, 'PATCH', `/disposisi/${assigned.id}`, { ke_user_id: head2.id }), 400);
      const result = status(await call(head, 'PATCH', `/disposisi/${assigned.id}`, { ke_user_id: staff.id }), 200).data;
      assert.equal(result.id, assigned.id);
      assert.equal(result.akses_dilepas, true);
      assert.deepEqual(Object.keys(result).sort(), ['akses_dilepas', 'id', 'ke_user_id', 'status']);
      assert.equal((await prisma.disposisi.findUnique({ where: { id: assigned.id } })).ke_user_id, staff.id);
      status(await call(head, 'GET', `/disposisi/${assigned.id}`), 404);
      status(await call(head, 'GET', `/surat-masuk/${sensitive.id}`), 404);
      status(await call(staff, 'GET', `/disposisi/${assigned.id}`), 200);
      status(await call(peer, 'GET', `/surat-masuk/${sensitive.id}`), 404);
    });
    await t.test('deny baca tindak lanjut menutup catatan scalar, relasi dan pencarian', async () => {
      const marker = 'CATATAN-RAHASIA-TERBATAS-7492';
      const fresh = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, perihal: 'Pembatasan catatan uji' }), 201).data;
      const assigned = status(await disposisikan(principal, { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, ke_user_id: staff.id, instruksi: 'Instruksi umum tanpa isi catatan' }), 201).data;
      await prisma.userPermission.upsert({ where: { user_id_resource_action: { user_id: staff.id, resource: 'tindak_lanjut', action: 'read' } }, create: { user_id: staff.id, resource: 'tindak_lanjut', action: 'read', allowed: false }, update: { allowed: false } });
      const mutation = status(await call(staff, 'PATCH', `/disposisi/${assigned.id}`, { status: 'diproses', catatan: marker }), 200).data;
      assert.equal(mutation.catatan, undefined);
      assert.equal(mutation.tindak_lanjut, undefined);
      const urls = [`/disposisi/${assigned.id}`, '/disposisi', `/surat-masuk/${fresh.id}`, '/dashboard'];
      for (const url of urls) {
        const result = status(await call(staff, 'GET', url), 200);
        assert.ok(!JSON.stringify(result).includes(marker), `Catatan bocor lewat ${url}`);
      }
      const hiddenSearch = status(await call(staff, 'GET', `/disposisi?q=${marker}`), 200);
      assert.equal(hiddenSearch.meta.total, 0, 'Hasil pencarian tidak boleh menjadi oracle catatan tersembunyi');
      assert.equal((await prisma.disposisi.findUnique({ where: { id: assigned.id } })).catatan, marker);
      const visible = status(await call(admin, 'GET', `/disposisi/${assigned.id}`), 200).data;
      assert.equal(visible.catatan, marker);
      assert.ok(visible.tindak_lanjut.some((n) => n.catatan === marker));
      assert.equal(status(await call(admin, 'GET', `/disposisi?q=${marker}`), 200).meta.total, 1);
      await prisma.userPermission.delete({ where: { user_id_resource_action: { user_id: staff.id, resource: 'tindak_lanjut', action: 'read' } } });
      assert.equal(status(await call(staff, 'GET', `/disposisi/${assigned.id}`), 200).data.catatan, marker);
    });
    await t.test('status dan catatan hanya diubah pelaksana, bukan pengawas dengan grant', async () => {
      const fresh = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, perihal: 'Hak pemantau bukan hak pelaksana' }), 201).data;
      const assigned = status(await disposisikan(principal, { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, ke_user_id: staff.id, instruksi: 'Tugas hanya untuk pelaksana' }), 201).data;
      await prisma.userPermission.upsert({ where: { user_id_resource_action: { user_id: tu.id, resource: 'disposisi', action: 'update' } }, create: { user_id: tu.id, resource: 'disposisi', action: 'update', allowed: true }, update: { allowed: true } });
      for (const u of [principal, tu, admin]) {
        status(await call(u, 'PATCH', `/disposisi/${assigned.id}`, { status: 'dibaca' }), 403);
        status(await call(u, 'PATCH', `/disposisi/${assigned.id}`, { catatan: 'Catatan bukan milik pelaksana' }), 403);
      }
      status(await call(peer, 'PATCH', `/disposisi/${assigned.id}`, { status: 'dibaca' }), 404);
      assert.equal((await prisma.disposisi.findUnique({ where: { id: assigned.id } })).status, 'baru');
      status(await call(staff, 'PATCH', `/disposisi/${assigned.id}`, { status: 'diproses', catatan: 'Hasil sementara' }), 200);
      status(await call(principal, 'PATCH', `/disposisi/${assigned.id}`, { status: 'selesai' }), 403);
      await prisma.userPermission.upsert({ where: { user_id_resource_action: { user_id: staff.id, resource: 'tindak_lanjut', action: 'create' } }, create: { user_id: staff.id, resource: 'tindak_lanjut', action: 'create', allowed: false }, update: { allowed: false } });
      status(await call(staff, 'PATCH', `/disposisi/${assigned.id}`, { status: 'selesai' }), 403);
      assert.equal((await prisma.disposisi.findUnique({ where: { id: assigned.id } })).status, 'diproses');
      assert.equal(await prisma.tindakLanjut.count({ where: { disposisi_id: assigned.id } }), 1);
      await prisma.userPermission.delete({ where: { user_id_resource_action: { user_id: staff.id, resource: 'tindak_lanjut', action: 'create' } } });
      const delegated = status(await call(principal, 'PATCH', `/disposisi/${assigned.id}`, { ke_user_id: peer.id }), 200).data;
      assert.equal(delegated.ke_user_id, peer.id);
      status(await call(staff, 'PATCH', `/disposisi/${assigned.id}`, { status: 'selesai', catatan: 'Sudah bukan penerima' }), 404);
      status(await call(head, 'PATCH', `/disposisi/${assigned.id}`, { status: 'selesai', catatan: 'Kepala unit mencatat penyelesaian' }), 200);
      await prisma.userPermission.delete({ where: { user_id_resource_action: { user_id: tu.id, resource: 'disposisi', action: 'update' } } });
    });
    await t.test('surat masuk baru hanya dapat ditelaah dan didisposisikan kepala sekolah', async () => {
      const current = status(await call(tu, 'POST', '/surat-masuk', masukBody), 201).data;
      const payload = { surat_masuk_id: current.id, ke_bagian_id: bagian.id, instruksi: 'Telaah dahulu' };
      status(await call(admin, 'PATCH', `/surat-masuk/${current.id}`, { status: 'dibaca_pimpinan' }), 403);
      status(await call(principal, 'POST', '/disposisi', payload), 409);
      status(await call(tu, 'PATCH', `/surat-masuk/${current.id}`, { status: 'dibaca_pimpinan' }), 403);
      assert.equal(await prisma.disposisi.count({ where: { surat_masuk_id: current.id } }), 0);
      status(await call(principal, 'PATCH', `/surat-masuk/${current.id}`, { status: 'dibaca_pimpinan' }), 200);
      status(await call(admin, 'POST', '/disposisi', payload), 403);
      status(await call(principal, 'POST', '/disposisi', { ...payload, ke_user_id: head2.id }), 400);
      assert.equal((await prisma.suratMasuk.findUnique({ where: { id: current.id } })).status, 'dibaca_pimpinan');
      status(await call(principal, 'POST', '/disposisi', payload), 201);
      status(await call(principal, 'POST', '/disposisi', { ...payload, ke_bagian_id: bagian2.id }), 201);
      status(await call(principal, 'POST', '/disposisi', { ...payload, surat_masuk_id: letter.id }), 409);
    });
    await t.test('broadcast atomik ke unit aktif, tugas kolektif bukan untuk surat sensitif', async () => {
      const inactive = await prisma.bagian.create({ data: { nama: 'Unit Nonaktif', singkatan: 'UNA', aktif: false } });
      const fresh = status(await call(tu, 'POST', '/surat-masuk', masukBody), 201).data;
      const payload = { surat_masuk_id: fresh.id, ke_bagian_id: 'SEMUA', instruksi: 'Kerja kolektif sekolah' };
      const broadcast = status(await disposisikan(principal, payload), 201).data;
      const rows = await prisma.disposisi.findMany({ where: { surat_masuk_id: fresh.id } });
      assert.equal(broadcast.jumlah_dibuat, 2);
      assert.deepEqual(broadcast.created_ids.slice().sort(), rows.map((r) => r.id).sort());
      await drainAudit();
      assert.deepEqual((await prisma.activityLog.findMany({ where: { entitas: 'disposisi', aksi: 'create', entitas_id: { in: rows.map((r) => r.id) } } })).map((r) => r.entitas_id).sort(), rows.map((r) => r.id).sort());
      assert.deepEqual(rows.map((r) => r.ke_bagian_id).sort(), [bagian.id, bagian2.id].sort());
      assert.ok(rows.every((r) => r.ke_user_id === null && r.ke_bagian_id !== inactive.id));
      const r = rows.find((d) => d.ke_bagian_id === bagian.id);
      status(await call(head2, 'GET', `/disposisi/${r.id}`), 404);
      status(await call(staff, 'PATCH', `/disposisi/${r.id}`, { status: 'diproses' }), 200);
      status(await call(peer, 'PATCH', `/disposisi/${r.id}`, { status: 'selesai', catatan: 'Selesai sebagai tim' }), 200);
      assert.equal((await prisma.suratMasuk.findUnique({ where: { id: fresh.id } })).status, 'didisposisi');
      const sensitive = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, sensitif: true }), 201).data;
      status(await disposisikan(principal, { ...payload, surat_masuk_id: sensitive.id }), 400);
      status(await call(principal, 'POST', '/disposisi', { ...payload, surat_masuk_id: sensitive.id, ke_bagian_id: bagian.id }), 400);
      assert.equal(await prisma.disposisi.count({ where: { surat_masuk_id: sensitive.id } }), 0);
      const direct = status(await call(principal, 'POST', '/disposisi', { ...payload, surat_masuk_id: sensitive.id, ke_bagian_id: bagian.id, ke_user_id: staff.id }), 201).data;
      status(await call(principal, 'PATCH', `/disposisi/${direct.id}`, { ke_user_id: null }), 400);
      status(await call(peer, 'GET', `/disposisi/${direct.id}`), 404);
    });
    await t.test('multi-penerima: validasi seluruh daftar tanpa perubahan parsial', async () => {
      const fresh = status(await call(tu, 'POST', '/surat-masuk', masukBody), 201).data;
      status(await call(principal, 'PATCH', `/surat-masuk/${fresh.id}`, { status: 'dibaca_pimpinan' }), 200);
      const inactive = await user('guru_staf', 'multi-nonaktif');
      const deleted = await user('guru_staf', 'multi-terhapus');
      const noUnit = await user('guru_staf', 'multi-tanpa-unit', null);
      const principalInUnit = await user('kepala_sekolah', 'multi-unit');
      const adminInUnit = await user('superadmin', 'multi-unit');
      await prisma.user.update({ where: { id: inactive.id }, data: { aktif: false } });
      await prisma.user.update({ where: { id: deleted.id }, data: { deleted_at: new Date() } });
      const inactiveUnit = await prisma.bagian.create({ data: { nama: 'Unit multi nonaktif', singkatan: 'UMN', aktif: false } });
      const deletedUnit = await prisma.bagian.create({ data: { nama: 'Unit multi terhapus', singkatan: 'UMH', deleted_at: new Date() } });
      const payload = { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, instruksi: 'Validasi semua sebelum menulis' };
      await drainAudit();
      const snapshot = async () => ({
        surat: await prisma.suratMasuk.findUnique({ where: { id: fresh.id } }),
        tasks: await prisma.disposisi.count(), events: await prisma.notifikasiPenugasan.count(),
        notes: await prisma.tindakLanjut.count(), audit: await prisma.activityLog.count(),
      });
      const before = await snapshot();
      const invalid = [
        { ke_user_ids: [] }, { ke_user_ids: null }, { ke_user_ids: staff.id },
        ...[null, 1, {}, '', ' ', 'bukan-uuid'].map((id) => ({ ke_user_ids: [staff.id, id] })),
        { ke_user_ids: [staff.id, staff.id] }, { ke_user_ids: [staff.id, ` ${staff.id} `] },
        { ke_user_ids: Array.from({ length: 101 }, () => randomUUID()) },
        ...[staff.id, null, ''].map((id) => ({ ke_user_ids: [staff.id], ke_user_id: id })),
        { ke_bagian_id: 'SEMUA', ke_user_ids: [staff.id] },
        { ke_bagian_id: inactiveUnit.id, ke_user_ids: [staff.id] },
        { ke_bagian_id: deletedUnit.id, ke_user_ids: [staff.id] },
        ...[head2.id, inactive.id, deleted.id, noUnit.id, tu.id, principalInUnit.id, adminInUnit.id, randomUUID()]
          .flatMap((id) => [{ ke_user_ids: [staff.id, id] }, { ke_user_ids: [id, staff.id] }]),
        ...[tu.id, principalInUnit.id, adminInUnit.id].map((id) => ({ ke_user_id: id })),
      ];
      for (const input of invalid) {
        status(await call(principal, 'POST', '/disposisi', { ...payload, ...input }), 400);
        await drainAudit();
        assert.deepEqual(await snapshot(), before, `Permintaan invalid mengubah data: ${JSON.stringify(input)}`);
      }
      const collective = status(await call(principal, 'POST', '/disposisi', payload), 201).data;
      assert.equal(collective.jumlah_dibuat, 1);
      assert.deepEqual(collective.created_ids, [collective.id]);
      assert.equal(collective.ke_user_id, null);
    });
    await t.test('multi-penerima atomik: kegagalan notifikasi kedua membatalkan seluruh fanout', async () => {
      const fresh = status(await call(tu, 'POST', '/surat-masuk', masukBody), 201).data;
      status(await call(principal, 'PATCH', `/surat-masuk/${fresh.id}`, { status: 'dibaca_pimpinan' }), 200);
      await drainAudit();
      const before = await prisma.suratMasuk.findUnique({ where: { id: fresh.id } });
      const audits = await prisma.activityLog.count();
      const events = await prisma.notifikasiPenugasan.count();
      const db = new DatabaseSync(file);
      try {
        db.exec(`CREATE TRIGGER uji_fanout_gagal BEFORE INSERT ON "NotifikasiPenugasan"
          WHEN EXISTS (SELECT 1 FROM "Disposisi" WHERE id = NEW.disposisi_id AND ke_user_id = '${peer.id}')
            AND EXISTS (SELECT 1 FROM "Disposisi" d JOIN "NotifikasiPenugasan" n ON n.disposisi_id = d.id
              WHERE d.surat_masuk_id = '${fresh.id}' AND d.ke_user_id = '${staff.id}')
          BEGIN SELECT RAISE(ABORT, 'uji fanout rollback'); END;`);
        // The existing error handler maps the SQLite constraint failure to HTTP 400.
        const failed = status(await call(principal, 'POST', '/disposisi', { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, ke_user_ids: [staff.id, peer.id], instruksi: 'Rollback sungguhan' }), 400);
        assert.match(failed.message, /batasan tabel/);
      } finally { db.exec('DROP TRIGGER IF EXISTS uji_fanout_gagal'); db.close(); }
      await drainAudit();
      assert.deepEqual(await prisma.suratMasuk.findUnique({ where: { id: fresh.id } }), before);
      assert.equal(await prisma.disposisi.count({ where: { surat_masuk_id: fresh.id } }), 0);
      assert.equal(await prisma.notifikasiPenugasan.count(), events);
      assert.equal(await prisma.activityLog.count(), audits);
    });
    await t.test('multi-penerima: tugas, progres, catatan dan notifikasi mandiri; surat menunggu A dan B', async () => {
      const a = await user('guru_staf', 'multi-a');
      const b = await user('guru_staf', 'multi-b');
      const outsider = await user('guru_staf', 'multi-luar');
      const fresh = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, sensitif: true }), 201).data;
      const result = status(await disposisikan(principal, { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, ke_user_ids: [` ${a.id} `, b.id], instruksi: 'Masing-masing memberi hasil', deadline: '2026-12-31' }), 201).data;
      assert.equal(result.jumlah_dibuat, 2);
      assert.equal(result.created_ids.length, 2);
      assert.equal(new Set(result.created_ids).size, 2);
      assert.equal(result.id, result.created_ids[0]);
      const rows = await prisma.disposisi.findMany({ where: { surat_masuk_id: fresh.id }, include: { notifikasi: true } });
      assert.deepEqual(rows.map((r) => r.ke_user_id).sort(), [a.id, b.id].sort());
      assert.ok(rows.every((r) => r.ke_bagian_id === bagian.id && r.instruksi === 'Masing-masing memberi hasil' && r.deadline.toISOString() === '2026-12-31T00:00:00.000Z' && r.notifikasi));
      const taskA = rows.find((r) => r.ke_user_id === a.id);
      const taskB = rows.find((r) => r.ke_user_id === b.id);
      const notifications = async (u) => status(await call(u, 'GET', '/notifikasi'), 200).data.items
        .filter((r) => result.created_ids.includes(r.disposisi_id));
      assert.deepEqual((await notifications(a)).map((r) => r.disposisi_id), [taskA.id]);
      assert.deepEqual((await notifications(b)).map((r) => r.disposisi_id), [taskB.id]);
      assert.deepEqual(await notifications(outsider), []);
      for (const u of [a, b]) {
        const own = u.id === a.id ? taskA : taskB;
        const sibling = u.id === a.id ? taskB : taskA;
        status(await call(u, 'GET', `/disposisi/${sibling.id}`), 404);
        status(await call(u, 'PATCH', `/disposisi/${sibling.id}`, { status: 'diproses', catatan: 'Tidak boleh' }), 404);
        assert.deepEqual(status(await call(u, 'GET', `/surat-masuk/${fresh.id}`), 200).data.disposisi.map((r) => r.id), [own.id]);
      }
      status(await call(outsider, 'GET', `/surat-masuk/${fresh.id}`), 404);
      status(await call(head, 'GET', `/disposisi/${taskA.id}`), 404);
      status(await call(a, 'PATCH', `/notifikasi/${taskB.notifikasi.id}`), 404);
      status(await call(a, 'PATCH', `/notifikasi/${taskA.notifikasi.id}`), 200);
      assert.equal((await notifications(a)).length, 0);
      assert.equal((await notifications(b)).length, 1);
      status(await call(a, 'PATCH', `/disposisi/${taskA.id}`, { status: 'diproses', catatan: 'Progres A' }), 200);
      status(await call(a, 'PATCH', `/disposisi/${taskA.id}`, { status: 'selesai', catatan: 'Hasil A' }), 200);
      assert.equal((await prisma.suratMasuk.findUnique({ where: { id: fresh.id } })).status, 'didisposisi', 'A selesai tidak boleh menutup surat sebelum B selesai');
      const unchangedB = status(await call(b, 'GET', `/disposisi/${taskB.id}`), 200).data;
      assert.equal(unchangedB.status, 'baru'); assert.equal(unchangedB.catatan, null);
      assert.deepEqual(unchangedB.tindak_lanjut, []);
      status(await call(b, 'PATCH', `/disposisi/${taskB.id}`, { status: 'diproses' }), 200);
      status(await call(b, 'PATCH', `/disposisi/${taskB.id}`, { status: 'selesai', catatan: 'Hasil B' }), 200);
      assert.equal((await prisma.suratMasuk.findUnique({ where: { id: fresh.id } })).status, 'selesai');
      const notesA = await prisma.tindakLanjut.findMany({ where: { disposisi_id: taskA.id } });
      const notesB = await prisma.tindakLanjut.findMany({ where: { disposisi_id: taskB.id } });
      assert.deepEqual(notesA.map((r) => r.catatan).sort(), ['Hasil A', 'Progres A']);
      assert.deepEqual(notesB.map((r) => r.catatan), ['Hasil B']);
      assert.ok(notesA.every((r) => r.oleh_user_id === a.id) && notesB.every((r) => r.oleh_user_id === b.id));
      await drainAudit();
      assert.deepEqual((await prisma.activityLog.findMany({ where: { aksi: 'create', entitas: 'disposisi', entitas_id: { in: result.created_ids } } })).map((r) => r.entitas_id).sort(), result.created_ids.slice().sort());
    });
    await t.test('multi-penerima: batas 100 diterima termasuk kepala bagian; kepala sekolah tanpa unit tetap bisa', async () => {
      assert.equal(principal.bagian_id, null);
      const ids = [head.id, ...Array.from({ length: 99 }, () => randomUUID())];
      await prisma.user.createMany({ data: ids.slice(1).map((id, i) => ({ id, email: `multi-batas-${i}@uji.invalid`, nama_lengkap: `Pelaksana Batas ${i}`, password_hash: 'tidak-untuk-login', peran: 'guru_staf', bagian_id: bagian.id })) });
      const fresh = status(await call(tu, 'POST', '/surat-masuk', masukBody), 201).data;
      const result = status(await disposisikan(principal, { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, ke_user_ids: ids, instruksi: 'Batas daftar' }), 201).data;
      assert.equal(result.jumlah_dibuat, 100); assert.equal(result.created_ids.length, 100);
      assert.equal(await prisma.disposisi.count({ where: { surat_masuk_id: fresh.id } }), 100);
      assert.equal(await prisma.notifikasiPenugasan.count({ where: { disposisi_id: { in: result.created_ids } } }), 100);
      await drainAudit();
      assert.equal(await prisma.activityLog.count({ where: { aksi: 'create', entitas: 'disposisi', entitas_id: { in: result.created_ids } } }), 100);
    });
    await t.test('filter surat dan arsip mematuhi izin serta lingkup unit', async () => {
      const archived = `/surat-masuk/${letter.id}`;
      // Metadata tidak boleh membuka akses rutin ataupun arsip ke unit lain.
      const current = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, bagian_id: bagian2.id, sensitif: true, perihal: 'FILTER-METADATA-2026' }), 201).data;
      assert.equal(current.bagian.id, bagian2.id);
      status(await call(head2, 'GET', `/surat-masuk/${current.id}`), 404);
      const filter = `q=FILTER-METADATA-2026&bagian_id=${bagian2.id}&sensitif=true&jenis_surat_id=${jenis.id}&klasifikasi_id=${klasifikasi.id}`;
      assert.deepEqual(status(await call(tu, 'GET', `/surat-masuk?${filter}`), 200).data.map((d) => d.id), [current.id]);
      assert.equal(status(await call(tu, 'GET', `/surat-masuk?${filter.replace('true', 'false')}`), 200).meta.total, 0);
      assert.equal(status(await call(tu, 'PATCH', `/surat-masuk/${current.id}`, { bagian_id: null }), 200).data.bagian, null);
      status(await call(tu, 'PATCH', `/surat-masuk/${current.id}`, { bagian_id: 'unknown-unit' }), 400);
      status(await call(tu, 'GET', '/surat-masuk?sensitif=ya'), 400);
      status(await call(tu, 'GET', `/surat-keluar?bagian_id=${bagian.id}`), 400);
      status(await call(tu, 'GET', '/surat-masuk?arsip=1&status=diterima'), 400);
      assert.deepEqual(status(await call(tu, 'GET', '/surat-masuk?arsip=1'), 200).data.map((d) => d.id), [letter.id]);
      assert.deepEqual(status(await call(head, 'GET', '/surat-masuk?arsip=1'), 200).data.map((d) => d.id), [letter.id]);
      assert.equal(status(await call(head2, 'GET', '/surat-masuk?arsip=1'), 200).meta.total, 0);
      status(await call(staff, 'GET', '/surat-masuk?arsip=1'), 403);
      status(await call(head, 'GET', archived), 200);
      status(await call(head2, 'GET', archived), 404);
      status(await call(tu, 'PATCH', `/surat-keluar/${outgoing.id}`, { status: 'diarsipkan' }), 200);
      assert.deepEqual(status(await call(tu, 'GET', '/surat-keluar?arsip=1'), 200).data.map((d) => d.id), [outgoing.id]);
      assert.equal(status(await call(head2, 'GET', '/surat-keluar?arsip=1'), 200).meta.total, 0);
      status(await call(staff, 'GET', '/surat-keluar?arsip=1'), 403);
    });
    await t.test('lampiran disposisi hanya untuk surat masuk yang benar-benar ditugaskan', async () => {
      const input = new FormData();
      input.set('file', new Blob(['%PDF-1.4\nuntuk uji\n%%EOF']), 'uji.pdf');
      const fresh = status(await call(tu, 'POST', '/surat-keluar', { tujuan: 'Unit uji', tanggal_surat: '2026-10-01', perihal: 'Lampiran surat keluar', klasifikasi_id: klasifikasi.id, jenis_surat_id: jenis.id }), 201).data;
      const sk = status(await call(tu, 'POST', `/lampiran/keluar/${fresh.id}`, input), 201).data;
      const d = await prisma.disposisi.findFirst({ where: { surat_masuk_id: other.id } });
      await izin(head, 'surat_masuk', 'read', false);
      await izin(principal, 'surat_masuk', 'read', false);
      await izin(principal, 'surat_keluar', 'read', false);
      try {
        status(await call(head, 'GET', `/lampiran/${attachment.id}`), 200);
        status(await call(principal, 'GET', `/lampiran/${attachment.id}`), 403);
        status(await call(principal, 'GET', `/lampiran/${sk.id}`), 403);
        const detail = status(await call(head, 'GET', `/disposisi/${d.id}`), 200).data;
        assert.deepEqual(detail.lampiran.map((l) => l.id), [attachment.id]);
        assert.equal(detail.lampiran[0].path_relatif, undefined);
        assert.ok(status(await call(head, 'GET', '/disposisi'), 200).data.every((r) => !('lampiran' in r)));
        await izin(head, 'lampiran', 'read', false);
        status(await call(head, 'GET', `/lampiran/${attachment.id}`), 403);
        assert.deepEqual(status(await call(head, 'GET', `/disposisi/${d.id}`), 200).data.lampiran, []);
      } finally {
        await prisma.userPermission.deleteMany({ where: { user_id: { in: [head.id, principal.id] }, allowed: false } });
      }
    });
    await t.test('tugasku, tenggat Jakarta dan dasbor mengikuti penugasan dan izin', async () => {
      const prefix = 'JAKARTA-DEADLINE-TEST';
      const rows = [];
      for (const offset of [-1, 0, 3, 4, null]) {
        const hari = tanggalJakarta();
        const fresh = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, tanggal_surat: hari, tanggal_terima: hari, perihal: `${prefix}/${offset}` }), 201).data;
        rows.push(status(await disposisikan(principal, { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, ke_user_id: offset === 0 ? head.id : staff.id, instruksi: prefix, deadline: offset === null ? null : tanggalJakarta(offset) }), 201).data);
      }
      const ids = (u, filter) => call(u, 'GET', `/disposisi?q=${prefix}&${filter}`).then((r) => status(r, 200).data.map((d) => d.id).sort());
      assert.deepEqual(await ids(staff, 'tugasku=1&tenggat=dekat'), [rows[2].id]);
      assert.deepEqual(await ids(head, 'tugasku=1&tenggat=dekat'), [rows[1].id]);
      assert.deepEqual(await ids(head, 'tenggat=dekat'), [rows[1].id, rows[2].id].sort());
      assert.deepEqual(await ids(staff, 'tenggat=lewat'), [rows[0].id]);
      assert.deepEqual(await ids(staff, 'tenggat=aktif'), [rows[0].id, rows[2].id].sort());
      assert.deepEqual(await ids(staff, `bagian_id=${bagian2.id}`), []);
      status(await call(staff, 'GET', '/disposisi?tenggat=unknown'), 400);
      status(await call(staff, 'GET', '/disposisi?tugasku=0'), 400);
      const projected = status(await call(staff, 'GET', `/disposisi/${rows[2].id}`), 200).data;
      assert.equal(projected.can_tindak_lanjut, true);
      assert.equal(status(await call(principal, 'GET', `/disposisi/${rows[2].id}`), 200).data.can_tindak_lanjut, false);
      status(await call(staff, 'PATCH', `/disposisi/${rows[2].id}`, { status: 'diproses' }), 200);
      status(await call(staff, 'PATCH', `/disposisi/${rows[2].id}`, { status: 'selesai', catatan: 'Tenggat tidak lagi aktif' }), 200);
      assert.deepEqual(await ids(staff, 'tenggat=dekat'), []);
      for (const [periode, n] of [['minggu', 7], ['bulan', 30], ['tahun', 12]]) {
        const dash = status(await call(staff, 'GET', `/dashboard?periode=${periode}`), 200).data;
        assert.equal(dash.periode, periode);
        assert.equal(dash.tren.length, n);
        assert.equal(dash.tren.at(-1).tanggal, periode === 'tahun' ? `${tanggalJakarta().slice(0, 7)}-01` : tanggalJakarta());
        assert.ok(dash.tren.at(-1).masuk >= 4);
        assert.ok(dash.tren.every((d) => d.keluar === 0));
        assert.equal(dash.ringkasan.dekat_tenggat, 0);
        assert.ok(dash.ringkasan.terlambat >= 1);
      }
      status(await call(staff, 'GET', '/dashboard?periode=wrong'), 400);
      await izin(staff, 'surat_masuk', 'read', false);
      try {
        const dash = status(await call(staff, 'GET', '/dashboard'), 200).data;
        assert.equal(dash.ringkasan.surat_masuk, 0);
        assert.ok(dash.ringkasan.disposisi_aktif >= 3);
        assert.ok(dash.tren.every((d) => d.masuk === 0));
      } finally {
        await prisma.userPermission.deleteMany({ where: { user_id: staff.id, resource: 'surat_masuk', action: 'read' } });
      }
    });
    await t.test('notifikasi hanya untuk penerima aktif, dibatasi, dan tidak berulang akibat perubahan progres', async () => {
      const a = await user('guru_staf', 'notifikasi-a');
      const b = await user('guru_staf', 'notifikasi-b');
      const outsider = await user('guru_staf', 'notifikasi-luar', bagian2.id);
      const notifications = (u) => call(u, 'GET', '/notifikasi').then((r) => status(r, 200).data);
      const fresh = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, perihal: 'Uji notifikasi penugasan' }), 201).data;
      const payload = { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, instruksi: 'Uji notifikasi penugasan' };
      const d = status(await disposisikan(principal, payload), 201).data;
      const event = (await notifications(a)).items.find((item) => item.disposisi_id === d.id);
      assert.ok(event?.judul && event.created_at);
      assert.equal((await notifications(outsider)).items.some((item) => item.id === event.id), false);
      status(await call(outsider, 'PATCH', `/notifikasi/${event.id}`), 404);
      status(await call(a, 'PATCH', `/notifikasi/${event.id}`, {}), 200);
      status(await call(a, 'PATCH', `/notifikasi/${event.id}`, {}), 200);
      assert.equal((await notifications(a)).items.some((item) => item.id === event.id), false);
      assert.equal((await notifications(b)).items.some((item) => item.id === event.id), true);
      status(await call(a, 'PATCH', `/disposisi/${d.id}`, { status: 'diproses' }), 200);
      assert.equal((await notifications(a)).items.some((item) => item.disposisi_id === d.id), false);
      status(await call(principal, 'PATCH', `/disposisi/${d.id}`, { ke_user_id: a.id }), 200);
      assert.equal((await notifications(b)).items.some((item) => item.disposisi_id === d.id), false);
      status(await call(a, 'PATCH', `/notifikasi/${event.id}`), 404);
      const reassignment = (await notifications(a)).items.find((item) => item.disposisi_id === d.id);
      assert.ok(reassignment && reassignment.id !== event.id);
      status(await call(principal, 'PATCH', `/disposisi/${d.id}`, { ke_user_id: a.id }), 200);
      assert.equal((await notifications(a)).items.find((item) => item.disposisi_id === d.id).id, reassignment.id);
      for (let i = 0; i < 11; i++) status(await call(principal, 'POST', '/disposisi', { ...payload, ke_user_id: a.id }), 201);
      const bounded = await notifications(a);
      assert.ok(bounded.total >= 12);
      assert.equal(bounded.items.length, 10);
      await izin(a, 'disposisi', 'read', false);
      assert.deepEqual(await notifications(a), { total: 0, items: [] });
      status(await call(a, 'PATCH', `/notifikasi/${reassignment.id}`), 403);
    });
    await t.test('referensi menyembunyikan email dan menghormati izin baca katalog', async () => {
      await izin(staff, 'bagian', 'read', false);
      await izin(staff, 'klasifikasi', 'read', false);
      await izin(staff, 'jenis_surat', 'read', false);
      const refs = status(await call(staff, 'GET', '/referensi'), 200).data;
      assert.deepEqual([refs.bagian, refs.klasifikasi, refs.jenis_surat], [[], [], []]);
      assert.ok(status(await call(principal, 'GET', '/referensi'), 200).data.pengguna.every((u) => !('email' in u)));
    });
    await t.test('seed idempoten tidak menimpa data, semua peran dan status', async () => {
      const { seedAlur } = require('./seed-alur');
      const options = { password: randomBytes(24).toString('hex') };
      await seedAlur(prisma, options);
      const before = [await prisma.user.count(), await prisma.suratMasuk.count(), await prisma.suratKeluar.count(), await prisma.disposisi.count()];
      await seedAlur(prisma, options);
      assert.deepEqual([await prisma.user.count(), await prisma.suratMasuk.count(), await prisma.suratKeluar.count(), await prisma.disposisi.count()], before);
      assert.equal((await prisma.user.findUnique({ where: { id: tu.id } })).nama_lengkap, tu.nama_lengkap);
      for (const role of ['superadmin', 'tata_usaha', 'kepala_sekolah', 'kepala_bagian', 'guru_staf']) assert.ok(await prisma.user.findFirst({ where: { peran: role, email: { endsWith: '@demo.batavia.invalid' } } }));
    });
    console.log(`[uji-alur] ${checks} assertions HTTP; database sementara; tidak menyentuh data kerja.`);
  } finally {
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
      await drainAudit?.();
      await prisma?.$disconnect();
    } finally {
      fs.existsSync = existsSync;
      fs.readFileSync = readFileSync;
      process.chdir(previousCwd);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
    }
  }
});
