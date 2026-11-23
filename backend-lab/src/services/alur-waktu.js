const { AppError } = require('../middleware/errorHandler');

const DAY = 86400000;
const JAKARTA = 7 * 3600000;
// Tanggal surat dan tenggat disimpan sebagai tanggal kalender pada UTC midnight,
// bukan instan Jakarta. Gunakan tanggal Jakarta untuk memilih batas kalender.
function hariJakarta(now = new Date()) {
  const shifted = new Date(now.getTime() + JAKARTA);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted;
}

function deadlineWhere(mode, today) {
  const lewat = { lt: today };
  const dekat = { gte: today, lt: new Date(today.getTime() + 4 * DAY) };
  if (mode === 'lewat') return { deadline: lewat };
  if (mode === 'dekat') return { deadline: dekat };
  if (mode === 'aktif') return { OR: [{ deadline: lewat }, { deadline: dekat }] };
  throw new AppError(400, 'Filter tenggat tidak valid.');
}

function timeline(periode, today) {
  const monthly = periode === 'tahun';
  const steps = { minggu: 7, bulan: 30, tahun: 12 };
  if (!Object.hasOwn(steps, periode) || typeof periode !== 'string')
    throw new AppError(400, 'Periode tidak valid.');
  const count = steps[periode];
  const start = new Date(today);
  if (monthly) start.setUTCMonth(start.getUTCMonth() - count + 1, 1);
  else start.setUTCDate(start.getUTCDate() - count + 1);
  const buckets = new Map();
  const key = (d) => monthly ? `${d.toISOString().slice(0, 7)}-01` : d.toISOString().slice(0, 10);
  for (let i = 0; i < count; i++) {
    const date = new Date(start);
    if (monthly) date.setUTCMonth(date.getUTCMonth() + i);
    else date.setUTCDate(date.getUTCDate() + i);
    buckets.set(key(date), { tanggal: key(date), masuk: 0, keluar: 0 });
  }
  const end = new Date(today.getTime() + DAY);
  return { range: { gte: start, lt: end }, buckets, key };
}

module.exports = { hariJakarta, deadlineWhere, timeline };
