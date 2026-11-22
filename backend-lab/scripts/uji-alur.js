/** Uji alur HTTP dengan SQLite dan berkas privat sementara. Tidak memakai app.js. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const scratch = process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'batavia-tests');
fs.mkdirSync(scratch, { recursive: true });
const dir = fs.mkdtempSync(path.join(scratch, 'batavia-alur-'));
Object.assign(process.env, {
  MODE: 'lab', PORT: '6091', JWT_SECRET: randomBytes(32).toString('hex'),
  DATABASE_URL: `file:${path.join(dir, 'uji.db').replaceAll('\\', '/')}`,
  PRIVATE_STORAGE_DIR: path.join(dir, 'private'), DOTENV_CONFIG_PATH: path.join(dir, 'tidak-ada.env'),
});
fs.cpSync(path.join(root, 'prisma/schema.prisma'), path.join(dir, 'schema.prisma'));
fs.cpSync(path.join(root, 'prisma/migrations'), path.join(dir, 'migrations'), { recursive: true });
const migration = spawnSync(process.execPath, [
  path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(dir, 'schema.prisma'),
], { cwd: scratch, env: process.env, encoding: 'utf8', timeout: 60000 });
assert.equal(migration.status, 0, migration.stderr || migration.stdout);
process.chdir(scratch);
const prisma = require('../src/config/database');
const jwt = require('jsonwebtoken');
let server;
let checks = 0;

test('Alur Batavia: registrasi, scope, disposisi, dashboard, lampiran dan seed', async (t) => {
  try {
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
    const bagian = await prisma.bagian.create({ data: { nama: 'Unit Uji A', singkatan: 'UJA' } });
    const bagian2 = await prisma.bagian.create({ data: { nama: 'Unit Uji B', singkatan: 'UJB' } });
    async function user(peran, suffix = '', unit = bagian.id) {
      return prisma.user.create({ data: { email: `${peran}${suffix}@uji.invalid`, nama_lengkap: `${peran} Sintetis ${suffix}`, password_hash: 'tidak-untuk-login', peran, bagian_id: unit, password_changed_at: new Date(0) } });
    }
    const admin = await user('superadmin'); const tu = await user('tata_usaha'); const principal = await user('kepala_sekolah');
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
      task = status(await call(principal, 'POST', '/disposisi', { surat_masuk_id: letter.id, ke_bagian_id: bagian.id, ke_user_id: staff.id, instruksi: 'Tindak lanjuti undangan', deadline: '2026-01-01' }), 201).data;
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
      assert.ok(dash.tren.some((b) => b.bulan === '2026-10' && b.masuk === 10 && b.keluar === 1));
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
      const sensitiveTask = status(await call(principal, 'POST', '/disposisi', { surat_masuk_id: other.id, ke_bagian_id: bagian.id, instruksi: 'Tugas unit sensitif', ke_user_id: head.id }), 201).data;
      status(await call(head, 'GET', `/surat-masuk/${other.id}`), 200);
      status(await call(peer, 'GET', `/surat-masuk/${other.id}`), 404);
      status(await call(head, 'PATCH', `/disposisi/${sensitiveTask.id}`, { ke_user_id: head2.id }), 400);
      const regular = status(await call(principal, 'POST', '/disposisi', { surat_masuk_id: (await prisma.suratMasuk.findFirst({ where: { nomor_surat: 'RACE/0' } })).id, ke_bagian_id: bagian.id, instruksi: 'Bagi tugas dalam unit' }), 201).data;
      status(await call(peer, 'GET', `/surat-masuk/${regular.surat_masuk_id}`), 200);
      status(await call(head, 'PATCH', `/disposisi/${regular.id}`, { ke_user_id: peer.id }), 200);
      status(await call(peer, 'GET', `/surat-masuk/${regular.surat_masuk_id}`), 200);
      status(await call(head2, 'PATCH', `/disposisi/${regular.id}`, { ke_user_id: head2.id }), 404);
      const refs = status(await call(peer, 'GET', '/referensi'), 200).data;
      assert.deepEqual(refs.pengguna.map((u) => u.id), [peer.id]);
      const sibling = status(await call(principal, 'POST', '/disposisi', { surat_masuk_id: regular.surat_masuk_id, ke_bagian_id: bagian.id, ke_user_id: head.id, instruksi: 'Instruksi hanya untuk kepala bagian' }), 201).data;
      const peerDetail = status(await call(peer, 'GET', `/surat-masuk/${regular.surat_masuk_id}`), 200).data;
      assert.deepEqual(peerDetail.disposisi.map((d) => d.id), [regular.id]);
      status(await call(peer, 'GET', `/disposisi/${sibling.id}`), 404);
    });
    await t.test('alur inti bekerja dengan bawaan peran tanpa grant uji', async () => {
      await prisma.userPermission.deleteMany({ where: { user_id: { in: [tu.id, principal.id, staff.id, head.id] } } });
      const fresh = status(await call(tu, 'POST', '/surat-masuk', { ...masukBody, perihal: 'Alur bawaan nyata' }), 201).data;
      status(await call(principal, 'PATCH', `/surat-masuk/${fresh.id}`, { status: 'dibaca_pimpinan' }), 200);
      const assigned = status(await call(principal, 'POST', '/disposisi', { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, ke_user_id: staff.id, instruksi: 'Kerjakan dengan izin bawaan' }), 201).data;
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
      const assigned = status(await call(principal, 'POST', '/disposisi', { surat_masuk_id: sensitive.id, ke_bagian_id: bagian.id, ke_user_id: head.id, instruksi: 'Teruskan ke staf dalam unit' }), 201).data;
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
      const assigned = status(await call(principal, 'POST', '/disposisi', { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, ke_user_id: staff.id, instruksi: 'Instruksi umum tanpa isi catatan' }), 201).data;
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
      const assigned = status(await call(principal, 'POST', '/disposisi', { surat_masuk_id: fresh.id, ke_bagian_id: bagian.id, ke_user_id: staff.id, instruksi: 'Tugas hanya untuk pelaksana' }), 201).data;
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
    const { drainAudit } = require('../src/middleware/logActivity');
    await drainAudit();
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
    process.chdir(root);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
});
