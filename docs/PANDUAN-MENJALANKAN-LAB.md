# Panduan Menjalankan Versi Lab Batavia

Dokumen ini untuk anggota tim developer (mahasiswa) yang baru melakukan
clone repositori `Batavia` dari GitHub dan belum pernah menjalankannya
di komputer sendiri. [README root](../README.md) menjadi rujukan utama
konfigurasi lokal, versi Node, dan akun demo.
Sistem operasi acuan: Windows 11. Semua perintah memakai Command
Prompt; tidak perlu alat tambahan apa pun selain Node.js, npm, dan Git.

## 1. Ringkasan

Batavia adalah sistem arsip digital sekolah (surat masuk, surat keluar,
disposisi) yang sedang dikembangkan untuk mata kuliah Pengelolaan Proyek
Perangkat Lunak, Universitas Gunadarma.

Folder `backend-lab/` dan `frontend-lab/` adalah versi test atau lab:
backend Node.js dan Express dengan database SQLite lokal, frontend React
dan Vite yang memanggil backend tersebut. Versi ini BUKAN produksi.
Jangan hubungkan ke jaringan sekolah, jangan isi data siswa atau staf
nyata. Semua data di dalamnya sintetis, hanya untuk demo dan pengujian.

Folder `backend/` dan `frontend/` (versi produksi) belum dibuat.

## 2. Prasyarat

1. Windows 11.
2. Node.js versi terpatch, salah satu dari:
   - 22.23.4 atau lebih baru di cabang 22
   - 24.22.1 atau lebih baru di cabang 24
   - 26.12.1 atau lebih baru di cabang 26

   Versi Node di luar daftar ini akan DITOLAK otomatis oleh runner lab
   (`scripts/lab.cjs`). Cek versi yang terpasang dengan:

   ```
   node --version
   ```

   Catatan: Node portabel di folder `.runtime/` TIDAK ikut Git dan
   tidak disyaratkan. Pengguna clone memasang Node terpatch sendiri
   dari https://nodejs.org lalu cek dengan `node --version`. Bila suatu
   mesin lokal kebetulan punya `.runtime/node-v22.23.4-win-x64/`,
   jalankan-lab.cmd otomatis memakainya, tapi itu opsional.
3. Browser modern (Chrome, Edge, atau Firefox versi terbaru) untuk
   membuka antarmuka di `http://127.0.0.1:5173`.
4. Koneksi internet saat setup pertama kali, untuk mengunduh paket lewat
   `npm ci`.

## 3. Setup Pertama Kali di Mesin Baru

Clone repositori terlebih dahulu bila belum:

```
git clone https://github.com/Maffu-Code/Batavia-Demo.git Batavia
cd Batavia
```

Jalankan langkah berikut secara berurutan dari folder root `Batavia`.
Contoh perintah memakai Command Prompt (cmd.exe). Bila memakai PowerShell,
jalankan skrip sebagai `.\scripts\jalankan-lab.cmd`.

1. Masuk ke folder backend, salin file contoh env, lalu edit:

   ```
   cd backend-lab
   if not exist .env copy .env.contoh .env
   ```

   Buka `backend-lab/.env` dengan editor teks. Isi atau periksa variabel
   berikut (lihat `backend-lab/.env.contoh` untuk daftar lengkap dan
   penjelasan tiap variabel):
   - `MODE` harus `lab`, dan `PORT` harus `6080` agar cocok dengan proxy Vite.
   - `DATABASE_URL` harus `file:./dev.db` (path SQLite lokal, bukan
     database produksi).
   - `JWT_SECRET` wajib diganti dari nilai contoh. Bangkitkan nilai acak
     dengan perintah:

     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```

     Salin hasilnya ke `JWT_SECRET` di `.env`. Jangan pernah menulis nilai
     rahasia ini ke dokumen, chat, atau commit Git. File `.env` sudah
     masuk `.gitignore` di root proyek.

2. Install dependensi backend sesuai lockfile:

   ```
   npm ci
   ```

3. Masuk ke folder frontend lalu install dependensi sesuai lockfile:

   ```
   cd ..\frontend-lab
   npm ci
   ```

   Frontend TIDAK memerlukan file `.env`. Secara bawaan frontend memanggil
   `/api` dan Vite meneruskannya ke backend port 6080 (proxy). Jangan
   membuat `frontend-lab/.env` kecuali ada alasan khusus.

4. Kembali ke folder root, lalu jalankan pemeriksaan konfigurasi:

   ```
   cd ..
   scripts\jalankan-lab.cmd --check
   ```

   Harus menampilkan versi Node yang terpakai dan konfirmasi
   `MODE=lab; DB lokal; PORT=6080`. Perintah ini tidak membuka koneksi DB
   atau mengecek ketersediaan port. Kalau gagal, baca pesan error dan lihat bagian
   Pemecahan Masalah di bawah.

5. Siapkan katalog, lalu tambahkan contoh operasional dan akun demo:

   ```
   scripts\jalankan-lab.cmd --prepare
   scripts\jalankan-lab.cmd --demo
   ```

   `--prepare` menjalankan `prisma generate`, `prisma migrate deploy`, dan
   seed katalog. Jangan gunakan `prisma migrate dev` atau `prisma:reset`
   untuk setup biasa. SQLite `file:./dev.db` ada di `backend-lab/prisma/dev.db`.
   --demo menambah surat, disposisi, unit dan akun sintetis secara idempoten;
   tidak menghapus atau menimpa data yang sudah ada. Jalankan ulang tidak
   me-reset status pekerjaan. Keduanya hanya untuk MODE=lab dan SQLite.

## 4. Menjalankan Sehari-hari

Setelah setup pertama selesai, untuk menjalankan aplikasi cukup satu
perintah dari folder root `Batavia`:

```
scripts\jalankan-lab.cmd
```

Perintah ini menyalakan backend di port 6080 dan frontend di port 5173
sekaligus, keduanya hanya mendengarkan di loopback (`127.0.0.1`), tidak
terbuka ke jaringan.

Buka browser ke:

```
http://127.0.0.1:5173
```

Frontend memanggil backend lewat jalur `/api` menggunakan proxy Vite,
jadi tidak perlu membuka alamat backend secara terpisah untuk pemakaian
normal. Untuk memastikan backend hidup secara mandiri, Anda bisa membuka
`http://127.0.0.1:6080/api/health` dan harus melihat respons JSON dengan
`ok: true`.

Untuk berhenti, kembali ke jendela terminal tempat perintah dijalankan
dan tekan Ctrl+C. Kedua server (backend dan frontend) akan ditutup
bersamaan.

## 5. Akun Demo

Rujukan akun dan sandi: [README root: Akun demo](../README.md#akun-demo).
`npm run seed` di backend adalah alias `--demo`; keduanya tidak menimpa
akun, sandi, atau surat lama. Untuk mencoba alur, pilih surat berstatus
Diterima, tandai telah dibaca sebagai Kepala Sekolah, lalu pilih unit dan
satu atau beberapa penerima. Setiap penerima mendapat tugas sendiri. Contoh
penugasan dekat dan lewat tenggat tersedia saat baru di-seed; seed ulang
tidak menggeser tenggat yang sudah ada.

## 6. Menjalankan Uji

Dari folder root `Batavia`:

```
scripts\jalankan-lab.cmd --test
```

Alternatif dari `backend-lab`: `npm run uji`. Setelah `npm ci`, jalankan
`npm run prisma:generate` bila Prisma Client belum ada. Suite memakai DB
sementara dan port HTTP pilihan OS; tidak perlu `.env`, akun demo, atau
DB kerja. Lihat jumlah `pass` dan `fail` pada ringkasan Node.

## 7. Pemecahan Masalah

Port 6080 atau 5173 sudah terpakai
- Gejala: `scripts\jalankan-lab.cmd` berhenti dengan pesan
  port sudah dipakai, atau proses tidak kunjung menyala.
- Sebab: ada proses lain (sering kali sesi `npm run dev` sebelumnya yang
  belum ditutup) masih mendengarkan di port yang sama.
- Perbaikan: tutup jendela terminal yang menjalankan lab sebelumnya
  dengan Ctrl+C. Kalau masih terkunci, cari proses `node.exe` yang masih
  berjalan di Task Manager dan hentikan secara manual, lalu coba lagi.

Node versi lama ditolak
- Gejala: `scripts\jalankan-lab.cmd` berhenti dengan pesan "Gunakan Node
  terpatch 22.23.4+, 24.22.1+, atau 26.12.1+ pada cabang tersebut."
- Sebab: Node yang aktif di PATH bukan salah satu versi terpatch yang
  diizinkan (lihat bagian 2 Prasyarat).
- Perbaikan: pastikan folder `.runtime/node-v22.23.4-win-x64/` ada di
  root proyek (`jalankan-lab.cmd` otomatis memprioritaskan Node ini di
  PATH kalau tersedia), atau pasang Node versi terpatch yang sesuai
  secara manual dan cek ulang dengan `node --version`.

Login gagal atau error CORS di browser
- Gejala: form login di `http://127.0.0.1:5173` menampilkan error
  jaringan, atau console browser menunjukkan pesan terkait CORS atau
  origin ditolak.
- Sebab: frontend memanggil alamat backend yang salah karena ada
  `frontend-lab/.env` lama atau halaman dibuka dari origin yang tidak
  diizinkan. Untuk konfigurasi lab biasa, frontend cukup memakai proxy `/api`.
- Perbaikan: pastikan mengakses frontend lewat
  `http://127.0.0.1:5173` (bukan `localhost:5173` dicampur dengan
  `127.0.0.1` untuk backend secara manual), dan pastikan backend memang
  menyala (cek `http://127.0.0.1:6080/api/health`). Cek juga
  `http://127.0.0.1:5173/api/health` untuk memastikan proxy Vite bekerja.
  Origin loopback port 5173 otomatis diizinkan; tidak perlu mengedit `CORS_ORIGIN`.

Lupa membuat file `.env`
- Gejala: backend langsung keluar saat start dengan pesan
  "Variabel wajib belum terisi" atau "JWT_SECRET masih nilai contoh".
- Sebab: `backend-lab/.env` belum dibuat dari `.env.contoh`, atau
  `JWT_SECRET` belum diganti dari nilai contoh di berkas tersebut.
- Perbaikan: ulangi langkah 1 pada bagian 3 (Setup Pertama Kali): salin
  `.env.contoh` menjadi `.env`, lalu bangkitkan dan isi `JWT_SECRET`
  dengan perintah `node -e` yang sudah disebutkan.

Database terkunci atau error SQLite
- Gejala: operasi ke database gagal dengan pesan terkait database
  terkunci atau error dari Prisma saat menjalankan backend atau skrip
  seed secara bersamaan.
- Sebab: SQLite hanya mengizinkan satu proses menulis pada satu waktu.
  Ini biasanya terjadi kalau `npm run dev`, `npm run seed`, atau
  `npx prisma studio` dijalankan bersamaan dari jendela terminal yang
  berbeda terhadap file `dev.db` yang sama.
- Perbaikan: tutup semua proses lain yang mengakses `backend-lab/prisma/dev.db`
  (termasuk Prisma Studio), lalu ulangi perintah yang gagal satu per
  satu, tidak bersamaan.

## 8. Peringatan Keamanan

1. Jangan pernah mengisi data sekolah nyata (nama siswa, staf, surat
   asli) ke versi lab ini. Semua data di sini sintetis dan hanya untuk
   pengujian.
2. Jangan ubah pengaturan server supaya terbuka ke jaringan (misalnya
   mengganti `host` Vite menjadi `0.0.0.0` atau `true`). Versi lab
   sengaja dikunci hanya ke loopback (`127.0.0.1`) untuk mengurangi
   risiko keamanan dev server yang terbuka ke jaringan.
3. Jangan commit file `backend-lab/.env`, `frontend-lab/.env`, atau file
   database (`*.db`, `*.db-journal`, `*.db-shm`, `*.db-wal`) ke Git.
   File-file ini sudah masuk `.gitignore` di root proyek; jangan
   dipaksa ditambahkan.
4. Kode dibagikan lewat repositori Git di GitHub. Langkah commit dan
   push pertama dilakukan manual mengikuti `docs/PANDUAN-GIT.md`. Push
   berikutnya juga manual oleh masing-masing anggota tim; tidak ada
   sinkronisasi atau CI otomatis.

## 9. Status Fitur Saat Ini dan Rujukan Dokumen Lain

Status 1 November 2026:
- Sidebar Midas, dashboard scoped sekolah/unit/penugasan, tabel
  search/filter/pagination/scroll dan drawer mobile.
- Katalog tambah/ubah/nonaktif; hak tulis dapat di-grant/revoke Superadmin.
- Input surat masuk, nomor registrasi otomatis, lampiran PDF/PNG/JPG privat.
- Telaah pimpinan, disposisi ke unit, penerusan ke staf, catatan tindak lanjut.
- Surat keluar: draft, menunggu tanda tangan, disetujui, terkirim, diarsipkan.
- Akun: tambah/ubah/nonaktif, peran/unit, kendali izin tiga keadaan, aktivitas.
- Belum: laporan unduhan PDF/XLSX, push/email, 2FA, produksi dan deploy.
- Audit belum concurrency-safe atau anti-rusak; bukan klaim siap produksi.

Rujukan dokumen lain (semuanya ikut tercommit di repositori):
- `README.md` di root proyek: ringkasan proyek, stack, dan peta direktori.
- `docs/PANDUAN-GIT.md`: langkah commit dan push manual ke GitHub.
- `backend-lab/README.md`: detail skrip backend, akun demo, dan uji.
- `frontend-lab/README.md`: detail frontend.
- `scripts/README.md`: penjelasan runner lab.
