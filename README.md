# Batavia

Sistem arsip digital sekolah (surat masuk, surat keluar, disposisi).
Dibangun untuk mata kuliah Pengelolaan Proyek Perangkat Lunak,
Universitas Gunadarma.

Status: versi lab/demo. Bukan produksi. Semua data sintetis, kedua
server hanya mendengarkan di loopback (`127.0.0.1`).

## Stack

- Backend: Node.js, Express 4, Prisma 6, SQLite (file lokal).
- Frontend: React 18, React Router 7, Vite 6, Tailwind CSS 3.
- Node.js versi terpatch: 22.23.4+, 24.22.1+, atau 26.12.1+.
  Versi lain ditolak otomatis oleh runner.

## Peta direktori (yang disertakan dalam repositori)

```
Batavia/
├── README.md                      Berkas ini
├── docs/
│   ├── PANDUAN-MENJALANKAN-LAB.md Setup dan menjalankan lab
│   └── PANDUAN-GIT.md             Langkah commit dan push manual
├── scripts/                       Runner lab (lab.cjs, jalankan-lab.cmd)
├── backend-lab/                   Backend lab (Express + Prisma + SQLite)
│   ├── prisma/                    Skema dan migrasi
│   ├── scripts/                   Seed dan suite uji
│   ├── src/                       Kode sumber
│   ├── .env.contoh                Template env (salin menjadi .env)
│   └── package-lock.json          Lockfile untuk npm ci
└── frontend-lab/                  Frontend lab (React + Vite)
    ├── src/                       Kode sumber
    ├── .env.contoh                Opsional, biasanya tidak perlu dibuat
    └── package-lock.json          Lockfile untuk npm ci
```

File `.env` asli, database `dev.db`, dan `node_modules/` sengaja tidak
ikut Git lewat `.gitignore`.

## Setup ringkas

Detail: [Panduan menjalankan lab](docs/PANDUAN-MENJALANKAN-LAB.md).
Perintah berikut memakai Command Prompt Windows, dari root `Batavia`.

1. Pasang Node.js terpatch sesuai daftar di atas. Periksa `node -v` dan `npm -v`.
2. `cd backend-lab`, lalu `npm ci`. Hanya jika `.env` belum ada, jalankan
   `if not exist .env copy .env.contoh .env`. Isi `JWT_SECRET` dari perintah
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   Konfigurasi minimal `backend-lab/.env`:

   ```dotenv
   MODE=lab
   PORT=6080
   DATABASE_URL="file:./dev.db"
   JWT_SECRET=<tempel nilai acak dari perintah di atas>
   ```

   SQLite menyimpan data di `backend-lab/prisma/dev.db`. Jangan commit `.env`.
3. `cd ..\frontend-lab`, lalu `npm ci`. Frontend tidak perlu `.env`; Vite
   meneruskan `/api` ke `127.0.0.1:6080`.
4. `cd ..`, lalu jalankan `scripts\jalankan-lab.cmd --check`,
   `scripts\jalankan-lab.cmd --prepare` dan `scripts\jalankan-lab.cmd --demo`.
   `--prepare` menerapkan migrasi yang ada dan mengisi katalog tanpa reset.
5. `scripts\jalankan-lab.cmd`, lalu buka `http://127.0.0.1:5173`.
   Tekan Ctrl+C untuk berhenti.

Uji lokal: `scripts\jalankan-lab.cmd --test` (database dan port uji
terpisah, tidak perlu `.env` atau akun demo; Prisma Client perlu dibangkitkan).

## Akun demo

Dibuat oleh `--demo`. Sandi bawaan untuk **akun baru**: `DemoBatavia123!`,
khusus data sintetis di lab loopback. Form login tidak mengisi sandi.
Untuk memilih sandi demo sendiri, atur `DEMO_PASSWORD` (minimal 12 karakter)
di `.env` backend atau environment sebelum seed pertama.

| Email | Peran / lingkup |
|---|---|
| `pengelola@contoh.batavia.invalid` | Superadmin jika belum ada Superadmin aktif |
| `dewi.lestari.tu@contoh.batavia.invalid` | Tata Usaha |
| `randy.septo.anggara@contoh.batavia.invalid` | Kepala Sekolah |
| `kepala.<singkatan-unit>@contoh.batavia.invalid` | Satu Kepala Bagian per unit aktif |
| `staf.<singkatan-unit>.<nomor>@contoh.batavia.invalid` | Guru/Staf, minimal dua orang per unit |

`--demo` menambah 50 surat masuk dan 50 keluar sebagai data uji. Menjalankan ulang tidak menimpa data, akun, atau sandi yang sudah ada. Gunakan DB kosong jika ingin tepat 100 surat. TU, Kepala Bagian, dan Guru/Staf wajib berunit. Kepala Sekolah dan Superadmin boleh tanpa unit.

## Fitur dan batas

Sudah ada:
- Sidebar berkelompok, dashboard berisi data sesuai lingkup peran,
  tabel search/filter/pagination, drawer mobile.
- Katalog Jenis Surat/Jenis Arsip: tambah, ubah, nonaktif, grant/revoke
  hak tulis oleh Superadmin.
- Surat masuk: input metadata, nomor registrasi otomatis, lampiran
  privat PDF/PNG/JPG, telaah pimpinan, disposisi ke unit, penerusan ke
  staf, tindak lanjut.
- Surat keluar: draft, permintaan persetujuan, persetujuan pimpinan,
  kirim, arsip.
- Manajemen user: tambah/ubah/nonaktif, kendali izin tiga keadaan,
  aktivitas sistem. Pemeriksaan akses dilakukan di server.

Belum ada:
- Laporan unduhan PDF/XLSX, notifikasi push/email, 2FA.
- Edit metadata surat lengkap di UI.
- Versi produksi dan deploy. Rantai audit belum concurrency-safe.

Ini bukan klaim siap produksi.

## Panduan lain

- Menjalankan lab: `docs/PANDUAN-MENJALANKAN-LAB.md`
- Commit dan push manual ke GitHub: `docs/PANDUAN-GIT.md`
- Detail backend: `backend-lab/README.md`
- Detail frontend: `frontend-lab/README.md`
- Runner: `scripts/README.md`
