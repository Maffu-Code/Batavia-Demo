import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Badge, DataTable, Dialog, Field, Icon, Notice, PageHeader, label, pesanError, tanggal } from '../components/Ui.jsx';

const STATUS = ['baru', 'dibaca', 'diproses', 'selesai'];
const FILTER_AWAL = { status: '', dari: '', sampai: '' };
const dibatalkan = (e) => e.code === 'ERR_CANCELED' || e.name === 'AbortError';

export default function Disposisi() {
  const { user, boleh, izinSiap } = useAuth();
  const [params] = useSearchParams();
  const suratPilihan = params.get('surat') || '';
  const dapatBaca = izinSiap && boleh('disposisi', 'read');
  const pimpinan = ['superadmin', 'kepala_sekolah'].includes(user?.peran);
  const dapatTambah = dapatBaca && pimpinan && boleh('disposisi', 'create');
  const [cari, setCari] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(FILTER_AWAL);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pesan, setPesan] = useState('');
  const [tambah, setTambah] = useState(false);
  const [detail, setDetail] = useState(null);
  const [ulang, setUlang] = useState(0);
  const sudahDibuka = useRef('');

  useEffect(() => {
    const timer = setTimeout(() => { setQ(cari.trim()); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [cari]);
  useEffect(() => {
    const controller = new AbortController();
    if (!dapatBaca) { setRows([]); setMeta(null); setLoading(false); return () => controller.abort(); }
    if (filter.dari && filter.sampai && filter.dari > filter.sampai) {
      setRows([]); setMeta(null); setLoading(false); setError('Tanggal awal tidak boleh melebihi tanggal akhir.');
      return () => controller.abort();
    }
    setLoading(true); setError(''); setRows([]);
    api.get('/disposisi', { params: { q, ...filter, page, limit }, signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (data.meta?.total_pages > 0 && page > data.meta.total_pages) { setPage(data.meta.total_pages); return; }
        setRows(data.data || []); setMeta(data.meta || null);
      })
      .catch((e) => { if (!controller.signal.aborted && !dibatalkan(e)) { setError(pesanError(e)); setMeta(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [dapatBaca, q, filter, page, limit, ulang]);
  useEffect(() => {
    if (dapatTambah && suratPilihan && sudahDibuka.current !== suratPilihan) { sudahDibuka.current = suratPilihan; setTambah(true); }
  }, [dapatTambah, suratPilihan]);
  useEffect(() => {
    if (!dapatBaca) { setTambah(false); setDetail(null); }
    if (!dapatTambah) setTambah(false);
  }, [dapatBaca, dapatTambah]);

  function tersimpan() { setTambah(false); setPesan('Disposisi berhasil dikirim ke unit tujuan.'); setPage(1); setUlang((v) => v + 1); }
  function diperbarui(item) {
    if (item.akses_dilepas) {
      setDetail(null);
      setRows((v) => v.filter((r) => r.id !== item.id));
      setPesan('Disposisi berhasil diteruskan. Akses Anda ke surat sensitif ini telah dilepas.');
    } else {
      setDetail((v) => v?.id === item.id ? item : v);
      setRows((v) => v.map((r) => r.id === item.id ? item : r));
      setPesan(`Disposisi berhasil diperbarui: ${label(item.status)}.`);
    }
    setUlang((v) => v + 1);
  }
  const columns = [
    { key: 'surat', title: 'Surat masuk', render: (r) => <><strong>{r.surat_masuk?.nomor_surat || r.surat_masuk?.nomor_registrasi || '-'}</strong><small>{r.surat_masuk?.perihal || '-'}</small></> },
    { key: 'pemberi', title: 'Pemberi arahan', render: (r) => r.dari?.nama_lengkap || '-' },
    { key: 'tujuan', title: 'Unit / penerima', render: (r) => <>{r.ke_bagian?.nama || '-'}<small>{r.ke_user?.nama_lengkap || 'Semua anggota unit'}</small></> },
    { key: 'instruksi', title: 'Instruksi', render: (r) => <p style={{ whiteSpace: 'pre-wrap' }}>{r.instruksi}</p> },
    { key: 'deadline', title: 'Batas waktu', render: (r) => tanggal(r.deadline) },
    { key: 'status', title: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'aksi', title: 'Aksi', render: (r) => <button type="button" className="button button-light button-small" onClick={() => setDetail(r)}>Lihat / tindak lanjut</button> },
  ];

  if (!izinSiap) return <p role="status" className="empty-state">Memuat izin akses...</p>;
  if (!dapatBaca) return <Notice error>Anda tidak memiliki izin membaca disposisi.</Notice>;
  return <>
    <PageHeader eyebrow="Arahan dan tindak lanjut" title="Disposisi" description={pimpinan ? 'Berikan arahan ke unit kerja dan pantau progres penyelesaian surat.' : 'Baca penugasan dalam lingkup Anda, proses instruksi, dan catat hasil tindak lanjut.'}
      action={dapatTambah && <button className="button" type="button" onClick={() => { setPesan(''); setTambah(true); }}><Icon nama="tambah" />Buat disposisi</button>} />
    <Notice>{pesan}</Notice>
    <DataTable columns={columns} rows={rows} loading={loading} error={error} onRetry={() => setUlang((v) => v + 1)} search={cari} onSearch={setCari}
      filters={{ values: filter, fields: [
        { key: 'status', title: 'Status', options: STATUS.map((value) => ({ value, label: label(value) })) },
        { key: 'dari', title: 'Dari tanggal disposisi', type: 'date' },
        { key: 'sampai', title: 'Sampai tanggal disposisi', type: 'date' },
      ] }} onFilters={(values) => { setFilter({ ...FILTER_AWAL, ...values }); setPage(1); }} meta={meta} onPage={setPage}
      action={<Field title="Baris per halaman"><select aria-label="Baris per halaman" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>{[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>}
      empty="Belum ada disposisi yang cocok dengan pencarian dan filter dalam lingkup Anda." minWidth={1000} />
    {tambah && dapatTambah && <FormDisposisi suratPilihan={suratPilihan} onClose={() => setTambah(false)} onSaved={tersimpan} />}
    {detail && <DetailDisposisi key={detail.id} item={detail} user={user} boleh={boleh} onClose={() => setDetail(null)} onSaved={diperbarui} />}
  </>;
}

function FormDisposisi({ suratPilihan, onClose, onSaved }) {
  const [form, setForm] = useState({ surat_masuk_id: suratPilihan, ke_bagian_id: '', ke_user_id: '', instruksi: '', deadline: '' });
  const [refs, setRefs] = useState({ bagian: [], pengguna: [] });
  const [surat, setSurat] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refError, setRefError] = useState('');
  const [error, setError] = useState('');
  const [ulang, setUlang] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mutation = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; mutation.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setRefError('');
    Promise.all([
      api.get('/referensi', { signal: controller.signal }),
      api.get('/surat-masuk', { params: { limit: 100, page: 1 }, signal: controller.signal }),
    ]).then(([reference, letters]) => {
      if (controller.signal.aborted) return;
      setRefs({ bagian: [], pengguna: [], ...reference.data.data }); setSurat(letters.data.data || []);
    }).catch((e) => { if (!controller.signal.aborted && !dibatalkan(e)) setRefError(pesanError(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ulang]);
  const isSemua = form.ke_bagian_id === 'SEMUA';
  const selectedBagian = refs.bagian.find((b) => b.id === form.ke_bagian_id);
  const penerima = refs.pengguna.filter((p) => p.bagian_id === form.ke_bagian_id && p.aktif !== false);
  const isi = (key) => (e) => setForm((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); if (lock.current || loading || refError) return;
    if (!form.instruksi.trim()) { setError('Instruksi wajib diisi.'); return; }
    if (!surat.some((s) => s.id === form.surat_masuk_id) || (!isSemua && !refs.bagian.some((b) => b.id === form.ke_bagian_id))) { setError('Pilih surat masuk dan unit tujuan yang tersedia.'); return; }
    if (!isSemua && form.ke_user_id && !penerima.some((p) => p.id === form.ke_user_id)) { setError('Penerima harus berasal dari unit tujuan yang dipilih.'); return; }
    lock.current = true; setBusy(true); setError('');
    const controller = new AbortController(); mutation.current = controller;
    const payload = { surat_masuk_id: form.surat_masuk_id, ke_bagian_id: form.ke_bagian_id, instruksi: form.instruksi.trim() };
    if (!isSemua && form.ke_user_id) payload.ke_user_id = form.ke_user_id;
    if (form.deadline) payload.deadline = form.deadline;
    try {
      const { data } = await api.post('/disposisi', payload, { signal: controller.signal });
      if (alive.current) onSaved(data.data);
    } catch (e) { if (alive.current && !dibatalkan(e)) setError(pesanError(e)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  return <Dialog wide title="Buat disposisi" onClose={() => { if (!lock.current) onClose(); }}>
    <Notice error>{error || refError}</Notice>
    {refError && <button className="button button-light" type="button" onClick={() => setUlang((v) => v + 1)}>Muat ulang pilihan</button>}
    {loading && <p role="status">Memuat surat masuk, unit, dan penerima...</p>}
    <form onSubmit={submit}>
      <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="form-grid">
          <div className="full-width"><Field title="Surat masuk *" hint="Daftar 100 surat terbaru yang dapat Anda akses."><select required disabled={loading || Boolean(refError)} value={form.surat_masuk_id} onChange={isi('surat_masuk_id')}><option value="">Pilih surat masuk</option>{surat.map((s) => <option key={s.id} value={s.id}>{s.nomor_surat || s.nomor_registrasi} · {s.perihal}</option>)}</select></Field></div>
          <Field title="Unit tujuan *"><select required disabled={loading || Boolean(refError)} value={form.ke_bagian_id} onChange={(e) => setForm((v) => ({ ...v, ke_bagian_id: e.target.value, ke_user_id: '' }))}><option value="">Pilih unit kerja</option><option value="SEMUA">📢 Semua Unit Kerja (Broadcast Sekolah)</option>{refs.bagian.map((b) => <option key={b.id} value={b.id}>{b.nama}</option>)}</select></Field>
          <Field title="Penerima khusus (opsional)" hint={isSemua ? 'Otomatis ditujukan ke seluruh anggota di setiap unit kerja.' : 'Pilih staf tertentu atau biarkan untuk seluruh anggota unit.'}><select disabled={!form.ke_bagian_id || isSemua || loading || Boolean(refError)} value={isSemua ? '' : form.ke_user_id} onChange={isi('ke_user_id')}>{isSemua ? <option value="">Seluruh Guru & Staf di Semua Unit</option> : <><option value="">Semua anggota {selectedBagian?.nama || 'unit'}</option>{penerima.map((p) => <option key={p.id} value={p.id}>{p.nama_lengkap}</option>)}</>}</select></Field>
          <div className="full-width"><Field title="Instruksi *"><textarea required rows={4} maxLength={2000} value={form.instruksi} onChange={isi('instruksi')} /></Field></div>
          <Field title="Batas waktu (opsional)"><input type="date" value={form.deadline} onChange={isi('deadline')} /></Field>
        </div>
        {!loading && !refError && (!surat.length || (!refs.bagian.length && !isSemua)) && <Notice error>Belum ada surat masuk atau unit tujuan. Lengkapi data sebelum membuat disposisi.</Notice>}
        {!loading && !refError && form.surat_masuk_id && !surat.some((s) => s.id === form.surat_masuk_id) && <Notice error>Surat pilihan tidak tersedia dalam daftar. Pilih surat masuk yang dapat Anda akses.</Notice>}
        <div className="form-actions"><button type="button" className="button button-light" onClick={onClose}>Batal</button><button className="button" type="submit" disabled={loading || Boolean(refError) || !surat.length || (!refs.bagian.length && !isSemua)}>{busy ? 'Mengirim disposisi...' : 'Kirim disposisi'}</button></div>
      </fieldset>
    </form>
  </Dialog>;
}

function DetailDisposisi({ item, user, boleh, onClose, onSaved }) {
  const [catatan, setCatatan] = useState('');
  const [pelaksanaList, setPelaksanaList] = useState([]);
  const [pilihan, setPilihan] = useState(item.ke_user_id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const controller = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const unitSama = Boolean(user?.bagian_id && user.bagian_id === item.ke_bagian_id);
  const penerima = user?.id === item.ke_user_id || (unitSama && (user?.peran === 'kepala_bagian' || item.ke_user_id === null));
  const pelaksana = ['kepala_bagian', 'guru_staf'].includes(user?.peran);
  const dapatProses = pelaksana && penerima && boleh('disposisi', 'update');
  const statusIndex = STATUS.indexOf(item.status);
  const next = statusIndex >= 0 ? STATUS[statusIndex + 1] : null;
  const dapatCatat = boleh('tindak_lanjut', 'create');
  const dapatTeruskan = boleh('disposisi', 'update') && item.status !== 'selesai' && (['superadmin', 'kepala_sekolah'].includes(user?.peran) || (user?.peran === 'kepala_bagian' && unitSama));
  useEffect(() => {
    if (!dapatTeruskan) return;
    const abort = new AbortController();
    api.get('/referensi', { signal: abort.signal }).then((r) => setPelaksanaList((r.data.data.pengguna || []).filter((p) => p.bagian_id === item.ke_bagian_id))).catch((e) => { if (!dibatalkan(e)) setError(pesanError(e)); });
    return () => abort.abort();
  }, [dapatTeruskan, item.ke_bagian_id]);
  async function teruskan(e) {
    e.preventDefault(); if (lock.current || !pilihan) return;
    lock.current = true; setBusy(true); setError('');
    controller.current = new AbortController();
    try { const { data } = await api.patch(`/disposisi/${encodeURIComponent(item.id)}`, { ke_user_id: pilihan }, { signal: controller.current.signal }); if (alive.current) onSaved(data.data); }
    catch (e) { if (alive.current && !dibatalkan(e)) setError(pesanError(e)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  async function submit(e) {
    e.preventDefault(); if (lock.current || !next || !dapatProses) return;
    if (next === 'selesai' && !dapatCatat) { setError('Izin mencatat tindak lanjut diperlukan untuk menyelesaikan disposisi.'); return; }
    if (next === 'selesai' && !catatan.trim()) { setError('Catatan hasil tindak lanjut wajib diisi untuk menyelesaikan disposisi.'); return; }
    lock.current = true; setBusy(true); setError(''); controller.current = new AbortController();
    const payload = { status: next }; if (catatan.trim()) payload.catatan = catatan.trim();
    try {
      const { data } = await api.patch(`/disposisi/${encodeURIComponent(item.id)}`, payload, { signal: controller.current.signal });
      if (alive.current) { setCatatan(''); onSaved(data.data); }
    } catch (e) { if (alive.current && !dibatalkan(e)) setError(pesanError(e)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  return <Dialog wide title="Detail disposisi" onClose={() => { if (!lock.current) onClose(); }}>
    <Notice error>{error}</Notice>
    <dl className="detail-grid">
      <div><dt>Nomor surat</dt><dd>{item.surat_masuk?.nomor_surat || item.surat_masuk?.nomor_registrasi || '-'}</dd></div><div><dt>Status</dt><dd><Badge value={item.status} /></dd></div>
      <div className="full-width"><dt>Perihal</dt><dd>{item.surat_masuk?.perihal || '-'}</dd></div>
      <div><dt>Pemberi arahan</dt><dd>{item.dari?.nama_lengkap || '-'}</dd></div><div><dt>Unit tujuan</dt><dd>{item.ke_bagian?.nama || '-'}</dd></div>
      <div><dt>Penerima khusus</dt><dd>{item.ke_user?.nama_lengkap || 'Semua anggota unit'}</dd></div><div><dt>Batas waktu</dt><dd>{tanggal(item.deadline)}</dd></div>
      <div><dt>Dibuat</dt><dd>{tanggal(item.created_at)}</dd></div><div><dt>Dibaca</dt><dd>{tanggal(item.dibaca_at)}</dd></div>
      <div className="full-width"><dt>Instruksi</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{item.instruksi}</dd></div>
    </dl>
    {boleh('surat_masuk', 'read') && <div className="row-actions" style={{ marginBottom: 22 }}><Link className="button button-light button-small" to="/surat/masuk">Buka daftar surat masuk</Link></div>}
    {boleh('tindak_lanjut', 'read') && <section aria-label="Riwayat tindak lanjut" style={{ marginBottom: 22 }}><h2>Riwayat tindak lanjut</h2>
      {!item.tindak_lanjut?.length ? <p className="empty-state">Belum ada catatan tindak lanjut.</p> : <ul>{item.tindak_lanjut.map((t) => <li key={t.id} style={{ marginTop: 14 }}><strong>{t.oleh?.nama_lengkap || 'Penerima disposisi'}</strong><small> · {tanggal(t.created_at)}{t.selesai_at ? ` · Selesai ${tanggal(t.selesai_at)}` : ''}</small><p style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{t.catatan}</p></li>)}</ul>}
      {item.catatan && <p style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>Catatan: {item.catatan}</p>}
    </section>}
    {dapatTeruskan && <form className="panel" onSubmit={teruskan} style={{ padding: 16, marginBottom: 22 }}><h2>Teruskan ke pelaksana</h2><Field title="Guru / staf di unit tujuan"><select required value={pilihan} disabled={busy} onChange={(e) => setPilihan(e.target.value)}><option value="">Pilih penerima</option>{pelaksanaList.map((p) => <option key={p.id} value={p.id}>{p.nama_lengkap}</option>)}</select></Field><div className="form-actions"><button className="button button-light" disabled={busy || !pilihan || pilihan === item.ke_user_id}>Tetapkan pelaksana</button></div></form>}
    {dapatProses && next ? <form onSubmit={submit}>
      <Field title={next === 'selesai' ? 'Catatan hasil tindak lanjut *' : 'Catatan tindak lanjut (opsional)'} hint={next === 'selesai' ? 'Jelaskan hasil pekerjaan sebelum menandai selesai.' : 'Status mengikuti urutan baru, dibaca, diproses, selesai.'}><textarea required={next === 'selesai'} rows={4} maxLength={5000} value={catatan} disabled={busy || !dapatCatat} onChange={(e) => setCatatan(e.target.value)} /></Field>
      {!dapatCatat && <Notice error>Izin mencatat tindak lanjut belum tersedia. Minta pengelola mengaktifkan izin sebelum penyelesaian.</Notice>}
      <div className="form-actions"><button className="button" disabled={busy || (next === 'selesai' && !dapatCatat)} type="submit">{busy ? 'Menyimpan...' : `Tandai ${label(next)}`}</button></div>
    </form> : <Notice>{item.status === 'selesai' ? 'Disposisi telah selesai.' : 'Mode pemantauan. Pembaruan progres hanya untuk penerima disposisi yang berizin.'}</Notice>}
  </Dialog>;
}
