/** Runner lab: tidak menulis .env, tidak reset DB, tidak deploy. */
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend-lab');
const frontend = path.join(root, 'frontend-lab');
const [major, minor, patch] = process.versions.node.split('.').map(Number);
const aman = (major === 22 && (minor > 23 || (minor === 23 && patch >= 4)))
  || (major === 24 && (minor > 22 || (minor === 22 && patch >= 1)))
  || (major === 26 && (minor > 12 || (minor === 12 && patch >= 1)));
if (!aman) {
  console.error('Gunakan Node terpatch 22.23.4+, 24.22.1+, atau 26.12.1+ pada cabang tersebut.');
  process.exit(1);
}
const fs = require('node:fs');
const command = process.argv[2] || '--run';
function gagal(pesan) {
  console.error(pesan);
  process.exit(1);
}
if (process.argv.length > 3 || !['--check', '--prepare', '--demo', '--test', '--run'].includes(command)) {
  gagal('Pilihan: --check, --prepare, --demo, --test, --run.');
}
function perlu(file, proyek) {
  if (!fs.existsSync(file)) gagal(`Dependensi ${proyek} belum lengkap. Jalankan npm ci di ${proyek}.`);
}
function sekali(file, args = [], cwd = backend) {
  const r = spawnSync(process.execPath, [file, ...args], { cwd, env: process.env, stdio: 'inherit' });
  if (r.error) console.error(r.error.message);
  if (r.status !== 0) process.exit(r.status || 1);
}

perlu(path.join(backend, 'node_modules/dotenv/package.json'), 'backend-lab');
if (command === '--test') {
  sekali('--test', ['scripts/uji-boot.js', 'scripts/uji-katalog.js', 'scripts/uji-alur.js', 'scripts/uji-pengguna.js', 'scripts/uji-auth-audit.js', 'scripts/uji-sekolah.js']);
  process.exit(0);
}

const envFrontend = { ...process.env, VITE_API_BASE: '/api' };
process.chdir(backend);
const env = require(path.join(backend, 'src/config/env'));
if (!env.LAB) gagal('Runner hanya untuk MODE=lab. MODE=produksi ditolak.');
if (['--check', '--run'].includes(command) && env.PORT !== 6080) {
  gagal('Gunakan PORT=6080 untuk runner: proxy Vite /api mengarah ke port 6080.');
}
if (command === '--prepare') {
  const prisma = path.join(backend, 'node_modules/prisma/build/index.js');
  perlu(prisma, 'backend-lab');
  sekali(prisma, ['generate']);
  sekali(prisma, ['migrate', 'deploy']);
  sekali(path.join(backend, 'scripts/seed-katalog.js'));
  console.log('Lab siap. Data lama tidak di-reset. Akun demo: jalankan --demo.');
} else if (command === '--demo') {
  process.env.SEED_ALUR_CONFIRM = 'SINTETIS';
  sekali(path.join(backend, 'scripts/seed-alur.js'));
} else if (command === '--check') {
  console.log(`Node ${process.versions.node}; MODE=lab; DB lokal; PORT=6080. Konfigurasi OK (tanpa koneksi DB atau cek port).`);
} else {
  const vite = path.join(frontend, 'node_modules/vite/bin/vite.js');
  perlu(vite, 'frontend-lab');
  const children = [];
  let stopping = false;
  function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill();
    setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    }, 5500).unref();
  }
  for (const [file, cwd, vars] of [
    [path.join(backend, 'server.js'), backend, process.env],
    [vite, frontend, envFrontend],
  ]) {
    const child = spawn(process.execPath, [file], { cwd, stdio: 'inherit', env: vars });
    children.push(child);
    child.on('error', (e) => { console.error(e.message); stop(1); });
    child.on('exit', (code) => stop(code ?? 1));
  }
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  console.log('Memulai Batavia Lab: http://127.0.0.1:5173 . Ctrl+C menutup kedua server.');
}
