import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Badge, Icon, Notice, PageHeader, tanggal, tanggalWaktu, label, pesanError } from '../components/Ui.jsx';

const PERIODE = { minggu: '1 minggu', bulan: '1 bulan', tahun: '1 tahun' };

function GrafikSurat({ data, periode, onPeriode, masuk, keluar, loading }) {
  const id = useId();
  const [aktif, setAktif] = useState(null);
  const [fokus, setFokus] = useState(0);
  const series = [[masuk, 'masuk', 'Masuk', 'timeline-in'], [keluar, 'keluar', 'Keluar', 'timeline-out']].filter(([enabled]) => enabled);
  const pts = data?.filter((r) => r.tanggal) || [];
  const pad = { x: 42, y: 12 };
  const lebar = Math.max(560, pts.length * (periode === 'tahun' ? 88 : 62) + 80), dasar = 184;
  const step = Math.max(1, Math.ceil(Math.max(0, ...pts.flatMap((t) => series.map(([, k]) => t[k] || 0))) / 4));
  const x = (i) => pad.x + (pts.length <= 1 ? .5 : i / (pts.length - 1)) * (lebar - pad.x - 37);
  const y = (n) => dasar - (Number(n) || 0) * (dasar - pad.y) / (step * 4);
  const fmt = (v, full = false) => new Date(v.length === 7 ? `${v}-01` : v).toLocaleDateString('id-ID', { ...(periode === 'tahun' ? {} : { day: 'numeric' }), month: full ? 'long' : 'short', ...(full || periode === 'tahun' ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  const dipilih = pts.find((r) => r.tanggal === aktif);
  const indexAktif = pts.indexOf(dipilih);
  const keterangan = (r) => `${fmt(r.tanggal, true)}. ${series.map(([, k, title]) => `${title}: ${r[k] ?? 0} surat`).join('. ')}`;
  useEffect(() => { setAktif(null); setFokus(0); }, [data, periode, masuk, keluar]);
  function keyboard(e, i) {
    if (e.key === 'Escape') { e.preventDefault(); setAktif(null); return; }
    if (['Enter', ' '].includes(e.key)) { e.preventDefault(); setAktif(pts[i].tanggal); return; }
    const next = ({ ArrowRight: Math.min(i + 1, pts.length - 1), ArrowLeft: Math.max(i - 1, 0), Home: 0, End: pts.length - 1 })[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = e.currentTarget.ownerSVGElement.querySelectorAll('.timeline-hit')[next];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  return <section className="panel" aria-busy={loading}>
    <div className="panel-heading timeline-heading"><div><h2>Aktivitas persuratan</h2><small>Jumlah surat dalam lingkup akses Anda</small></div><label className="table-limit">Periode<select value={periode} onChange={(e) => onPeriode(e.target.value)}>{Object.entries(PERIODE).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label></div>
    {!pts.length ? <p className="empty-state" role={loading ? 'status' : undefined}>{loading ? 'Memuat aktivitas persuratan...' : 'Belum ada data aktivitas untuk periode ini.'}</p> : <div className="timeline-body" onPointerLeave={(e) => { if (e.pointerType !== 'touch' && !e.currentTarget.contains(document.activeElement)) setAktif(null); }}>
      <div className="timeline-legend">{series.map(([, k, title, tone]) => <span key={k} className={tone}>{title}</span>)}</div>
      <p className="timeline-help" id={`${id}-help`}>Arahkan penunjuk atau ketuk tanggal. Gunakan panah kiri/kanan saat grafik berfokus, atau gulir untuk melihat semua tanggal.</p>
      <div className="timeline-scroll">
        <svg className="timeline-chart" style={{ minWidth: lebar }} viewBox={`0 0 ${lebar} 228`} preserveAspectRatio="none" role="group" aria-label={`Grafik jumlah surat selama ${PERIODE[periode]}; sumbu Y jumlah surat, sumbu X tanggal.`} aria-describedby={`${id}-help`}>
          {[0, 1, 2, 3, 4].map((i) => <g key={i}><line className="timeline-grid" x1={pad.x} x2={lebar - 37} y1={y(i * step)} y2={y(i * step)} /><text x={pad.x - 8} y={y(i * step) + 4} textAnchor="end">{i * step}</text></g>)}
          {pts.map((r, i) => <text key={r.tanggal} x={x(i)} y={211} textAnchor="middle">{fmt(r.tanggal)}</text>)}
          {series.map(([, k, , tone]) => <g key={k} aria-hidden="true"><polyline className={`timeline-series ${tone}`} points={pts.map((r, i) => `${x(i)},${y(r[k])}`).join(' ')} />{pts.map((r, i) => <circle key={r.tanggal} className={`timeline-dot ${tone}`} cx={x(i)} cy={y(r[k])} r={k === 'keluar' ? 4.5 : 2.8} />)}</g>)}
          {dipilih && <line className="timeline-cursor" x1={x(indexAktif)} x2={x(indexAktif)} y1={pad.y} y2={dasar} aria-hidden="true" />}
          {pts.map((r, i) => {
            const left = i === 0 ? pad.x - 24 : (x(i - 1) + x(i)) / 2;
            const right = i === pts.length - 1 ? lebar - 13 : (x(i) + x(i + 1)) / 2;
            return <rect key={r.tanggal} className="timeline-hit" x={left} y={pad.y} width={right - left} height={211} role="button" tabIndex={i === Math.min(fokus, pts.length - 1) ? 0 : -1} aria-label={keterangan(r)} aria-describedby={dipilih?.tanggal === r.tanggal ? `${id}-tooltip` : undefined} onPointerEnter={() => setAktif(r.tanggal)} onClick={() => setAktif(r.tanggal)} onFocus={() => { setFokus(i); setAktif(r.tanggal); }} onBlur={(e) => { if (!e.currentTarget.ownerSVGElement.contains(e.relatedTarget)) setAktif(null); }} onKeyDown={(e) => keyboard(e, i)} />;
          })}
        </svg>
      </div>
      <div className="timeline-inspector" aria-live="polite" aria-atomic="true">{dipilih ? <div id={`${id}-tooltip`} role="tooltip" className="timeline-tooltip"><strong>{fmt(dipilih.tanggal, true)}</strong><div>{series.map(([, k, title, tone]) => <span className={tone} key={k}>{title}: <b>{dipilih[k] ?? 0}</b> surat</span>)}</div></div> : <span className="timeline-help">Pilih tanggal pada grafik untuk melihat rinciannya.</span>}</div>
      <details className="timeline-data"><summary className="text-button">Tabel data grafik</summary><div className="table-scroll"><table><thead><tr><th scope="col">Tanggal</th>{series.map(([, k, title]) => <th key={k} scope="col">{title}</th>)}</tr></thead><tbody>{pts.map((r) => <tr key={r.tanggal}><td>{periode === 'tahun' ? fmt(r.tanggal, true) : tanggal(r.tanggal)}</td>{series.map(([, k]) => <td key={k}>{r[k] ?? 0}</td>)}</tr>)}</tbody></table></div></details>
    </div>}
  </section>;
}

export default function Beranda() {
  const { user, boleh } = useAuth();
  const dapatMasuk = boleh('surat_masuk', 'read');
  const dapatKeluar = boleh('surat_keluar', 'read');
  const dapatTugas = boleh('disposisi', 'read');
  const [periode, setPeriode] = useState('minggu');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ulang, setUlang] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setLoading(true); setData(null);
    api.get('/dashboard', { params: { periode }, signal: controller.signal })
      .then((r) => { if (!controller.signal.aborted) setData(r.data.data); })
      .catch((e) => { if (!controller.signal.aborted) setError(pesanError(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [periode, ulang, user.id, user.peran, user.bagian_id, dapatMasuk, dapatKeluar, dapatTugas]);
  const namaBersih = user.nama?.replace(/^\[SINTETIS\]\s*/, '') || 'Pengguna';
  const scope = ['superadmin', 'kepala_sekolah', 'tata_usaha'].includes(user.peran) ? 'Ringkasan sekolah' : user.peran === 'kepala_bagian' ? 'Ringkasan unit kerja' : 'Ruang tugas Anda';
  const kerjaUnit = ['guru_staf', 'kepala_bagian'].includes(user.peran);
  const tujuan = user.peran === 'guru_staf' ? '/penugasan' : '/disposisi';
  const statistik = data?.ringkasan;
  const hariIni = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const metrics = [
    [dapatMasuk, 'Surat masuk', statistik?.surat_masuk, 'masuk', '', '/surat/masuk'],
    [dapatKeluar, 'Surat keluar', statistik?.surat_keluar, 'keluar', '', '/surat/keluar'],
    [dapatTugas, 'Disposisi aktif', statistik?.disposisi_aktif, 'disposisi', '', tujuan],
    [dapatTugas, 'Dekat tenggat', statistik?.dekat_tenggat, 'tenggat', 'amber', `${tujuan}?tenggat=dekat`],
    [dapatTugas, 'Lewat tenggat', statistik?.terlambat, 'tenggat', 'red', `${tujuan}?tenggat=lewat`],
  ].filter(([allowed]) => allowed);
  const actions = [
    [kerjaUnit && dapatTugas, '/penugasan', 'Penugasan Saya', 'Baca arahan dan catat tindak lanjut', 'disposisi'],
    [['superadmin', 'tata_usaha', 'kepala_sekolah', 'kepala_bagian'].includes(user.peran) && (dapatMasuk || dapatKeluar), '/arsip', 'Arsip Surat', 'Telusuri surat yang sudah diarsipkan', 'arsip'],
    [boleh('jenis_surat', 'read'), '/katalog/surat', 'Katalog surat', 'Lihat jenis surat dan referensi', 'katalog'],
  ].filter(([allowed]) => allowed);
  return <>
    <PageHeader title={`Selamat datang, ${namaBersih}`} description={`${scope}. Pantau persuratan, disposisi, dan pekerjaan yang membutuhkan perhatian Anda.`} action={<button type="button" className="button button-light" disabled={loading} onClick={() => setUlang((n) => n + 1)}>Segarkan data</button>} />
    <Notice error>{error}</Notice>
    {loading && <p role="status" className="empty-state">Memuat ringkasan...</p>}
    {!!metrics.length && <div className="metric-grid">{metrics.map(([, title, value, icon, tone, to]) => <Link className={`panel metric metric-link${tone ? ` metric-${tone}` : ''}`} key={title} to={to}><div><p>{title}</p><strong>{value ?? '-'}</strong></div><div className={`metric-icon ${tone}`}><Icon nama={icon} /></div></Link>)}</div>}
    {(dapatMasuk || dapatKeluar || actions.length > 0) && <div className={actions.length && (dapatMasuk || dapatKeluar) ? 'dashboard-columns' : 'dashboard-single'}>
      {(dapatMasuk || dapatKeluar) && <GrafikSurat data={data?.tren} periode={periode} onPeriode={setPeriode} masuk={dapatMasuk} keluar={dapatKeluar} loading={loading} />}
      {!!actions.length && <section className="panel"><div className="panel-heading"><h2>Akses cepat</h2></div><div className="quick-actions">{actions.map(([, to, title, hint, icon]) => <Link className="quick-action" key={to} to={to}><Icon nama={icon} /><span><strong>{title}</strong><small>{hint}</small></span></Link>)}</div></section>}
    </div>}
    {data && <div className={dapatTugas ? 'dashboard-columns' : 'dashboard-single'}>
      {dapatTugas && <section className="panel">
        <div className="panel-heading"><div><h2>Disposisi perlu perhatian</h2><small>Penugasan aktif menurut tenggat</small></div><Link className="text-button" to={`${tujuan}?tenggat=aktif`}>Lihat semua</Link></div>
        {statistik?.terlambat > 0 && <div className="deadline-alert deadline-alert-overdue"><Icon nama="tenggat" /><Link className="text-button" to={`${tujuan}?tenggat=lewat`}>{statistik.terlambat} lewat tenggat</Link></div>}
        {statistik?.dekat_tenggat > 0 && <div className="deadline-alert"><Icon nama="tenggat" /><Link className="text-button" to={`${tujuan}?tenggat=dekat`}>{statistik.dekat_tenggat} jatuh tempo hari ini hingga 3 hari</Link></div>}
        {!data.prioritas?.length ? <p className="empty-state">Tidak ada disposisi aktif dalam lingkup Anda.</p> : <div className="table-scroll" tabIndex={0} aria-label="Disposisi menurut tenggat"><table><thead><tr><th scope="col">Perihal / instruksi</th><th scope="col">Tujuan</th><th scope="col">Tenggat</th><th scope="col">Status</th></tr></thead><tbody>{data.prioritas.map((d) => {
          // API prioritas hanya mengembalikan tugas dekat atau lewat tenggat.
          const tenggat = d.deadline && (d.deadline.slice(0, 10) < hariIni ? 'lewat_tenggat' : 'dekat_tenggat');
          return <tr key={d.id}><td><Link className="text-button" to={`${tujuan}?disposisi=${encodeURIComponent(d.id)}`}>{d.surat_masuk?.perihal || d.instruksi}</Link><small>{d.surat_masuk?.nomor_registrasi}</small></td><td>{d.ke_bagian?.nama || '-'}<small>{d.ke_user?.nama_lengkap || ''}</small></td><td>{tanggal(d.deadline)}{tenggat && <small><Badge value={tenggat} /></small>}</td><td><Badge value={d.status} /></td></tr>;
        })}</tbody></table></div>}
      </section>}
      <section className="panel"><div className="panel-heading"><h2>Aktivitas terbaru</h2><Icon nama="aktivitas" /></div>{!data.aktivitas?.length ? <p className="empty-state">Belum ada aktivitas dalam lingkup Anda.</p> : <ul className="activity-list">{data.aktivitas.map((a) => <li key={a.id}><Icon nama="aktivitas" /><div><p>{a.nama_user || 'Sistem'} · {label(a.aksi)}</p><small>{label(a.entitas)} · {tanggalWaktu(a.created_at)}</small></div></li>)}</ul>}</section>
    </div>}
  </>;
}
