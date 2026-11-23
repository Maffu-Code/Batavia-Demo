# Batavia Lab: Backend

Backend REST API versi lab. Express 4 + Prisma 6 + SQLite file lokal.
Dev-only. Jangan deploy ke internet publik, jangan isi data nyata.

Cara setup dan menjalankan yang dianjurkan memakai runner dari folder
root proyek. Lihat `../docs/PANDUAN-MENJALANKAN-LAB.md`. Ringkasnya,
dari root:

```
scripts\jalankan-lab.cmd --prepare    generate client, migrate deploy, seed katalog
scripts\jalankan-lab.cmd --demo       akun dan contoh operasional (idempoten)
scripts\jalankan-lab.cmd              jalankan backend + frontend
```

## Setup manual (alternatif)

```
npm ci
if not exist .env copy .env.contoh .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Salin hasil perintah terakhir ke `JWT_SECRET` di `.env`. Pastikan
`MODE=lab`, `PORT=6080`, dan `DATABASE_URL="file:./dev.db"`. Lalu:

```
npx prisma generate
npx prisma migrate deploy
node scripts/seed-katalog.js
```

Untuk setup gunakan `--prepare`, bukan `prisma migrate dev` atau
`prisma:reset`. `prisma:reset` menghapus data. `npm run seed` adalah alias
`--demo` dan tidak menimpa data yang sudah ada.

Server menyala di `http://127.0.0.1:6080`. Cek cepat:
`http://127.0.0.1:6080/api/health` harus menjawab JSON `ok: true`.

## Akun demo

Lihat [README root: Akun demo](../README.md#akun-demo) untuk akun dan sandi
demo. Jalankan `--demo` dari root setelah `--prepare`.

## Script npm

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server dengan auto-restart |
| `npm start` | Server biasa |
| `npm run seed` | Alias `--demo`: tambah contoh sintetis tanpa reset |
| `npm run seed:katalog` | Seed katalog saja, non-destruktif |
| `npm run uji` | Suite yang sama dengan runner `--test` |
| `npm run prisma:deploy` | Terapkan migrasi yang ada |
| `npm run prisma:studio` | GUI inspeksi database |

## Uji

Dari folder `backend-lab`, jalankan `npm ci`, `npm run prisma:generate`,
lalu `npm run uji`. Uji tidak perlu `.env`, seed demo, atau database kerja.
Server HTTP uji memakai port loopback yang dipilih OS.

- `uji-boot.js`: konfigurasi, health, login fixture, izin, dan audit.
- `uji-katalog.js`: CRUD katalog dan kendali izin.
- `uji-alur.js`: alur surat, disposisi, dashboard, dan fixture demo.
- `uji-pengguna.js`: manajemen akun dan kendali izin.
- `uji-auth-audit.js`: regresi autentikasi dan audit.

## Rute dasar

| Metode | Rute | Akses |
|---|---|---|
| GET | `/api/health` | publik |
| POST | `/api/auth/login` | publik |
| GET | `/api/auth/izin-saya` | login |

Rute lain mengikuti modul surat masuk, surat keluar, disposisi,
katalog, dan manajemen user. Pemeriksaan akses dilakukan di server
sesuai peran dan lingkup.
