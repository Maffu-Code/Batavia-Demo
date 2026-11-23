import { useEffect, useRef, useState } from 'react';
import api from '../services/api.js';
import { Notice, pesanError } from './Ui.jsx';

const namaAman = (nama) => String(nama || 'lampiran').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'lampiran';

export default function DaftarLampiran({ items = [], dapatUnduh = false }) {
  const [downloadId, setDownloadId] = useState(null);
  const [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  async function unduh(item) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setDownloadId(item.id); setError('');
    try {
      const { data } = await api.get(`/lampiran/${encodeURIComponent(item.id)}`, { responseType: 'blob', signal: controller.signal });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = namaAman(item.nama_asli);
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      let message = pesanError(e);
      if (e.response?.data instanceof Blob) {
        try { message = JSON.parse(await e.response.data.text()).message || message; } catch { /* Keep the connection error. */ }
      }
      if (!controller.signal.aborted) setError(message);
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setDownloadId(null);
    }
  }

  return <>
    <Notice error>{error}</Notice>
    {!items.length ? <p className="empty-state">Belum ada lampiran yang dapat Anda lihat.</p> : <ul>{items.map((item) => <li key={item.id} className="row-actions" style={{ marginTop: 12 }}><span>{namaAman(item.nama_asli)}{Number.isFinite(item.ukuran_byte) ? ` (${Math.ceil(item.ukuran_byte / 1024)} KB)` : ''}</span>{dapatUnduh && <button type="button" className="button button-light button-small" disabled={Boolean(downloadId)} onClick={() => unduh(item)}>{downloadId === item.id ? 'Mengunduh...' : 'Unduh'}</button>}</li>)}</ul>}
  </>;
}
