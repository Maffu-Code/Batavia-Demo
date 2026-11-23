/** Smoke HTTP aplikasi lengkap dengan fixture SQLite dan port loopback sementara. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { seedSekolah } = require('./seed-alur');

const backend = path.join(__dirname, '..');
const scratch = process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'batavia-tests');
const envUji = {
  MODE: 'lab', PORT: '6080', DATABASE_URL: 'file:./uji.db', JWT_SECRET: randomBytes(32).toString('hex'),
  JWT_EXPIRES_IN: '12h', LOGIN_RATE_LIMIT_WINDOW_MS: '900000', LOGIN_RATE_LIMIT_MAX: '5', CORS_ORIGIN: '',
};

function direktoriUji(t) {
  fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'batavia-boot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

test('Konfigurasi boot menolak PORT dan target SQLite yang tidak valid', (t) => {
  const cwd = direktoriUji(t);
  for (const [key, value] of [
    ['PORT', '6080oops'], ['PORT', '0'], ['PORT', '65536'],
    ['DATABASE_URL', 'file:'], ['DATABASE_URL', 'file://host.invalid/uji.db'],
    ['DATABASE_URL', 'postgresql://host.invalid/uji'],
  ]) {
    const r = spawnSync(process.execPath, [path.join(backend, 'src/config/env.js')], {
      cwd, env: { ...process.env, ...envUji, [key]: value }, encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(r.error);
    assert.equal(r.status, 1, `${key} harus menolak nilai tidak valid`);
    assert.match(r.stderr, new RegExp(`\\b${key}\\b`));
    assert.ok(!r.stderr.includes('host.invalid'));
  }
});

test('Boot lab: health, login fixture demo, matriks izin, dan audit', async (t) => {
  const dir = direktoriUji(t);
  const previousCwd = process.cwd();
  Object.assign(process.env, envUji, {
    DATABASE_URL: `file:${path.join(dir, 'uji.db').replaceAll('\\', '/')}`,
    STORAGE_DIR: path.join(dir, 'storage'), PRIVATE_STORAGE_DIR: path.join(dir, 'private'),
  });
  const sqlite = new DatabaseSync(path.join(dir, 'uji.db'));
  try {
    const migrations = path.join(backend, 'prisma/migrations');
    for (const name of fs.readdirSync(migrations, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      sqlite.exec(fs.readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
    }
  } finally {
    sqlite.close();
  }

  let prisma, drainAudit, server;
  try {
    process.chdir(dir);
    // Prisma Client bisa mencari .env relatif terhadap skema, bukan hanya CWD.
    const existsSync = fs.existsSync;
    const readFileSync = fs.readFileSync;
    const isDotenv = (file) => typeof file === 'string' && /^\.env(?:\.|$)/.test(path.basename(file));
    fs.existsSync = (file) => !isDotenv(file) && existsSync(file);
    fs.readFileSync = (file, ...args) => {
      if (isDotenv(file)) throw Object.assign(new Error('.env tidak digunakan oleh uji boot'), { code: 'ENOENT' });
      return readFileSync(file, ...args);
    };
    t.after(() => {
      fs.existsSync = existsSync;
      fs.readFileSync = readFileSync;
    });
    const app = require('../src/app');
    prisma = require('../src/config/database');
    ({ drainAudit } = require('../src/middleware/logActivity'));

    const password = randomBytes(24).toString('hex');
    const { pengguna } = await prisma.$transaction((tx) => seedSekolah(tx, { password }), { timeout: 30000 });
    const admin = pengguna.find((u) => u.peran === 'superadmin');
    const tu = pengguna.find((u) => u.peran === 'tata_usaha');
    assert.equal(admin.email, 'pengelola@contoh.batavia.invalid');
    assert.equal(tu.email, 'dewi.lestari.tu@contoh.batavia.invalid');

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    async function req(jalur, { token, body } = {}) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api${jalur}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : token ? { Authorization: `Bearer ${token}` } : {},
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000),
      });
      return { status: res.status, body: await res.json() };
    }
    const login = (email, password) => req('/auth/login', { body: { email, password } });
    const h = await req('/health');
    assert.deepEqual([h.status, h.body.ok, h.body.mode], [200, true, 'lab']);

    const salah = await login('tidakada@uji.invalid', 'salah');
    assert.equal(salah.status, 401);
    assert.deepEqual(await login(admin.email, 'salah'), salah);
    assert.equal((await req('/auth/izin-saya')).status, 401);

    async function izin(email, peran) {
      const masuk = await login(email, password);
      assert.equal(masuk.status, 200, `login fixture ${peran}`);
      assert.equal(typeof masuk.body?.data?.token, 'string');
      const r = await req('/auth/izin-saya', { token: masuk.body.data.token });
      assert.equal(r.status, 200);
      assert.equal(r.body.data.peran, peran);
      return r.body.data.izin;
    }
    const izinAdmin = await izin(admin.email, 'superadmin');
    for (const resource of ['surat_masuk', 'surat_keluar', 'disposisi', 'user', 'izin']) {
      assert.equal(izinAdmin[resource]?.read?.boleh, true, resource);
    }
    const izinTU = await izin(tu.email, 'tata_usaha');
    assert.equal(izinTU.surat_masuk.read.boleh, true);
    assert.equal(izinTU.surat_masuk.delete.boleh, false);

    await drainAudit();
    const rows = await prisma.activityLog.findMany({ orderBy: { created_at: 'asc' } });
    assert.deepEqual(rows.map((r) => [r.aksi, r.entitas_id]), [
      ['login_gagal', null], ['login_gagal', admin.id], ['login_sukses', admin.id], ['login_sukses', tu.id],
    ]);
    let previous = null;
    for (const row of rows) {
      assert.equal(row.prev_hash, previous);
      assert.match(row.row_hash, /^[0-9a-f]{64}$/);
      previous = row.row_hash;
    }
  } finally {
    try {
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      if (drainAudit) await drainAudit();
      if (prisma) await prisma.$disconnect();
    } finally {
      process.chdir(previousCwd);
    }
  }
});
