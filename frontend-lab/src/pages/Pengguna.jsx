import { useEffect, useState } from 'react';
import { siarkanPerubahanAkun, useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Badge, DataTable, Dialog, Field, Icon, Notice, PageHeader, PERAN, pesanError } from '../components/Ui.jsx';

const EMPTY = { nama_lengkap: '', email: '', password: '', peran: 'guru_staf', bagian_id: '', aktif: true, bisa_hapus: false };
const WAJIB_UNIT = new Set(['tata_usaha', 'kepala_bagian', 'guru_staf']);
const AKSI = ['create', 'read', 'update', 'delete'];

function Kendali({ target, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    api.get(`/pengguna/${target.id}/izin`).then((r) => { if (active) setDetail(r.data.data); }).catch((e) => { if (active) setError(pesanError(e)); });
    return () => { active = false; };
  }, [target.id]);
  async function change(resource, action, value) {
    setBusy(true); setError(''); setMessage('');
    try {
      const { data } = await api.patch(`/pengguna/${target.id}/izin`, { resource, action, allowed: value === 'default' ? null : value === 'true' });
      setDetail(data.data);
      siarkanPerubahanAkun();
      setMessage('Izin tersimpan. Permintaan berikutnya mengikuti aturan baru.');
    } catch (e) { setError(pesanError(e)); } finally { setBusy(false); }
  }
  return <Dialog wide title={`Kendali Akun: ${target.nama_lengkap}`} onClose={() => { if (!busy) onClose(); }}>
    <div className="panel-heading" style={{ padding: '0 0 18px', marginBottom: 18 }}><div><h2>{target.nama_lengkap}</h2><small>{target.email} · {PERAN[target.peran]}</small></div><Badge value={target.aktif ? 'aktif' : 'nonaktif'} /></div>
    <Notice error>{error}</Notice><Notice>{message}</Notice>
    <h2>Izin akses</h2><p className="page-description" style={{ marginBottom: 16 }}>Bawaan mengikuti peran. Izinkan atau Tolak menyimpan aturan khusus. Hak akses data tetap dibatasi unit dan penugasan; izin tidak membuka surat milik unit lain.</p>
    {detail ? <div className="table-scroll" tabIndex={0} aria-label="Matriks izin, gulir mendatar">
      <table style={{ minWidth: 760 }}>
        <thead><tr><th>Data / halaman</th>{AKSI.map((a) => <th key={a}>{detail.label_aksi?.[a] || a}</th>)}</tr></thead>
        <tbody>{Object.entries(detail.aksi).map(([resource, actions]) => <tr key={resource}>
          <td><strong>{detail.label_resource?.[resource] || resource}</strong></td>
          {AKSI.map((action) => {
            const cell = detail.izin?.[resource]?.[action];
            if (!actions.includes(action) || !cell) return <td key={action}>-</td>;
            const selected = cell.sumber === 'eksplisit' ? String(cell.boleh) : cell.sumber_asli === 'eksplisit' ? String(cell.boleh_asli) : 'default';
            const alasan = cell.sumber === 'role' ? 'dikunci oleh peran' : cell.sumber === 'induk' ? `tergantung ${cell.induk}` : cell.sumber === 'batas_hapus' ? 'akun tidak boleh menghapus' : cell.sumber;
            return <td key={action}>
              <select className="permission-select" aria-label={`${resource} ${action}`} value={selected} disabled={busy || cell.sumber === 'role'} onChange={(e) => change(resource, action, e.target.value)}>
                <option value="default">Bawaan</option><option value="true">Izinkan</option><option value="false">Tolak</option>
              </select>
              <small className="permission-result">{cell.boleh ? 'Diizinkan' : 'Ditolak'} · {alasan}</small>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div> : !error && <p role="status">Memuat matriks izin...</p>}
    {(detail?.user ?? target).peran === 'superadmin' && <p className="page-description">Superadmin adalah pengelola sistem. Izin ini dikunci agar sistem tidak kehilangan pengelola.</p>}
  </Dialog>;
}

export default function Pengguna() {
  const { user, segarkanIzin } = useAuth();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState({});
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(null);
  const [bagian, setBagian] = useState([]);
  const [reload, setReload] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQuery(search); setPage(1); }, 250); return () => clearTimeout(t); }, [search]);
  useEffect(() => {
    if (user.peran !== 'superadmin') return;
    let active = true; setLoading(true); setError('');
    api.get('/pengguna', { params: { q: query, ...filter, page, limit } }).then((r) => { if (active) { setRows(r.data.data); setMeta(r.data.meta); } }).catch((e) => { if (active) setError(pesanError(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, filter, page, limit, reload, user.peran]);
  useEffect(() => { if (user.peran === 'superadmin') api.get('/referensi').then((r) => setBagian(r.data.data.bagian || [])).catch((e) => setError(pesanError(e))); }, [user.peran]);
  const unitWajib = WAJIB_UNIT.has(form.peran);
  const unitAktif = bagian.some((b) => b.id === form.bagian_id);
  const perluUnitAktif = !edit || form.peran !== edit.peran || form.bagian_id !== (edit.bagian_id || '') || (!edit.aktif && form.aktif);
  function begin(item = null) { setEdit(item); setForm(item ? { nama_lengkap: item.nama_lengkap, email: item.email, password: '', peran: item.peran, bagian_id: item.bagian_id || '', aktif: item.aktif, bisa_hapus: item.bisa_hapus } : EMPTY); setFormError(''); setOpen(true); }
  async function save(e) {
    e.preventDefault(); setFormError('');
    if ((unitWajib && !form.bagian_id) || (form.bagian_id && perluUnitAktif && !unitAktif)) {
      setFormError('Pilih unit kerja aktif sebelum menyimpan akun.'); return;
    }
    setBusy(true);
    const body = { ...form, bagian_id: form.bagian_id || null };
    if (edit && !body.password) delete body.password;
    if (edit && body.bagian_id === edit.bagian_id) delete body.bagian_id;
    try {
      await api[edit ? 'patch' : 'post'](`/pengguna${edit ? `/${edit.id}` : ''}`, body);
      siarkanPerubahanAkun();
      if (edit?.id === user.id) void segarkanIzin();
      setOpen(false); setReload((n) => n + 1); setMessage('Data akun berhasil disimpan.');
    } catch (e) { setFormError(pesanError(e)); } finally { setBusy(false); }
  }
  async function toggle(item) {
    if (!item.aktif && WAJIB_UNIT.has(item.peran) && !bagian.some((b) => b.id === item.bagian_id)) {
      begin(item); setForm({ nama_lengkap: item.nama_lengkap, email: item.email, password: '', peran: item.peran, bagian_id: '', aktif: true, bisa_hapus: item.bisa_hapus });
      setFormError('Pilih unit kerja aktif untuk mengaktifkan kembali akun ini.'); return;
    }
    if (!window.confirm(`${item.aktif ? 'Nonaktifkan' : 'Aktifkan'} akun ${item.nama_lengkap}?`)) return;
    setBusy(true); setError('');
    try { await api.patch(`/pengguna/${item.id}`, { aktif: !item.aktif }); siarkanPerubahanAkun(); setReload((n) => n + 1); setMessage('Status akun berhasil diubah.'); }
    catch (e) { setError(pesanError(e)); } finally { setBusy(false); }
  }
  if (user.peran !== 'superadmin') return <Notice error>Manajemen User hanya tersedia untuk Superadmin.</Notice>;
  return <>
    <PageHeader eyebrow="Administrasi" title="Manajemen User" description="Kelola akun, unit kerja, status, dan izin akses. Kendali akun memisahkan aturan bawaan dari grant/revoke khusus." />
    <Notice>{message}</Notice>
    <DataTable rows={rows} loading={loading} error={error} onRetry={() => setReload((n) => n + 1)} search={search} onSearch={setSearch} meta={meta} onPage={setPage} limit={limit} onLimit={(v) => { setLimit(v); setPage(1); }} filters={{ values: filter, fields: [{ key: 'peran', title: 'Peran', options: Object.entries(PERAN).map(([value, label]) => ({ value, label })) }, { key: 'aktif', title: 'Status akun', options: [{ value: 'true', label: 'Aktif' }, { value: 'false', label: 'Nonaktif' }] }] }} onFilters={(v) => { setFilter(v); setPage(1); }} action={<button className="button" onClick={() => begin()}><Icon nama="tambah" />Tambah akun</button>} minWidth={980} columns={[
      { key: 'nama_lengkap', title: 'Nama / email', render: (r) => <><strong>{r.nama_lengkap}</strong><small>{r.email}</small></> }, { key: 'peran', title: 'Peran', render: (r) => PERAN[r.peran] || r.peran }, { key: 'bagian', title: 'Unit kerja', render: (r) => r.bagian?.nama || '-' }, { key: 'aktif', title: 'Status', render: (r) => <Badge value={r.aktif ? 'aktif' : 'nonaktif'} /> },
      { key: 'aksi', title: 'Tindakan', render: (r) => <div className="row-actions"><button className="button button-light button-small" onClick={() => setTarget(r)}>Kendali akun</button><button className="text-button" onClick={() => begin(r)}>Ubah data</button>{r.id !== user.id && <button className="text-button" disabled={busy} onClick={() => toggle(r)}>{r.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>}</div> },
    ]} />
    {open && <Dialog title={edit ? 'Ubah data akun' : 'Tambah akun'} onClose={() => { if (!busy) setOpen(false); }}><form onSubmit={save}><Notice error>{formError}</Notice><fieldset className="form-grid" disabled={busy}>
      <Field title="Nama lengkap"><input required maxLength={120} value={form.nama_lengkap} onChange={(e) => setForm({ ...form, nama_lengkap: e.target.value })} /></Field>
      <Field title="Email"><input type="email" required maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field title={edit ? 'Password baru (kosongkan bila tetap)' : 'Password awal'} hint="Minimal 12 karakter. Berikan langsung kepada pemilik akun."><input type="password" minLength={12} required={!edit} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
      <Field title="Peran"><select value={form.peran} disabled={edit?.id === user.id} onChange={(e) => {
        const peran = e.target.value;
        setForm({ ...form, peran, bagian_id: WAJIB_UNIT.has(peran) && unitAktif ? form.bagian_id : '' });
      }}>{Object.entries(PERAN).map(([v, name]) => <option key={v} value={v}>{name}</option>)}</select></Field>
      <Field title="Unit kerja" hint={unitWajib ? 'Wajib untuk Tata Usaha, Kepala Bagian, dan Guru/Staf.' : 'Peran ini tidak wajib memiliki unit.'}>
        <select required={unitWajib} value={form.bagian_id} onChange={(e) => setForm({ ...form, bagian_id: e.target.value })}>
          <option value="">{unitWajib ? 'Pilih unit kerja aktif' : 'Tidak ada unit'}</option>
          {form.bagian_id && !unitAktif && <option value={form.bagian_id} disabled={perluUnitAktif}>Unit saat ini (tidak aktif)</option>}
          {bagian.map((b) => <option key={b.id} value={b.id}>{b.nama}</option>)}
        </select>
      </Field>
      <label><input type="checkbox" checked={form.aktif} disabled={edit?.id === user.id} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} /> Akun aktif</label>
      <label><input type="checkbox" checked={form.bisa_hapus} onChange={(e) => setForm({ ...form, bisa_hapus: e.target.checked })} /> Izinkan hapus jika aksi didukung peran dan matriks</label>
    </fieldset><div className="form-actions"><button className="button button-light" type="button" disabled={busy} onClick={() => setOpen(false)}>Batal</button><button className="button" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan akun'}</button></div></form></Dialog>}
    {target && <Kendali target={target} onClose={() => setTarget(null)} />}
  </>;
}
