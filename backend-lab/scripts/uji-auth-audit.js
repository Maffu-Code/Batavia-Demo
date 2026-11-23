/** Auth/audit regressions: disposable SQLite, synthetic accounts, localhost only. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// Prisma's generated client can read a schema-relative .env even after chdir.
// Mask dotenv files for both the generated client and env.js in this test process.
const isEnvFile = (file) => typeof file === 'string' && /^\.env(?:\.|$)/.test(path.basename(file));
const originalExists = fs.existsSync;
const originalRead = fs.readFileSync;
fs.existsSync = (file) => !isEnvFile(file) && originalExists(file);
fs.readFileSync = function (file, ...args) {
  if (isEnvFile(file)) {
    const err = new Error('Environment file intentionally unavailable in isolated test.');
    err.code = 'ENOENT';
    throw err;
  }
  return originalRead.call(this, file, ...args);
};
const root = path.resolve(__dirname, '..');
const previousCwd = process.cwd();
const scratch = process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || require('node:os').homedir(), 'batavia-tests');
fs.mkdirSync(scratch, { recursive: true });
const dir = fs.mkdtempSync(path.join(scratch, 'batavia-auth-audit-'));
Object.assign(process.env, {
  MODE: 'lab', PORT: '6093', JWT_SECRET: randomBytes(32).toString('hex'),
  DATABASE_URL: `file:${path.join(dir, 'uji.db').replaceAll('\\', '/')}`,
  LOGIN_RATE_LIMIT_MAX: '2', LOGIN_RATE_LIMIT_WINDOW_MS: '900000', JWT_EXPIRES_IN: '12h',
});
const sqlite = new DatabaseSync(path.join(dir, 'uji.db'));
try {
  const migrations = path.join(root, 'prisma/migrations');
  for (const name of fs.readdirSync(migrations).sort()) {
    const file = path.join(migrations, name, 'migration.sql');
    if (fs.existsSync(file)) sqlite.exec(fs.readFileSync(file, 'utf8'));
  }
} finally { sqlite.close(); }
process.chdir(dir);
const prisma = require('../src/config/database');
const { logAudit, drainAudit } = require('../src/middleware/logActivity');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const { errorHandler } = require('../src/middleware/errorHandler');
let server;

// Independent verifier: do not derive expected hashes with the writer's helper.
function verifyChain(rows) {
  let previous = null;
  for (const row of rows) {
    assert.equal(row.prev_hash, previous, 'Each appended row must extend the immediately preceding row.');
    const canonical = JSON.stringify([
      row.user_id, row.nama_user, row.aksi, row.entitas, row.entitas_id,
      row.detail, row.ip, row.created_at.toISOString(), previous ?? '',
    ]);
    assert.equal(row.row_hash, createHash('sha256').update(canonical).digest('hex'), 'Stored audit fields must match their hash.');
    previous = row.row_hash;
  }
}

test('Auth dan audit terisolasi', async (t) => {
  try {
    const password = randomBytes(24).toString('hex');
    const password_hash = await bcrypt.hash(password, 12);
    const makeUser = (data = {}) => prisma.user.create({ data: {
      nama_lengkap: 'Akun Uji', email: `${randomUUID()}@uji.invalid`, password_hash,
      peran: 'guru_staf', password_changed_at: new Date(0), ...data,
    } });
    const active = await makeUser();
    const app = express();
    // Test-only trusted loopback lets documentation-range addresses exercise keys.
    app.set('trust proxy', 'loopback');
    app.use(express.json());
    app.use('/api/auth', require('../src/routes/auth.routes'));
    app.get('/protected', require('../src/middleware/authenticate'), (req, res) => res.json({ id: req.user.id, peran: req.user.peran }));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const getProtected = async (token) => fetch(`${base}/protected`, { headers: { Authorization: `Bearer ${token}` } });
    const login = async (email, submitted = password, ip = '192.0.2.1') => {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify({ email, password: submitted }),
      });
      return { status: response.status, body: await response.json() };
    };

    // Removing the algorithms allowlist must turn these rejections into 200s.
    await t.test('C4: hanya JWT HS256 yang diterima', async () => {
      for (const algorithm of ['HS384', 'HS512']) {
        const token = jwt.sign({ sub: active.id }, process.env.JWT_SECRET, { algorithm, expiresIn: '1h' });
        assert.equal((await getProtected(token)).status, 401, `Reject ${algorithm}.`);
      }
      const token = jwt.sign({ sub: active.id }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
      assert.equal((await getProtected(token)).status, 200);
    });

    // Spy on the cost of real bcrypt work, not wall-clock duration.
    await t.test('C3: akun tidak ditemukan, nonaktif, terhapus dan sandi salah melakukan kerja bcrypt setara', async (t) => {
      const inactive = await makeUser({ aktif: false });
      const deleted = await makeUser({ deleted_at: new Date() });
      const other = randomBytes(24).toString('hex');
      const costs = [];
      const compare = bcrypt.compare;
      t.mock.method(bcrypt, 'compare', (candidate, hash) => {
        costs.push(bcrypt.getRounds(hash));
        return compare(candidate, hash);
      });
      const failed = [];
      for (const [email, input] of [
        [active.email, other], [`${randomUUID()}@uji.invalid`, password],
        [inactive.email, password], [deleted.email, password],
      ]) failed.push(await login(email, input));
      assert.ok(failed.every(({ status }) => status === 401));
      assert.ok(failed.every(({ body }) => !body.success && body.message === failed[0].body.message && !body.data));
      assert.deepEqual(costs, [12, 12, 12, 12], 'Every credential failure performs one cost-12 comparison.');

      const success = await login(active.email);
      assert.equal(success.status, 200);
      assert.equal((await getProtected(success.body.data.token)).status, 200);
      assert.equal(success.body.data.user.id, active.id);
      await drainAudit();
      assert.equal(await prisma.activityLog.count({ where: { aksi: 'login_gagal' } }), 4);
      assert.equal(await prisma.activityLog.count({ where: { aksi: 'login_sukses', entitas_id: active.id } }), 1);
    });

    await t.test('C6: penulisan serentak memperpanjang satu rantai audit', async (t) => {
      // Simulate a backward clock adjustment while appending a concurrent burst.
      t.mock.method(Date, 'now', () => 1);
      const before = await prisma.activityLog.count();
      for (let i = 0; i < 16; i++) {
        logAudit({ user: active, aksi: 'uji', entitas: 'user', entitasId: active.id, detail: `append ${i}` });
      }
      await drainAudit();
      const rows = await prisma.activityLog.findMany({ orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
      assert.equal(rows.length, before + 16);
      assert.deepEqual(rows.slice(before).map(({ detail }) => detail), Array.from({ length: 16 }, (_, i) => `append ${i}`));
      verifyChain(rows);
    });

    await t.test('C12: batas tiap sumber tetap berlaku, batas alamat email dibagi antarsumber', async () => {
      const email = `${randomUUID()}@uji.invalid`;
      for (const ip of ['192.0.2.1', '192.0.2.2', '192.0.2.3']) {
        assert.equal((await login(email, password, ip)).status, 401);
        assert.equal((await login(` ${email.toUpperCase()} `, password, ip)).status, 401);
        assert.equal((await login(email, password, ip)).status, 429);
      }
      const before = await prisma.activityLog.count();
      assert.equal((await login(email, password, '192.0.2.4')).status, 429, 'The shared email window is exhausted.');
      assert.equal(await prisma.activityLog.count(), before, 'Requests blocked by throttling never reach login.');
      assert.equal((await login(`${randomUUID()}@uji.invalid`, password, '192.0.2.4')).status, 401);
    });
  } finally {
    await drainAudit();
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await prisma.$disconnect();
    process.chdir(previousCwd);
    fs.existsSync = originalExists;
    fs.readFileSync = originalRead;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
