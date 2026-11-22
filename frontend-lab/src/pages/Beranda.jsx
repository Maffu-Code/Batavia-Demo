import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Badge, Icon, Notice, PageHeader, tanggal, label, pesanError } from '../components/Ui.jsx';

export default function Beranda() {
  const { user, boleh, izin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ulang, setUlang] = useState(0);
  useEffect(() => {
    let active = true;
    setError(''); setData(null);
    api.get('/dashboard').then((r) => { if (active) setData(r.data.data); }).catch((e) => { if (active) setError(pesanError(e)); });
    return () => { active = false; };
  }, [ulang, user.id, user.peran, user.bagian_id, izin]);
  const namaBersih = user.nama?.replace(/^\[SINTETIS\]\s*/, '') || 'Pengguna';
  const scope = ['superadmin', 'kepala_sekolah', 'tata_usaha'].includes(user.peran) ? 'Ringkasan sekolah' : user.peran === 'kepala_bagian' ? 'Ringkasan unit kerja' : 'Ruang tugas Anda';
  const staf = user.peran === 'guru_staf';
  const metrics = [
    [staf ? 'Surat terkait tugas' : 'Surat masuk', data?.ringkasan?.surat_masuk, 'masuk', '', 'Surat yang dapat Anda akses'],
    ['Surat keluar', data?.ringkasan?.surat_keluar, 'keluar', 'teal', 'Dokumen dalam lingkup Anda'],
    ['Disposisi aktif', data?.ringkasan?.disposisi_aktif, 'disposisi', '', 'Menunggu atau sedang ditindaklanjuti'],
    ['Lewat tenggat', data?.ringkasan?.terlambat, 'aktivitas', 'amber', 'Perlu perhatian dan tindak lanjut'],
  ].filter(([, , icon]) => (icon !== 'keluar' || (!staf && boleh('surat_keluar', 'read'))) && (icon !== 'masuk' || boleh('surat_masuk', 'read')));
  const max = Math.max(1, ...(data?.tren || []).flatMap((t) => [t.masuk, t.keluar]));
  const actions = [
    ['surat_masuk', 'create', '/surat/masuk', 'Catat surat masuk', 'Registrasi dan unggah hasil scan', 'masuk'],
    ['surat_keluar', 'create', '/surat/keluar', 'Buat surat keluar', 'Siapkan dokumen dan persetujuan', 'keluar'],
    ['disposisi', 'create', '/disposisi', 'Kelola disposisi', 'Berikan arahan atau penugasan', 'disposisi'],
    ['disposisi', 'read', '/disposisi', 'Tindak lanjut tugas', 'Perbarui status dan catatan', 'aktivitas'],
  ].filter(([r, a]) => boleh(r, a));
  return <>
    <PageHeader eyebrow={scope} title={`Selamat datang, ${namaBersih}`} description="Pantau persuratan, disposisi, dan pekerjaan yang membutuhkan perhatian Anda." action={<button className="button button-light" onClick={() => setUlang((n) => n + 1)}>Segarkan data</button>} />
    <Notice error>{error}</Notice>
    {!data && !error && <p role="status" className="empty-state">Memuat ringkasan...</p>}
    {data && <>
      <div className="metric-grid">{metrics.map(([title, value, icon, tone, hint]) => <section className="panel metric" key={title}><div><p>{title}</p><strong>{value ?? 0}</strong><small>{hint}</small></div><div className={`metric-icon ${tone}`}><Icon nama={icon} /></div></section>)}</div>
      <div className="dashboard-columns">
        <section className="panel"><div className="panel-heading"><div><h2>Aktivitas persuratan</h2><small>Jumlah dokumen per bulan sesuai lingkup Anda</small></div><div className="chart-legend"><span><i />Masuk</span><span><i className="teal" />Keluar</span></div></div><div className="chart" role="img" aria-label={`Tren: ${(data.tren || []).map((x) => `${x.bulan}: ${x.masuk} masuk, ${x.keluar} keluar`).join('; ')}`}>{(data.tren || []).map((t) => <div className="chart-column" key={t.bulan}><div className="chart-bars"><div className="chart-bar" style={{ height: `${t.masuk / max * 120}px` }}><span>{t.masuk}</span></div><div className="chart-bar outgoing" style={{ height: `${t.keluar / max * 120}px` }}><span>{t.keluar}</span></div></div><small>{t.bulan}</small></div>)}</div></section>
        <section className="panel"><div className="panel-heading"><h2>Akses cepat</h2><Icon nama="surat" /></div><div className="quick-actions">{actions.map(([r, a, to, title, hint, icon]) => <Link className="quick-action" key={`${r}-${a}`} to={to}><Icon nama={icon} /><span><strong>{title}</strong><small>{hint}</small></span></Link>)}{boleh('jenis_surat', 'read') && <Link className="quick-action" to="/katalog/surat"><Icon nama="katalog" /><span><strong>Katalog surat & arsip</strong><small>Kelola jenis dan daftar referensi</small></span></Link>}</div></section>
      </div>
      <div className="dashboard-columns">
        <section className="panel"><div className="panel-heading"><div><h2>Disposisi perlu perhatian</h2><small>Penugasan aktif menurut tenggat</small></div><Link className="text-button" to="/disposisi">Lihat semua</Link></div>{!data.prioritas?.length ? <p className="empty-state">Tidak ada disposisi aktif dalam lingkup Anda.</p> : <div className="table-scroll"><table><thead><tr><th>Perihal / instruksi</th><th>Tujuan</th><th>Tenggat</th><th>Status</th></tr></thead><tbody>{data.prioritas.map((d) => <tr key={d.id}><td><Link className="text-button" to="/disposisi">{d.surat_masuk?.perihal || d.instruksi}</Link><small>{d.surat_masuk?.nomor_registrasi}</small></td><td>{d.ke_bagian?.nama || '-'}<small>{d.ke_user?.nama_lengkap || ''}</small></td><td>{tanggal(d.deadline)}</td><td><Badge value={d.status} /></td></tr>)}</tbody></table></div>}</section>
        <section className="panel"><div className="panel-heading"><h2>Aktivitas terbaru</h2><Icon nama="aktivitas" /></div>{!data.aktivitas?.length ? <p className="empty-state">Belum ada aktivitas dalam lingkup Anda.</p> : <ul className="activity-list">{data.aktivitas.map((a) => <li key={a.id}><Icon nama="aktivitas" /><div><p>{a.nama_user || 'Sistem'} · {label(a.aksi)}</p><small>{label(a.entitas)} · {tanggal(a.created_at)}</small></div></li>)}</ul>}</section>
      </div>
    </>}
  </>;
}
