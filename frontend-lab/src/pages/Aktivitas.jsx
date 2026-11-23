import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { DataTable, Notice, PageHeader, tanggalWaktu, label, pesanError } from '../components/Ui.jsx';

const ENTITAS = ['surat_masuk', 'surat_keluar', 'disposisi', 'lampiran', 'user'].map((value) => ({ value, label: label(value) }));
const AKSI = Object.entries({ create: 'Membuat', update: 'Mengubah', login_sukses: 'Login berhasil', login_gagal: 'Login gagal' }).map(([value, label]) => ({ value, label }));

export default function Aktivitas() {
  const { user, boleh } = useAuth();
  const dapatBaca = user.peran === 'superadmin' && boleh('activity_log', 'read');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [filter, setFilter] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQuery(search.trim().slice(0, 150)); setPage(1); }, 250); return () => clearTimeout(t); }, [search]);
  useEffect(() => {
    if (!dapatBaca) return;
    const controller = new AbortController();
    if (filter.dari && filter.sampai && filter.dari > filter.sampai) { setRows([]); setMeta(null); setLoading(false); setError('Tanggal awal tidak boleh melebihi tanggal akhir.'); return; }
    setLoading(true); setError('');
    api.get('/aktivitas', { params: { q: query, ...filter, page, limit }, signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      if (data.meta?.total_pages > 0 && page > data.meta.total_pages) { setPage(data.meta.total_pages); return; }
      setRows(data.data || []); setMeta(data.meta || null);
    }).catch((e) => { if (!controller.signal.aborted) { setError(pesanError(e)); setMeta(null); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, filter, page, limit, reload, dapatBaca]);
  if (!dapatBaca) return <Notice error>Anda tidak memiliki izin membaca Aktivitas Sistem.</Notice>;
  return <><PageHeader title="Aktivitas Sistem" description="Jejak tindakan pengguna untuk menelusuri perubahan. Log ini bukan jaminan audit anti-rusak." /><DataTable rows={rows} loading={loading} error={error} onRetry={() => setReload((n) => n + 1)} search={search} onSearch={setSearch} meta={meta} onPage={setPage} limit={limit} onLimit={(n) => { setLimit(n); setPage(1); }} filters={{ values: filter, fields: [{ key: 'entitas', title: 'Data', options: ENTITAS }, { key: 'aksi', title: 'Tindakan', options: AKSI }, { key: 'dari', title: 'Dari tanggal', type: 'date' }, { key: 'sampai', title: 'Sampai tanggal', type: 'date' }] }} onFilters={(v) => { setFilter(v); setPage(1); }} columns={[
    { key: 'created_at', title: 'Waktu', render: (r) => tanggalWaktu(r.created_at) }, { key: 'nama_user', title: 'Pengguna' }, { key: 'aksi', title: 'Tindakan', render: (r) => AKSI.find((a) => a.value === r.aksi)?.label || label(r.aksi) }, { key: 'entitas', title: 'Data', render: (r) => label(r.entitas) }, { key: 'detail', title: 'Keterangan' },
  ]} /></>;
}
