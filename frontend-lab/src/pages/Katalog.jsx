import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Badge, DataTable, Dialog, Field, Icon, Notice, PageHeader, pesanError } from '../components/Ui.jsx';

const JENIS = { surat: ['Jenis Surat', 'jenis_surat'], arsip: ['Jenis Arsip', 'jenis_arsip'], unit: ['Unit Kerja', 'bagian'] };
const KOSONG = { kode: '', nama: '', keterangan: '', aktif: true };
const KONFIRMASI_HAPUS = 'KONFIRMASI HAPUS';

export default function Katalog() {
  const { jenis } = useParams();
  return <TabelKatalog key={jenis} jenis={jenis} />;
}

function TabelKatalog({ jenis }) {
  const { user, boleh } = useAuth();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({});
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [form, setForm] = useState(KOSONG);
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(false);
  const [targetHapus, setTargetHapus] = useState(null);
  const [konfirmasi, setKonfirmasi] = useState('');
  const [errorHapus, setErrorHapus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const [ulang, setUlang] = useState(0);
  const valid = Object.hasOwn(JENIS, jenis);
  const [title, resource] = valid ? JENIS[jenis] : [];
  const unit = jenis === 'unit';
  const adminWrite = !unit || user.peran === 'superadmin';
  const read = valid && boleh(resource, 'read');
  const canUpdate = adminWrite && boleh(resource, 'update');
  const canDelete = read && user.peran === 'superadmin' && boleh(resource, 'delete');
  useEffect(() => {
    if (!canDelete) setTargetHapus(null);
  }, [canDelete]);
  useEffect(() => {
    let active = true;
    setOpen(false); setRows([]); setError(''); setSearch(''); setFilter({}); setPage(1);
    if (!read) { setLoading(false); return; }
    setLoading(true);
    api.get(`/katalog/${jenis}`).then((r) => { if (active) setRows(r.data.data); }).catch((e) => { if (active) setError(pesanError(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [jenis, read, ulang]);
  function begin(item = null) { setEdit(item?.id || null); setForm(item ? { kode: item.singkatan ?? item.kode, nama: item.nama, keterangan: item.keterangan || '', aktif: item.aktif } : KOSONG); setFormError(''); setOpen(true); }
  async function save(e) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setFormError('');
    try {
      const { data } = await api[edit ? 'patch' : 'post'](`/katalog/${jenis}${edit ? `/${edit}` : ''}`, unit ? { singkatan: form.kode, nama: form.nama, aktif: form.aktif } : form);
      setRows((prev) => [data.data, ...prev.filter((x) => x.id !== data.data.id)]);
      setMessage(`${data.data.nama} berhasil disimpan.`); setOpen(false);
    } catch (e) { setFormError(pesanError(e)); } finally { setBusy(false); }
  }
  async function toggle(item) {
    if (!window.confirm(`${item.aktif ? 'Nonaktifkan' : 'Aktifkan'} ${item.nama}? Data tetap disimpan.`)) return;
    setBusy(true); setError('');
    try { const { data } = await api.patch(`/katalog/${jenis}/${item.id}`, { aktif: !item.aktif }); setRows((prev) => prev.map((x) => x.id === item.id ? data.data : x)); setMessage(`Status ${item.nama} diperbarui.`); }
    catch (e) { setError(pesanError(e)); } finally { setBusy(false); }
  }
  function beginDelete(item) {
    setTargetHapus(item); setKonfirmasi(''); setErrorHapus(''); setMessage('');
  }
  async function remove(e) {
    e.preventDefault();
    if (!canDelete || !targetHapus || busy || konfirmasi !== KONFIRMASI_HAPUS) return;
    setBusy(true); setErrorHapus('');
    try {
      const { id, nama } = targetHapus;
      await api.delete(`/katalog/${jenis}/${id}`, { data: { konfirmasi } });
      setRows((prev) => prev.filter((row) => row.id !== id));
      setMessage(`${nama} berhasil dihapus.`);
      setTargetHapus(null);
    } catch (e) { setErrorHapus(pesanError(e)); } finally { setBusy(false); }
  }
  const filtered = rows.filter((r) => `${r.singkatan ?? r.kode} ${r.nama} ${r.keterangan || ''}`.toLowerCase().includes(search.toLowerCase()) && (!filter.aktif || String(r.aktif) === filter.aktif));
  const pages = Math.max(1, Math.ceil(filtered.length / limit));
  const current = Math.min(page, pages);
  if (!valid) return <Notice error>Katalog tidak dikenal.</Notice>;
  if (!read) return <Notice error>Anda tidak memiliki izin melihat katalog ini.</Notice>;
  return <>
    <PageHeader eyebrow="Katalog" title={title} description={unit ? "Superadmin mengelola unit kerja yang tersedia untuk akun, pencatatan surat masuk, dan disposisi." : "Daftar jenis dipakai saat pencatatan dokumen. Nonaktifkan jenis lama tanpa menghapus riwayatnya."} />
    <nav className="tabbar" aria-label="Jenis katalog">{Object.entries(JENIS).filter(([, [, r]]) => boleh(r, 'read')).map(([slug, [label]]) => <Link key={slug} to={`/katalog/${slug}`} aria-current={slug === jenis ? 'page' : undefined}>{label}</Link>)}</nav>
    <Notice>{message}</Notice>
    <DataTable rows={filtered.slice((current - 1) * limit, current * limit)} loading={loading} error={error} onRetry={() => setUlang((n) => n + 1)} search={search} onSearch={(v) => { setSearch(v); setPage(1); }} filters={{ values: filter, fields: [{ key: 'aktif', title: 'Status', options: [{ value: 'true', label: 'Aktif' }, { value: 'false', label: 'Nonaktif' }] }] }} onFilters={(v) => { setFilter(v); setPage(1); }} meta={{ page: current, total: filtered.length, total_pages: pages }} onPage={setPage} limit={limit} onLimit={(v) => { setLimit(v); setPage(1); }} action={adminWrite && boleh(resource, 'create') && <button className="button" onClick={() => begin()}><Icon nama="tambah" />{unit ? 'Tambah unit' : 'Tambah jenis'}</button>} columns={[
      { key: unit ? 'singkatan' : 'kode', title: unit ? 'Singkatan' : 'Kode' }, { key: 'nama', title: 'Nama dan keterangan', render: (r) => <><strong>{r.nama}</strong><small>{r.keterangan || 'Tanpa keterangan'}</small></> },
      { key: 'aktif', title: 'Status', render: (r) => <Badge value={r.aktif ? 'aktif' : 'nonaktif'} /> },
      { key: 'aksi', title: 'Tindakan', render: (r) => canUpdate || canDelete ? <div className="row-actions">
        {canUpdate && <><button className="button button-light button-small" onClick={() => begin(r)} disabled={busy}>Ubah</button><button className="text-button" onClick={() => toggle(r)} disabled={busy}>{r.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button></>}
        {canDelete && <button className="button button-danger button-small" type="button" onClick={() => beginDelete(r)} disabled={busy}>Hapus</button>}
      </div> : <small>Hanya baca</small> },
    ]} />
    {open && <Dialog title={edit ? `Ubah ${title.toLowerCase()}` : `Tambah ${title.toLowerCase()}`} onClose={() => { if (!busy) setOpen(false); }}><form onSubmit={save}><Notice error>{formError}</Notice><fieldset disabled={busy} className="form-grid">
      <Field title={unit ? "Singkatan" : "Kode"} hint={unit ? "Contoh: SARPRAS atau TU." : "Huruf kecil, angka, dan tanda hubung. Contoh: izin."}><input required maxLength={unit ? 20 : 40} pattern={unit ? "[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*" : "[a-z0-9]+(-[a-z0-9]+)*"} value={form.kode} onChange={(e) => setForm({ ...form, kode: e.target.value })} /></Field>
      <Field title="Nama"><input required maxLength={120} value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} /></Field>
      {!unit && <div className="full-width"><Field title="Keterangan (opsional)"><textarea rows={3} maxLength={500} value={form.keterangan} onChange={(e) => setForm({ ...form, keterangan: e.target.value })} /></Field></div>}
      <label><input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} /> Aktif untuk entri baru</label>
    </fieldset><div className="form-actions"><button className="button button-light" type="button" disabled={busy} onClick={() => setOpen(false)}>Batal</button><button className="button" disabled={busy}>{busy ? 'Menyimpan...' : unit ? 'Simpan unit' : 'Simpan jenis'}</button></div></form></Dialog>}
    {canDelete && targetHapus && <Dialog title={`Hapus ${title.toLowerCase()}`} onClose={() => { if (!busy) setTargetHapus(null); }}>
      <form onSubmit={remove} aria-busy={busy}>
        <p><strong>{targetHapus.nama}</strong> akan dihapus permanen. Jika entri masih digunakan, pilih Nonaktifkan untuk menjaga riwayatnya.</p>
        <Notice error>{errorHapus}</Notice>
        <Field title={<>Ketik <strong>{KONFIRMASI_HAPUS}</strong> persis untuk melanjutkan.</>}>
          <input aria-label="Konfirmasi hapus katalog" autoComplete="off" autoCapitalize="off" spellCheck={false} value={konfirmasi} onChange={(e) => setKonfirmasi(e.target.value)} disabled={busy} />
        </Field>
        <div className="form-actions">
          <button className="button button-light" type="button" disabled={busy} onClick={() => setTargetHapus(null)}>Batal</button>
          <button className="button button-danger" type="submit" disabled={busy || konfirmasi !== KONFIRMASI_HAPUS}>{busy ? 'Menghapus...' : 'Hapus permanen'}</button>
        </div>
      </form>
    </Dialog>}
  </>;
}

