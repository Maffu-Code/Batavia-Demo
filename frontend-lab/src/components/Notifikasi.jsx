import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Dialog, Icon, Notice, pesanError, tanggal } from './Ui.jsx';

export default function Notifikasi() {
  const { user, boleh } = useAuth();
  if (!user || !boleh('disposisi', 'read')) return null;
  return <KotakNotifikasi key={user.id} />;
}

function KotakNotifikasi() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const request = useRef(null);
  const saving = useRef(null);
  useEffect(() => () => saving.current?.abort(), []);
  useEffect(() => {
    function load() {
      if (saving.current) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      api.get('/notifikasi', { signal: controller.signal }).then((r) => {
        if (!controller.signal.aborted) { setData(r.data.data); setError(''); }
      }).catch((e) => { if (!controller.signal.aborted) setError(pesanError(e)); });
    }
    load();
    const timer = setInterval(load, 60000);
    return () => { clearInterval(timer); request.current?.abort(); };
  }, [refresh]);

  async function tandai(id) {
    if (saving.current) return;
    request.current?.abort();
    const controller = new AbortController();
    saving.current = controller;
    setBusy(id); setError('');
    try {
      await api.patch(`/notifikasi/${encodeURIComponent(id)}`, {}, { signal: controller.signal });
      if (!controller.signal.aborted) setData((prev) => prev && ({ total: Math.max(0, prev.total - 1), items: prev.items.filter((item) => item.id !== id) }));
    } catch (e) {
      if (!controller.signal.aborted) {
        if ([404, 409].includes(e.response?.status)) setRefresh((n) => n + 1);
        else setError(pesanError(e));
      }
    } finally {
      saving.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  const total = data?.total || 0;
  return <>
    <button type="button" className="icon-button notifikasi-trigger" aria-label={total ? `Notifikasi, ${total} belum dibaca` : 'Notifikasi'} aria-haspopup="dialog" onClick={() => { setOpen(true); setRefresh((n) => n + 1); }}><Icon nama="notifikasi" />{total > 0 && <span className="notifikasi-count" aria-hidden="true">{total > 99 ? '99+' : total}</span>}</button>
    {open && <Dialog title="Notifikasi penugasan" onClose={() => setOpen(false)}>
      <Notice error>{error}</Notice>
      {error && <button type="button" className="button button-light" onClick={() => setRefresh((n) => n + 1)}>Coba lagi</button>}
      {!data && !error && <p className="empty-state" role="status">Memuat notifikasi...</p>}
      {data && <>
        {!data.items.length ? <p className="empty-state">Tidak ada notifikasi yang belum dibaca.</p> : <ul className="notifikasi-list">{data.items.slice(0, 10).map((item) => <li key={item.id}>
          <div><Link className="text-button" to={`/penugasan?disposisi=${encodeURIComponent(item.disposisi_id)}`} onClick={() => setOpen(false)}>{item.judul || 'Penugasan baru'}</Link><small>{tanggal(item.created_at)}</small></div>
          <button type="button" className="button button-light button-small" disabled={busy !== null} onClick={() => tandai(item.id)}>{busy === item.id ? 'Menyimpan...' : 'Tandai dibaca'}</button>
        </li>)}</ul>}
        {total > data.items.length && <p className="empty-state">Menampilkan 10 notifikasi terbaru. Tandai sebagai dibaca lalu segarkan untuk melihat sisanya.</p>}
        <div className="form-actions"><button type="button" className="button button-light" disabled={busy !== null} onClick={() => setRefresh((n) => n + 1)}>Segarkan</button><Link className="button" to="/penugasan" onClick={() => setOpen(false)}>Lihat penugasan</Link></div>
      </>}
    </Dialog>}
  </>;
}
