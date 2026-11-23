import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import DaftarLampiran from '../components/DaftarLampiran.jsx';
import { Badge, DataTable, Dialog, Field, Icon, Notice, PageHeader, label, pesanError, tanggal } from '../components/Ui.jsx';

const STATUS = ['baru', 'dibaca', 'diproses', 'selesai'];
const TENGGAT = [{ value: 'aktif', label: 'Dekat / lewat tenggat' }, { value: 'dekat', label: 'Hari ini hingga 3 hari' }, { value: 'lewat', label: 'Lewat tenggat' }];
const SIAP_DISPOSISI = ['dibaca_pimpinan', 'didisposisi'];
const PELAKSANA = ['kepala_bagian', 'guru_staf'];
const BATAS_PENERIMA = 100;
const gayaGrup = { minWidth: 0, margin: 0, border: '1px solid var(--line)', borderRadius: 5, padding: '8px 12px' };
const gayaPilihan = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer', overflowWrap: 'anywhere' };
const dibatalkan = (e) => e.code === 'ERR_CANCELED' || e.name === 'AbortError';

export default function Disposisi({ penugasan = false }) {
  return <DaftarDisposisi key={penugasan ? 'tugas' : 'disposisi'} penugasan={penugasan} />;
}

function DaftarDisposisi({ penugasan }) {
  const { user, boleh, izinSiap } = useAuth();
  const [params, setParams] = useSearchParams();
  const suratPilihan = params.get('surat') || '';
  const detailId = params.get('disposisi') || '';
  const tenggat = TENGGAT.some((o) => o.value === params.get('tenggat')) ? params.get('tenggat') : '';
  const dapatBaca = izinSiap && boleh('disposisi', 'read') && (!penugasan || ['kepala_bagian', 'guru_staf'].includes(user?.peran));
  const dapatBacaLampiran = boleh('lampiran', 'read');
  const dapatBacaCatatan = boleh('tindak_lanjut', 'read');
  const kepalaSekolah = user?.peran === 'kepala_sekolah';
  const dapatTambah = !penugasan && dapatBaca && kepalaSekolah && boleh('disposisi', 'create') && boleh('surat_masuk', 'read');
  const [cari, setCari] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState({});
  const [bagian, setBagian] = useState([]);
  const [refError, setRefError] = useState('');
  const [ulangRef, setUlangRef] = useState(0);
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
  const [galatDetail, setGalatDetail] = useState('');
  const [muatDetail, setMuatDetail] = useState(false);
  const [ulangDetail, setUlangDetail] = useState(0);

  function ubahParam(kunci, nilai, replace = false) {
    const next = new URLSearchParams(params);
    if (nilai) next.set(kunci, nilai); else next.delete(kunci);
    setParams(next, { replace });
  }

  function tutupTambah() {
    setTambah(false);
    if (suratPilihan) ubahParam('surat', '', true);
  }

  useEffect(() => {
    if (!dapatBaca || penugasan) return;
    const controller = new AbortController();
    setRefError('');
    api.get('/referensi', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setBagian(data.data.bagian || []);
    }).catch((e) => { if (!controller.signal.aborted) setRefError(pesanError(e)); });
    return () => controller.abort();
  }, [dapatBaca, penugasan, ulangRef]);

  useEffect(() => {
    setDetail(null); setGalatDetail(''); setMuatDetail(false);
    if (!dapatBaca || !detailId) return;
    const controller = new AbortController();
    setMuatDetail(true);
    api.get(`/disposisi/${encodeURIComponent(detailId)}`, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setDetail(data.data);
    }).catch((e) => {
      if (!controller.signal.aborted) setGalatDetail([403, 404].includes(e.response?.status) ? 'Disposisi tidak tersedia atau tidak lagi dapat Anda akses.' : pesanError(e));
    }).finally(() => { if (!controller.signal.aborted) setMuatDetail(false); });
    return () => controller.abort();
  }, [dapatBaca, dapatBacaLampiran, dapatBacaCatatan, user.id, user.bagian_id, user.peran, detailId, ulangDetail]);

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
    api.get('/disposisi', { params: { q, ...filter, tenggat: tenggat || undefined, tugasku: penugasan ? 1 : undefined, page, limit }, signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (data.meta?.total_pages > 0 && page > data.meta.total_pages) { setPage(data.meta.total_pages); return; }
        setRows(data.data || []); setMeta(data.meta || null);
      })
      .catch((e) => { if (!controller.signal.aborted && !dibatalkan(e)) { setError(pesanError(e)); setMeta(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [dapatBaca, q, filter, page, limit, ulang, tenggat, penugasan]);
  useEffect(() => { setPage(1); }, [tenggat]);
  useEffect(() => {
    if (!dapatBaca) { setTambah(false); setDetail(null); }
    if (!dapatTambah) setTambah(false);
  }, [dapatBaca, dapatTambah]);

  function tersimpan(item) {
    tutupTambah();
    setPesan(`${item.jumlah_dibuat ?? 1} tugas disposisi berhasil dibuat.`);
    setPage(1); setUlang((v) => v + 1);
  }
  function diperbarui(item, message) {
    if (item.akses_dilepas) {
      setDetail(null);
      ubahParam('disposisi', '', true);
      setRows((v) => v.filter((r) => r.id !== item.id));
      setPesan('Disposisi berhasil diteruskan. Akses Anda ke surat sensitif ini telah dilepas.');
    } else {
      setDetail((v) => v?.id === item.id ? { ...v, ...item } : v);
      setRows((v) => v.map((r) => r.id === item.id ? item : r));
      setPesan(message || `Disposisi berhasil diperbarui: ${label(item.status)}.`);
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
    { key: 'aksi', title: 'Aksi', render: (r) => <button type="button" className="button button-light button-small" onClick={() => ubahParam('disposisi', r.id)}>Lihat detail</button> },
  ];

  if (!izinSiap) return <p role="status" className="empty-state">Memuat izin akses...</p>;
  if (!dapatBaca) return <Notice error>Anda tidak memiliki izin membaca disposisi.</Notice>;
  return <>
    <PageHeader title={penugasan ? "Penugasan Saya" : "Disposisi"} description={penugasan ? 'Baca arahan yang ditugaskan kepada Anda atau unit Anda, lalu catat tindak lanjutnya.' : kepalaSekolah ? 'Berikan arahan ke unit kerja dan pantau tindak lanjutnya.' : 'Pantau disposisi dalam lingkup akses Anda.'}
      action={dapatTambah && <button className="button" type="button" onClick={() => { setPesan(''); setTambah(true); }}><Icon nama="tambah" />Buat disposisi</button>} />
    <Notice>{pesan}</Notice>
    {refError && <Notice error>Pilihan unit belum dapat dimuat. <button type="button" className="text-button" onClick={() => setUlangRef((n) => n + 1)}>Muat ulang pilihan</button></Notice>}
    <DataTable columns={columns} rows={rows} loading={loading} error={error} onRetry={() => setUlang((v) => v + 1)} search={cari} onSearch={setCari}
      filters={{ values: { ...filter, tenggat }, fields: [
        { key: 'tenggat', title: 'Tenggat', options: TENGGAT },
        ...(!penugasan ? [{ key: 'bagian_id', title: 'Unit tujuan', options: bagian.map((b) => ({ value: b.id, label: b.nama })) }] : []),
        { key: 'status', title: 'Status', options: STATUS.map((value) => ({ value, label: label(value) })) },
        { key: 'dari', title: 'Dari tanggal disposisi', type: 'date' },
        { key: 'sampai', title: 'Sampai tanggal disposisi', type: 'date' },
      ] }} onFilters={({ tenggat: batas, ...values }) => { ubahParam('tenggat', batas); setFilter(values); setPage(1); }} meta={meta} onPage={setPage}
      limit={limit} onLimit={(n) => { setLimit(n); setPage(1); }}
      empty="Belum ada disposisi yang cocok dengan pencarian dan filter dalam lingkup Anda." minWidth={1000} />
    {(tambah || suratPilihan) && dapatTambah && <FormDisposisi key={suratPilihan || 'baru'} suratPilihan={suratPilihan} onClose={tutupTambah} onSaved={tersimpan} />}
    {!(dapatTambah && (tambah || suratPilihan)) && dapatBaca && detailId && (detail?.id === detailId ? <DetailDisposisi key={detail.id} item={detail} user={user} boleh={boleh} onClose={() => ubahParam('disposisi', '', true)} onSaved={diperbarui} /> : <Dialog title="Detail disposisi" onClose={() => ubahParam('disposisi', '', true)}>
      <Notice error>{galatDetail}</Notice>
      {(muatDetail || !galatDetail) && <p className="empty-state" role="status">Memuat detail disposisi...</p>}
      {galatDetail && <button type="button" className="button button-light" onClick={() => setUlangDetail((n) => n + 1)}>Coba lagi</button>}
    </Dialog>)}
  </>;
}

function FormDisposisi({ suratPilihan, onClose, onSaved }) {
  const [form, setForm] = useState({ surat_masuk_id: suratPilihan, ke_bagian_id: '', ke_user_ids: [], mode: 'kolektif', instruksi: '', deadline: '' });
  const keteranganPenerima = useId();
  const [refs, setRefs] = useState({ bagian: [], pengguna: [] });
  const [surat, setSurat] = useState([]);
  const [pesanPilihan, setPesanPilihan] = useState('');
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
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true); setRefError(''); setPesanPilihan('');
    Promise.all([
      api.get('/referensi', { signal }),
      suratPilihan ? api.get(`/surat-masuk/${encodeURIComponent(suratPilihan)}`, { signal }).then(({ data }) => [data.data]).catch((e) => {
        if (!signal.aborted) setPesanPilihan([403, 404].includes(e.response?.status) ? 'Surat pilihan tidak tersedia dalam lingkup akses Anda.' : 'Surat pilihan gagal dimuat. Coba muat ulang pilihan.');
        return [];
      }) : Promise.all(SIAP_DISPOSISI.map((status) => api.get('/surat-masuk', { params: { status, limit: 100, page: 1 }, signal })))
        .then((res) => res.flatMap(({ data }) => data.data || [])),
    ]).then(([reference, pilihan]) => {
      if (signal.aborted) return;
      setRefs({ bagian: [], pengguna: [], ...reference.data.data });
      const tepat = suratPilihan ? pilihan[0] : null;
      if (tepat && !SIAP_DISPOSISI.includes(tepat.status)) setPesanPilihan(tepat.status === 'diterima' ? 'Kepala Sekolah harus menelaah surat ini sebelum membuat disposisi.' : 'Surat pilihan sudah selesai atau diarsipkan.');
      const rows = pilihan.filter((s) => s && SIAP_DISPOSISI.includes(s.status));
      setSurat([...new Map(rows.map((r) => [r.id, r])).values()]);
    }).catch((e) => { if (!signal.aborted) setRefError(pesanError(e)); })
      .finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ulang, suratPilihan]);
  const suratAktif = surat.find((s) => s.id === form.surat_masuk_id);
  const sensitif = suratAktif?.sensitif === true;
  const isSemua = form.ke_bagian_id === 'SEMUA';
  const selectedBagian = refs.bagian.find((b) => b.id === form.ke_bagian_id);
  const pilihOrang = !isSemua && (sensitif || form.mode === 'orang');
  const penerima = refs.pengguna.filter((p) => p.bagian_id === form.ke_bagian_id && p.aktif !== false && PELAKSANA.includes(p.peran));
  const isi = (key) => (e) => setForm((v) => ({ ...v, [key]: e.target.value }));

  function pilihTujuan(key, value) {
    setError('');
    setForm((v) => ({
      ...v,
      ...(key === 'surat_masuk_id' && v.ke_bagian_id === 'SEMUA' ? { ke_bagian_id: '' } : {}),
      ke_user_ids: [], mode: 'kolektif', [key]: value,
    }));
  }
  function centang(id, checked) {
    setError('');
    setForm((v) => ({ ...v, ke_user_ids: checked
      ? (v.ke_user_ids.length < BATAS_PENERIMA && !v.ke_user_ids.includes(id) ? [...v.ke_user_ids, id] : v.ke_user_ids)
      : v.ke_user_ids.filter((value) => value !== id) }));
  }

  async function submit(e) {
    e.preventDefault(); if (lock.current || loading || refError) return;
    if (!form.instruksi.trim()) { setError('Instruksi wajib diisi.'); return; }
    if (!suratAktif || (!isSemua && !selectedBagian)) { setError('Pilih surat masuk dan unit tujuan yang tersedia.'); return; }
    if (sensitif && isSemua) { setError('Surat sensitif tidak dapat dikirim ke semua unit.'); return; }
    if (pilihOrang && (!form.ke_user_ids.length || form.ke_user_ids.some((id) => !penerima.some((p) => p.id === id)))) {
      setError('Pilih minimal satu penerima aktif dari unit tujuan.'); return;
    }
    lock.current = true; setBusy(true); setError('');
    const controller = new AbortController(); mutation.current = controller;
    const payload = { surat_masuk_id: form.surat_masuk_id, ke_bagian_id: form.ke_bagian_id, instruksi: form.instruksi.trim() };
    if (pilihOrang) payload.ke_user_ids = form.ke_user_ids;
    if (form.deadline) payload.deadline = form.deadline;
    try {
      const { data } = await api.post('/disposisi', payload, { signal: controller.signal });
      if (alive.current) onSaved(data.data);
    } catch (e) { if (alive.current && !dibatalkan(e)) setError(pesanError(e)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  return <Dialog wide title="Buat disposisi" onClose={() => { if (!lock.current) onClose(); }}>
    <Notice error>{error || refError}</Notice>
    <Notice error>{pesanPilihan}</Notice>
    {(refError || pesanPilihan) && <button className="button button-light" type="button" onClick={() => setUlang((v) => v + 1)}>Muat ulang pilihan</button>}
    {loading && <p role="status">Memuat surat masuk, unit, dan penerima...</p>}
    <form onSubmit={submit}>
      <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="form-grid">
          <div className="full-width"><Field title="Surat masuk *" hint="Pilih surat yang telah ditelaah atau masih dalam proses disposisi."><select required disabled={loading || Boolean(refError)} value={suratAktif?.id || ''} onChange={(e) => { setPesanPilihan(''); pilihTujuan('surat_masuk_id', e.target.value); }}><option value="">Pilih surat masuk</option>{surat.map((s) => <option key={s.id} value={s.id}>{s.nomor_surat || s.nomor_registrasi} · {s.perihal}</option>)}</select></Field></div>
          <Field title="Unit tujuan *"><select required disabled={loading || Boolean(refError)} value={form.ke_bagian_id} onChange={(e) => pilihTujuan('ke_bagian_id', e.target.value)}><option value="">Pilih unit kerja</option>{!sensitif && <option value="SEMUA">Semua unit kerja</option>}{refs.bagian.map((b) => <option key={b.id} value={b.id}>{b.nama}</option>)}</select></Field>
          {suratAktif && isSemua && !sensitif && <p className="full-width">Setiap unit aktif akan menerima satu tugas kolektif.</p>}
          {suratAktif && selectedBagian && !sensitif && <fieldset className="full-width" style={gayaGrup}>
            <legend>Tujuan di unit</legend>
            <label style={gayaPilihan}><input type="radio" name="mode-penerima" value="kolektif" checked={!pilihOrang} onChange={(e) => pilihTujuan('mode', e.target.value)} />Semua anggota unit</label>
            <label style={gayaPilihan}><input type="radio" name="mode-penerima" value="orang" checked={pilihOrang} onChange={(e) => pilihTujuan('mode', e.target.value)} />Pilih orang</label>
            {!pilihOrang && <small>Satu tugas kolektif untuk unit ini.</small>}
          </fieldset>}
          {suratAktif && selectedBagian && pilihOrang && <fieldset className="full-width" style={gayaGrup} aria-describedby={keteranganPenerima}>
            <legend>Penerima khusus (pilih minimal satu)</legend>
            <p id={keteranganPenerima}>{sensitif ? 'Surat sensitif wajib dikirim ke penerima tertentu. ' : ''}Setiap penerima mendapat tugas, progres, dan catatan terpisah.</p>
            <p role="status">{form.ke_user_ids.length} dari {BATAS_PENERIMA} penerima dipilih.</p>
            {penerima.length ? <div style={{ maxHeight: '12rem', overflowY: 'auto', padding: 4 }}>
              {penerima.map((p) => {
                const checked = form.ke_user_ids.includes(p.id);
                return <label key={p.id} style={gayaPilihan}><input type="checkbox" checked={checked} disabled={!checked && form.ke_user_ids.length >= BATAS_PENERIMA} onChange={(e) => centang(p.id, e.target.checked)} />{p.nama_lengkap}</label>;
              })}
            </div> : <p>Tidak ada kepala bagian atau guru/staf aktif di unit ini.</p>}
          </fieldset>}
          <div className="full-width"><Field title="Instruksi *"><textarea required rows={4} maxLength={2000} value={form.instruksi} onChange={isi('instruksi')} /></Field></div>
          <Field title="Batas waktu (opsional)"><input type="date" value={form.deadline} onChange={isi('deadline')} /></Field>
        </div>
        {!loading && !refError && (!surat.length || (!refs.bagian.length && !isSemua)) && <Notice error>Belum ada surat masuk atau unit tujuan. Lengkapi data sebelum membuat disposisi.</Notice>}
        <div className="form-actions"><button type="button" className="button button-light" onClick={onClose}>Batal</button><button className="button" type="submit" disabled={loading || Boolean(refError) || !suratAktif || (!selectedBagian && !isSemua) || (sensitif && isSemua) || (pilihOrang && !form.ke_user_ids.length)}>{busy ? 'Mengirim disposisi...' : 'Kirim disposisi'}</button></div>
      </fieldset>
    </form>
  </Dialog>;
}

function DetailDisposisi({ item, user, boleh, onClose, onSaved }) {
  const [catatan, setCatatan] = useState('');
  const [pelaksanaList, setPelaksanaList] = useState([]);
  const [pilihan, setPilihan] = useState(item.ke_user_id || '');
  const [error, setError] = useState('');
  const [pesan, setPesan] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const controller = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const unitSama = Boolean(user?.bagian_id && user.bagian_id === item.ke_bagian_id);
  const dapatProses = item.can_tindak_lanjut === true && boleh('disposisi', 'update');
  const statusIndex = STATUS.indexOf(item.status);
  const next = statusIndex >= 0 ? STATUS[statusIndex + 1] : null;
  const dapatCatat = boleh('tindak_lanjut', 'create');
  const dapatTeruskan = boleh('disposisi', 'update') && item.surat_masuk?.status !== 'diarsipkan' && item.status !== 'selesai' && (['superadmin', 'kepala_sekolah'].includes(user?.peran) || (user?.peran === 'kepala_bagian' && unitSama));
  useEffect(() => {
    if (!dapatTeruskan) return;
    const abort = new AbortController();
    api.get('/referensi', { signal: abort.signal }).then((r) => setPelaksanaList((r.data.data.pengguna || []).filter((p) => p.bagian_id === item.ke_bagian_id && PELAKSANA.includes(p.peran)))).catch((e) => { if (!dibatalkan(e)) setError(pesanError(e)); });
    return () => abort.abort();
  }, [dapatTeruskan, item.ke_bagian_id]);
  async function teruskan(e) {
    e.preventDefault(); if (lock.current || !pilihan) return;
    lock.current = true; setBusy(true); setError('');
    controller.current = new AbortController();
    try { const { data } = await api.patch(`/disposisi/${encodeURIComponent(item.id)}`, { ke_user_id: pilihan }, { signal: controller.current.signal }); if (alive.current) { setPesan('Pelaksana berhasil ditetapkan.'); onSaved(data.data); } }
    catch (e) { if (alive.current && !dibatalkan(e)) setError(pesanError(e)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  async function simpanProgres(status) {
    if (lock.current || !dapatProses || (!status && (!dapatCatat || !catatan.trim()))) return;
    if (status === 'selesai' && !dapatCatat) { setError('Izin mencatat tindak lanjut diperlukan untuk menyelesaikan disposisi.'); return; }
    if (status === 'selesai' && !catatan.trim()) { setError('Catatan hasil tindak lanjut wajib diisi untuk menyelesaikan disposisi.'); return; }
    lock.current = true; setBusy(true); setError(''); controller.current = new AbortController();
    const payload = status ? { status } : {};
    if (dapatCatat && catatan.trim()) payload.catatan = catatan.trim();
    try {
      const { data } = await api.patch(`/disposisi/${encodeURIComponent(item.id)}`, payload, { signal: controller.current.signal });
      if (alive.current) { setCatatan(''); setPesan(status ? `Status diperbarui menjadi ${label(status)}.` : 'Catatan tindak lanjut disimpan tanpa mengubah status.'); onSaved(data.data, status ? '' : 'Catatan tindak lanjut disimpan tanpa mengubah status.'); }
    } catch (e) { if (alive.current && !dibatalkan(e)) setError(pesanError(e)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  return <Dialog wide title="Detail disposisi" onClose={() => { if (!lock.current) onClose(); }}>
    <Notice error>{error}</Notice>
    <Notice>{pesan}</Notice>
    <dl className="detail-grid">
      <div><dt>Nomor surat</dt><dd>{item.surat_masuk?.nomor_surat || item.surat_masuk?.nomor_registrasi || '-'}</dd></div><div><dt>Status</dt><dd><Badge value={item.status} /></dd></div>
      <div className="full-width"><dt>Perihal</dt><dd>{item.surat_masuk?.perihal || '-'}</dd></div>
      <div><dt>Pemberi arahan</dt><dd>{item.dari?.nama_lengkap || '-'}</dd></div><div><dt>Unit tujuan</dt><dd>{item.ke_bagian?.nama || '-'}</dd></div>
      <div><dt>Penerima khusus</dt><dd>{item.ke_user?.nama_lengkap || 'Semua anggota unit'}</dd></div><div><dt>Batas waktu</dt><dd>{tanggal(item.deadline)}</dd></div>
      <div><dt>Dibuat</dt><dd>{tanggal(item.created_at)}</dd></div><div><dt>Dibaca</dt><dd>{tanggal(item.dibaca_at)}</dd></div>
      <div className="full-width"><dt>Instruksi</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{item.instruksi}</dd></div>
    </dl>
    {boleh('lampiran', 'read') && <section aria-label="Lampiran surat" style={{ marginBottom: 22 }}><h2>Lampiran surat</h2><DaftarLampiran items={item.lampiran} dapatUnduh /></section>}
    {boleh('tindak_lanjut', 'read') && <section aria-label="Riwayat tindak lanjut" style={{ marginBottom: 22 }}><h2>Riwayat tindak lanjut</h2>
      {!item.tindak_lanjut?.length ? <p className="empty-state">Belum ada catatan tindak lanjut.</p> : <ul>{item.tindak_lanjut.map((t) => <li key={t.id} style={{ marginTop: 14 }}><strong>{t.oleh?.nama_lengkap || 'Penerima disposisi'}</strong><small> · {tanggal(t.created_at)}{t.selesai_at ? ` · Selesai ${tanggal(t.selesai_at)}` : ''}</small><p style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{t.catatan}</p></li>)}</ul>}
      {item.catatan && <p style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>Catatan: {item.catatan}</p>}
    </section>}
    {dapatTeruskan && <form className="panel" onSubmit={teruskan} style={{ padding: 16, marginBottom: 22 }}><h2>Teruskan ke pelaksana</h2><Field title="Guru / staf di unit tujuan"><select required value={pilihan} disabled={busy} onChange={(e) => setPilihan(e.target.value)}><option value="">Pilih penerima</option>{pelaksanaList.map((p) => <option key={p.id} value={p.id}>{p.nama_lengkap}</option>)}</select></Field><div className="form-actions"><button className="button button-light" disabled={busy || !pilihan || pilihan === item.ke_user_id}>Tetapkan pelaksana</button></div></form>}
    {dapatProses && next ? <form onSubmit={(e) => { e.preventDefault(); simpanProgres(next); }}>
      <Field title={next === 'selesai' ? 'Catatan hasil tindak lanjut *' : 'Catatan tindak lanjut (opsional)'} hint={next === 'selesai' ? 'Jelaskan hasil pekerjaan sebelum menandai selesai.' : 'Status mengikuti urutan baru, dibaca, diproses, selesai.'}><textarea required={next === 'selesai'} rows={4} maxLength={5000} value={catatan} disabled={busy || !dapatCatat} onChange={(e) => setCatatan(e.target.value)} /></Field>
      {!dapatCatat && <Notice error>Izin mencatat tindak lanjut belum tersedia. Minta pengelola mengaktifkan izin sebelum penyelesaian.</Notice>}
      <div className="form-actions">
        {dapatCatat && <button className="button button-light" type="button" disabled={busy || !catatan.trim()} onClick={() => simpanProgres()}>Simpan catatan saja</button>}
        {item.status === 'baru' && <button className="button button-light" type="button" disabled={busy} onClick={() => simpanProgres('diproses')}>Mulai proses</button>}
        <button className="button" disabled={busy || (next === 'selesai' && !dapatCatat)} type="submit">{busy ? 'Menyimpan...' : `Tandai ${label(next)}`}</button>
      </div>
    </form> : <Notice>{item.status === 'selesai' ? 'Disposisi telah selesai.' : 'Mode pemantauan. Pembaruan progres hanya untuk penerima disposisi yang berizin.'}</Notice>}
  </Dialog>;
}
