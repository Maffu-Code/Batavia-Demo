/** Fixture sekolah diuji pada SQLite sementara; tidak menyentuh database kerja. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { seedSekolah } = require('./seed-alur');

test('Contoh sekolah: 50 masuk, 50 keluar, unit akun dan tugas mandiri', async () => {
  assert.equal(typeof seedSekolah, 'function', 'Fixture sekolah harus tersedia.');
  const scratch = process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || require('node:os').homedir(), 'batavia-tests');
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'sekolah-'));
  const file = path.join(dir, 'uji.db');
  const sqlite = new DatabaseSync(file);
  const migrations = path.join(__dirname, '../prisma/migrations');
  try {
    for (const name of fs.readdirSync(migrations, { withFileTypes: true }).filter((r) => r.isDirectory()).map((r) => r.name).sort()) {
      sqlite.exec(fs.readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
    }
  } finally { sqlite.close(); }
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll('\\', '/')}` } } });
  try {
    const password = randomBytes(24).toString('hex');
    await assert.rejects(() => seedSekolah(db, { password: 'short' }));
    const first = await db.$transaction((tx) => seedSekolah(tx, { password }), { timeout: 60000 });
    assert.equal(await db.suratMasuk.count(), 50);
    assert.equal(await db.suratKeluar.count(), 50);
    const accounts = await db.user.findMany();
    assert.ok(accounts.filter((u) => u.peran === 'guru_staf').length >= 10);
    const principal = accounts.find((u) => u.peran === 'kepala_sekolah');
    assert.equal(principal.nama_lengkap, 'Randy Septo Anggara');
    for (const u of accounts) {
      assert.ok(!u.nama_lengkap.includes('SINTETIS'));
      assert.ok(u.email.endsWith('@contoh.batavia.invalid'));
      assert.equal(u.bagian_id === null, ['superadmin', 'kepala_sekolah'].includes(u.peran));
    }
    for (const unit of await db.bagian.findMany({ where: { aktif: true, deleted_at: null } })) {
      assert.ok(accounts.some((u) => u.peran === 'kepala_bagian' && u.bagian_id === unit.id));
      assert.ok(accounts.filter((u) => u.peran === 'guru_staf' && u.bagian_id === unit.id).length >= 2);
    }
    assert.ok(await require('bcryptjs').compare(password, principal.password_hash));
    assert.ok((await db.disposisi.findMany({ distinct: ['ke_user_id'] })).length > 1);
    for (const row of await db.disposisi.findMany({ include: { ke_user: true, surat_masuk: true } })) {
      assert.equal(row.ke_bagian_id, row.ke_user.bagian_id);
      assert.ok(['kepala_bagian', 'guru_staf'].includes(row.ke_user.peran));
      if (row.surat_masuk.status === 'selesai' || row.surat_masuk.status === 'diarsipkan') assert.equal(row.status, 'selesai');
    }
    const ids = await db.suratMasuk.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    await db.user.update({ where: { id: principal.id }, data: { nama_lengkap: 'Nama Suntingan Pengelola' } });
    const again = await db.$transaction((tx) => seedSekolah(tx, { password }), { timeout: 60000 });
    assert.equal(await db.suratMasuk.count(), 50);
    assert.equal(await db.suratKeluar.count(), 50);
    assert.deepEqual(await db.suratMasuk.findMany({ select: { id: true }, orderBy: { id: 'asc' } }), ids);
    assert.equal((await db.user.findUnique({ where: { id: principal.id } })).nama_lengkap, 'Nama Suntingan Pengelola');
    assert.equal(again.pengguna.length, first.pengguna.length);
  } finally {
    await db.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
