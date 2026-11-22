const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const multer = require('multer');
const prisma = require('../config/database');
const authenticate = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const { AppError } = require('../middleware/errorHandler');
const alur = require('../services/alur.service');
const { bolehkah } = require('../services/izin.service');
const router = express.Router();
router.use(authenticate);
const run = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

router.get('/referensi', run(async (req, res) => ok(res, await alur.referensi(req.user))));
router.get('/dashboard', run(async (req, res) => ok(res, await alur.dashboard(req.user))));
for (const [slug, jenis] of [['surat-masuk', 'masuk'], ['surat-keluar', 'keluar']]) {
  const resource = `surat_${jenis}`;
  router.get(`/${slug}`, requirePermission(resource, 'read'), run(async (req, res) => res.json({ success: true, ...await alur.listSurat(req.user, jenis, req.query) })));
  router.get(`/${slug}/:id`, requirePermission(resource, 'read'), run(async (req, res) => ok(res, await alur.detailSurat(req.user, jenis, req.params.id))));
  router.post(`/${slug}`, requirePermission(resource, 'create'), run(async (req, res) => {
    const data = await alur.createSurat(req.user, jenis, req.body); alur.audit(req, 'create', resource, data); ok(res, data, 201);
  }));
  router.patch(`/${slug}/:id`, requirePermission(resource, 'update'), run(async (req, res) => {
    const data = await alur.patchSurat(req.user, jenis, req.params.id, req.body); alur.audit(req, 'update', resource, data); ok(res, data);
  }));
}
router.get('/disposisi', requirePermission('disposisi', 'read'), run(async (req, res) => res.json({ success: true, ...await alur.listDisposisi(req.user, req.query) })));
router.get('/disposisi/:id', requirePermission('disposisi', 'read'), run(async (req, res) => ok(res, await alur.findDisposisi(req.user, req.params.id))));
router.post('/disposisi', requirePermission('disposisi', 'create'), run(async (req, res) => {
  const data = await alur.createDisposisi(req.user, req.body); alur.audit(req, 'create', 'disposisi', data); ok(res, data, 201);
}));
router.patch('/disposisi/:id', requirePermission('disposisi', 'update'), run(async (req, res) => {
  const data = await alur.patchDisposisi(req.user, req.params.id, req.body); alur.audit(req, 'update', 'disposisi', data); ok(res, data);
}));

// Memory is bounded per request; no unverified bytes reach private storage.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 } }).single('file');
const privateDir = () => path.resolve(process.env.PRIVATE_STORAGE_DIR || path.join(__dirname, '../../storage-private'));
function jenisSurat(value) {
  const jenis = { masuk: 'masuk', keluar: 'keluar', surat_masuk: 'masuk', surat_keluar: 'keluar' }[value];
  if (!jenis) throw new AppError(404, 'Jenis lampiran tidak ditemukan.');
  return jenis;
}
function signature(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) return { ext: 'pdf', mime: 'application/pdf' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { ext: 'png', mime: 'image/png' };
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { ext: 'jpg', mime: 'image/jpeg' };
  throw new AppError(400, 'Berkas harus PDF, PNG atau JPG dengan signature yang valid.');
}
const attachmentSelect = { id: true, nama_asli: true, mime: true, ukuran_byte: true, created_at: true, entitas_jenis: true, entitas_id: true };
router.post('/lampiran/:jenis/:id', requirePermission('lampiran', 'create'), run(async (req, res) => {
  const jenis = jenisSurat(req.params.jenis);
  await alur.permission(req.user, `surat_${jenis}`, 'update');
  await alur.permission(req.user, `surat_${jenis}`, 'read');
  const row = await alur.findSurat(req.user, jenis, req.params.id);
  if (!['superadmin', 'tata_usaha'].includes(req.user.peran)) throw new AppError(403, 'Unggah surat hanya untuk Tata Usaha atau Superadmin.');
  if (row.status === 'diarsipkan' || (jenis === 'keluar' && row.status !== 'draft')) throw new AppError(409, 'Lampiran tidak dapat diubah pada tahap ini.');
  await new Promise((resolve, reject) => upload(req, res, (err) => {
    if (err) reject(new AppError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran berkas maksimal 10 MB.' : 'Unggah tepat satu berkas pada field file.'));
    else resolve();
  }));
  if (!req.file) throw new AppError(400, 'Berkas file wajib diisi.');
  const format = signature(req.file.buffer);
  const name = path.basename(req.file.originalname.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || `scan.${format.ext}`;
  const stored = `${randomUUID()}.${format.ext}`;
  const dir = privateDir(); const destination = path.join(dir, stored);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(destination, req.file.buffer, { flag: 'wx', mode: 0o600 });
    const data = await prisma.lampiran.create({ data: { entitas_jenis: `surat_${jenis}`, entitas_id: row.id, nama_asli: name, path_relatif: stored, mime: format.mime, ukuran_byte: req.file.size, diupload_oleh: req.user.id, sha256: createHash('sha256').update(req.file.buffer).digest('hex') }, select: attachmentSelect });
    alur.audit(req, 'upload', req.params.jenis, row); ok(res, data, 201);
  } catch (error) { await fs.unlink(destination).catch(() => {}); throw error; }
}));
router.get('/lampiran/:id', requirePermission('lampiran', 'read'), run(async (req, res) => {
  const file = await prisma.lampiran.findFirst({ where: { id: req.params.id, deleted_at: null } });
  if (!file) throw new AppError(404, 'Lampiran tidak ditemukan.');
  const jenis = jenisSurat(file.entitas_jenis);
  const canReadSurat = await bolehkah(prisma, req.user, `surat_${jenis}`, 'read');
  if (!canReadSurat) {
    const canDisposisi = await bolehkah(prisma, req.user, 'disposisi', 'read');
    if (!canDisposisi) throw new AppError(403, 'Izin untuk operasi ini tidak aktif. Hubungi Superadmin.');
  }
  await alur.findSurat(req.user, jenis, file.entitas_id);
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(file.path_relatif)) throw new AppError(404, 'Lampiran tidak ditemukan.');
  const destination = path.join(privateDir(), file.path_relatif);
  try { await fs.access(destination); } catch { throw new AppError(404, 'Berkas lampiran tidak ditemukan.'); }
  res.set({ 'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  await new Promise((resolve, reject) => res.download(destination, file.nama_asli, (err) => err ? reject(err) : resolve()));
}));
module.exports = router;
