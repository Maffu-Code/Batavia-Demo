/**
 * Auth: login + izin-saya.
 *
 * Login:
 *   POST /api/auth/login { email, password }
 *   -> 200 { success, data: { token, user: { id, nama, peran, bagian_id } } }
 *   -> 401 (pesan generik) kalau gagal
 *
 *   Rate limit lab: 5 percobaan / 15 menit per (IP + email) secara default.
 *   Batas tambahan per email lintas IP: 3× batas itu, tanpa menghitung 2xx.
 *   Batas lintas IP ini juga bisa menahan login sah sampai jendela berakhir.
 *
 *   Setiap login_sukses dan login_gagal dicatat di activity_logs (lewat
 *   logAudit). Login gagal termasuk email yang dicoba (untuk forensik),
 *   TAPI response ke client tetap generik supaya tidak membocorkan
 *   enumerasi akun.
 *
 * Izin-saya:
 *   GET /api/auth/izin-saya
 *   -> 200 { success, data: { peran, bisa_hapus, izin: {<matriks lengkap>} } }
 *   Polled oleh client tiap 60 detik + visibilitychange + focus.
 */
const { randomBytes } = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const prisma = require('../config/database');
const env = require('../config/env');
const authenticate = require('../middleware/authenticate');
const { AppError } = require('../middleware/errorHandler');
const { logAudit } = require('../middleware/logActivity');
const { izinEfektif } = require('../services/izin.service');

const router = express.Router();
const LOGIN_LIMIT_OPTIONS = {
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' },
};
const normalizedEmail = (email) => email.trim().toLowerCase();

const loginLimiter = rateLimit({
  ...LOGIN_LIMIT_OPTIONS,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  identifier: 'login-source-email',
  keyGenerator: (req) => {
    const raw = req.body?.email;
    const email = typeof raw === 'string' ? normalizedEmail(raw) : '';
    return `${ipKeyGenerator(req.ip)}::${email.length <= 254 ? email : ''}`;
  },
});

const emailLimiter = rateLimit({
  ...LOGIN_LIMIT_OPTIONS,
  limit: 3 * env.LOGIN_RATE_LIMIT_MAX,
  identifier: 'login-email',
  skipSuccessfulRequests: true,
  skip: (req) => !validationResult(req).isEmpty(),
  keyGenerator: (req) => normalizedEmail(req.body.email),
});

// Pesan sengaja identik untuk "akun tidak ada" vs "password salah".
// Jangan ubah -- membocorkan eksistensi akun = kemudahan brute force.
const PESAN_GAGAL = 'Email atau password salah.';
// Akun tidak ada/nonaktif tetap menjalankan bcrypt cost 12 seperti akun aktif.
const DUMMY_HASH = bcrypt.hash(randomBytes(32).toString('hex'), 12);

router.post(
  '/login',
  loginLimiter,
  // JANGAN pakai normalizeEmail: ia merampas titik Gmail, membuang +tag,
  // dan dapat memisahkan antara apa yang tersimpan di DB saat register
  // dengan apa yang dilookup saat login. Yang cukup: trim + lowercase.
  body('email').isString().bail().trim().isEmail().withMessage('Email tidak valid.'),
  body('password').isString().isLength({ min: 1 }).withMessage('Password wajib.'),
  emailLimiter,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError(400, errors.array().map((e) => e.msg).join(' '));
      }

      const { email: emailAsli, password } = req.body;
      const email = normalizedEmail(emailAsli);
      const dummyHash = await DUMMY_HASH;
      const user = await prisma.user.findUnique({ where: { email } });
      const bisaLogin = Boolean(user && !user.deleted_at && user.aktif);
      const cocok = await bcrypt.compare(password, bisaLogin ? user.password_hash : dummyHash);

      // Login gagal -> catat (email yang dicoba + IP), tetap balas generik.
      if (!bisaLogin) {
        await logAudit({
          user: null,
          aksi: 'login_gagal',
          entitas: 'user',
          emailJikaGagalLogin: emailAsli,
          req,
        });
        throw new AppError(401, PESAN_GAGAL);
      }

      if (!cocok) {
        await logAudit({
          user: null,
          aksi: 'login_gagal',
          entitas: 'user',
          entitasId: user.id,
          detail: `Password salah untuk akun "${user.email}".`,
          req,
        });
        throw new AppError(401, PESAN_GAGAL);
      }

      const token = jwt.sign(
        { sub: user.id, peran: user.peran },
        env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN }
      );

      await logAudit({
        user: { id: user.id, nama: user.nama_lengkap },
        aksi: 'login_sukses',
        entitas: 'user',
        entitasId: user.id,
        detail: `Login berhasil (${user.email}).`,
        req,
      });

      res.json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            nama: user.nama_lengkap,
            peran: user.peran,
            bagian_id: user.bagian_id,
            bisa_hapus: user.bisa_hapus,
          },
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

router.get('/izin-saya', authenticate, async (req, res, next) => {
  try {
    const matriks = await izinEfektif(prisma, req.user);
    res.json({
      success: true,
      data: {
        user: req.user,
        peran: req.user.peran,
        bisa_hapus: req.user.bisa_hapus,
        izin: matriks,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
