/**
 * AuthContext: siapa yang login, matriks izin, re-fetch berkala.
 *
 * Mirip pola wms-Midas. `izinSiap` menahan render sampai percobaan
 * pengambilan matriks selesai (sukses atau gagal), supaya tombol yang
 * seharusnya tersembunyi tidak sempat berkedip.
 */
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from 'react';
import api, { getToken, onSessionChange, setToken } from '../services/api.js';

const AuthContext = createContext(null);
const PERUBAHAN_AKUN = 'batavia:perubahan-akun';

export function siarkanPerubahanAkun() {
  // Sinyal invalidasi saja: tidak memuat token, identitas, atau matriks izin.
  try {
    window.localStorage.setItem(PERUBAHAN_AKUN, '1');
    window.localStorage.removeItem(PERUBAHAN_AKUN);
  } catch { /* Polling tetap berjalan jika storage tidak tersedia. */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [izin, setIzin] = useState(null);
  const [izinSiap, setIzinSiap] = useState(false);
  const [memulihkan, setMemulihkan] = useState(true);
  const [gagalIzin, setGagalIzin] = useState(false);

  const request = useRef(0);
  const pending = useRef(false);
  const segarkanIzin = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const id = ++request.current;
    pending.current = true;
    const isCurrent = () => id === request.current && token === getToken();
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    try {
      const { data } = await api.get('/auth/izin-saya', { timeout: 8000 });
      if (!isCurrent()) return;
      setUser((old) => same(old, data.data.user) ? old : data.data.user);
      setIzin((old) => same(old, data.data.izin) ? old : data.data.izin || {});
      setGagalIzin(false);
    } catch (e) {
      if (!isCurrent()) return;
      if (e.response?.status === 403) setToken(null);
      else { setIzin(null); setGagalIzin(true); }
    } finally {
      if (isCurrent()) { pending.current = false; setIzinSiap(true); setMemulihkan(false); }
    }
  }, []);

  useEffect(() => {
    function sync(token) {
      request.current += 1;
      pending.current = false;
      setUser(null); setIzin(null); setIzinSiap(false); setGagalIzin(false);
      setMemulihkan(Boolean(token));
      if (token) void segarkanIzin();
    }
    const unsubscribe = onSessionChange(sync);
    const berubah = (event) => {
      if (event.key === PERUBAHAN_AKUN && event.newValue === '1') void segarkanIzin();
    };
    window.addEventListener('storage', berubah);
    sync(getToken());
    return () => { request.current += 1; unsubscribe(); window.removeEventListener('storage', berubah); };
  }, [segarkanIzin]);

  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible' && !pending.current) void segarkanIzin(); };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(visible, 5000);
    return () => { window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); clearInterval(timer); };
  }, [segarkanIzin]);

  const login = async (email, password, remember) => {
    const { data } = await api.post('/auth/login', { email, password });
    setToken(data.data.token, remember);
    setUser((old) => old || data.data.user);
  };

  const logout = () => setToken(null);

  const boleh = (resource, aksi) => {
    if (!izin) return false;
    const r = izin[resource];
    if (!r) return false;
    const a = r[aksi];
    if (!a) return false;
    return a.boleh === true || a === true;
  };

  // Perubahan hak baca/lingkup membuang data dan respons lama dari halaman terbuka.
  const cakupan = JSON.stringify([user?.id, user?.peran, user?.bagian_id,
    Object.keys(izin || {}).filter((resource) => boleh(resource, 'read')).sort()]);
  return (
    <AuthContext.Provider value={{
      user, izin, izinSiap, memulihkan,
      login, logout, segarkanIzin, boleh,
    }}>
      {gagalIzin ? <div className="empty-state">
        <p role="alert">Izin akses gagal dimuat. Data disembunyikan sampai izin dapat diperiksa kembali.</p>
        <button className="button button-light" type="button" onClick={segarkanIzin}>Coba lagi</button>{' '}
        <button className="button button-light" type="button" onClick={logout}>Keluar</button>
      </div> : <Fragment key={cakupan}>{children}</Fragment>}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return ctx;
}
