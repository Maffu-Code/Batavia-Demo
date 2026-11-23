/**
 * Routes katalog: /api/katalog/:jenis
 *
 * Setiap aksi mengikuti matriks izin. Superadmin dapat memberikan atau
 * mencabut hak tulis tanpa mengganti route; scope surat tetap terpisah.
 */
const express = require('express');
const authenticate = require('../middleware/authenticate');
const { logActivity } = require('../middleware/logActivity');
const katalog = require('../services/katalog.service');
const { AppError } = require('../middleware/errorHandler');
const requirePermission = require('../middleware/requirePermission');

const router = express.Router();

router.use(authenticate);

function izinKatalog(action) {
  return (req, res, next) => {
    try {
      const def = katalog.pastikanJenis(req.params.jenis);
      if (req.user.peran !== 'superadmin') {
        if (action === 'delete') return next(new AppError(403, 'Hanya Superadmin dapat menghapus katalog.'));
        if (def.superadmin && action !== 'read') return next(new AppError(403, 'Hanya Superadmin dapat mengelola Unit Kerja.'));
      }
      return requirePermission(def.resource, action)(req, res, next);
    } catch (e) { next(e); }
  };
}

router.get('/:jenis', izinKatalog('read'), async (req, res, next) => {
  try {
    katalog.pastikanJenis(req.params.jenis);
    const aktifSaja = String(req.query.aktif || '') === '1';
    const data = await katalog.daftar(req.params.jenis, { aktifSaja });
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

router.post(
  '/:jenis',
  izinKatalog('create'),
  logActivity('create', 'katalog'),
  async (req, res, next) => {
    try {
      const def = katalog.pastikanJenis(req.params.jenis);
      const dibuat = await katalog.buat(req.params.jenis, req.body || {});
      res.locals.entitas_id = dibuat.id;
      res.locals.detail = `Menambah ${def.label} "${dibuat.nama}" (kode ${dibuat.kode}).`;
      res.status(201).json({ success: true, data: dibuat });
    } catch (e) { next(e); }
  }
);

router.patch(
  '/:jenis/:id',
  izinKatalog('update'),
  logActivity('update', 'katalog'),
  async (req, res, next) => {
    try {
      const def = katalog.pastikanJenis(req.params.jenis);
      const diubah = await katalog.ubah(req.params.jenis, req.params.id, req.body || {});
      res.locals.entitas_id = diubah.id;
      res.locals.detail = `Mengubah ${def.label} "${diubah.nama}" (kode ${diubah.kode}).`;
      res.json({ success: true, data: diubah });
    } catch (e) { next(e); }
  }
);

router.delete(
  '/:jenis/:id',
  izinKatalog('read'),
  izinKatalog('delete'),
  logActivity('delete', 'katalog'),
  async (req, res, next) => {
    try {
      const dihapus = await katalog.hapus(req.params.jenis, req.params.id, req.body);
      res.locals.entitas_id = dihapus.id;
      res.locals.detail = `Menghapus katalog ${req.params.jenis} "${dihapus.nama}" (ID ${dihapus.id}).`;
      res.json({ success: true, data: { id: dihapus.id } });
    } catch (e) { next(e); }
  }
);

module.exports = router;
