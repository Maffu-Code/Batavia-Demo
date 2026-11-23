import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Dialog, Icon, PERAN } from './components/Ui.jsx';
import Login from './pages/Login.jsx';
import Beranda from './pages/Beranda.jsx';
import Katalog from './pages/Katalog.jsx';
import Surat from './pages/Surat.jsx';
import Disposisi from './pages/Disposisi.jsx';
import Pengguna from './pages/Pengguna.jsx';
import Aktivitas from './pages/Aktivitas.jsx';
import Arsip from './pages/Arsip.jsx';
import Notifikasi from './components/Notifikasi.jsx';
import './operasional.css';

const PERAN_ARSIP = ['superadmin', 'tata_usaha', 'kepala_sekolah', 'kepala_bagian'];

// Adaptasi GRUP_MENU + Layout Midas, domain dan izin tetap milik Batavia.
const MENU = [
  { title: '', items: [['/beranda', 'Dashboard', 'dashboard']] },
  { title: 'Katalog', items: [['/katalog/surat', 'Jenis Surat', 'katalog', 'jenis_surat'], ['/katalog/arsip', 'Jenis Arsip', 'katalog', 'jenis_arsip'], ['/katalog/unit', 'Unit Kerja', 'pengguna', 'bagian']] },
  { title: 'Persuratan', items: [['/surat/masuk', 'Surat Masuk', 'masuk', 'surat_masuk'], ['/surat/keluar', 'Surat Keluar', 'keluar', 'surat_keluar'], ['/disposisi', 'Disposisi', 'disposisi', 'disposisi'], ['/arsip', 'Arsip Surat', 'katalog', 'arsip']] },
  { title: 'Penugasan', items: [['/penugasan', 'Penugasan Saya', 'disposisi', 'penugasan']] },
  { title: 'Administrasi', admin: true, items: [['/pengguna', 'Manajemen User', 'pengguna'], ['/aktivitas', 'Aktivitas Sistem', 'aktivitas']] },
];

function Sidebar({ onNavigate }) {
  const { user, boleh } = useAuth();
  const tampil = (r) => r === 'arsip' ? PERAN_ARSIP.includes(user.peran) && (boleh('surat_masuk', 'read') || boleh('surat_keluar', 'read')) : r === 'penugasan' ? ['kepala_bagian', 'guru_staf'].includes(user.peran) && boleh('disposisi', 'read') : (!r || boleh(r, 'read')) && (r !== 'disposisi' || user.peran !== 'guru_staf');
  return <nav className="sidebar" aria-label="Navigasi utama">
    <Link to="/beranda" className="brand" onClick={onNavigate}><span className="brand-mark" aria-hidden="true">B</span><span><strong>Batavia</strong><small>PERSURATAN & ARSIP DIGITAL</small></span></Link>
    <div className="sidebar-nav">{MENU.filter((g) => !g.admin || user.peran === 'superadmin').map((g) => ({ ...g, items: g.items.filter(([, , , resource]) => tampil(resource)) })).filter((g) => g.items.length).map((g) => <div className="nav-group" key={g.title || 'utama'}>{g.title && <p className="nav-label">{g.title}</p>}{g.items.map(([to, text, icon]) => <NavLink key={to} to={to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={onNavigate}><Icon nama={icon} /><span>{text}</span></NavLink>)}</div>)}</div>
    <div className="sidebar-footer">Lab lokal · Data sintetis<br />SMKIT Said Naum Jakarta</div>
  </nav>;
}

function Terlindung() {
  const { user, memulihkan, izinSiap, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => { setMenu(false); document.querySelector('.main-scroll')?.scrollTo(0, 0); }, [location.pathname]);
  if (memulihkan || (user && !izinSiap)) return <p className="empty-state" role="status">Menyiapkan ruang kerja...</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <div className="app-shell">
    <a className="skip-link" href="#konten">Lewati navigasi</a>
    <aside className="desktop-sidebar"><Sidebar /></aside>
    {menu && <div className="drawer"><Dialog title="Menu Batavia" onClose={() => setMenu(false)}><Sidebar onNavigate={() => setMenu(false)} /></Dialog></div>}
    <div className="workspace">
      <header className="topbar"><div className="school"><button className="icon-button mobile-button" onClick={() => setMenu(true)} aria-label="Buka menu"><Icon nama="menu" /></button><Icon nama="katalog" /><span>SMKIT Said Naum Jakarta</span></div><div className="account">{['kepala_bagian', 'guru_staf'].includes(user.peran) && <Notifikasi />}<div className="avatar" aria-hidden="true">{user.nama?.replace(/^\[SINTETIS\]\s*/, '')?.[0] || 'B'}</div><div><strong>{user.nama}</strong><small>{PERAN[user.peran] || user.peran}</small></div><button className="button button-light button-small" type="button" onClick={logout}>Keluar</button></div></header>
      <div className="lab-strip"><span>Lingkungan demo dan uji · Bukan data sekolah</span><span>Akses mengikuti peran dan penugasan</span></div>
      <main id="konten" tabIndex={-1} className="main-scroll"><div className="page"><Outlet /></div></main>
    </div>
  </div>;
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<Login />} />
    <Route element={<Terlindung />}>
      <Route path="/beranda" element={<Beranda />} />
      <Route path="/katalog/:jenis" element={<Katalog />} />
      <Route path="/surat/:jenis" element={<Surat />} />
      <Route path="/disposisi" element={<Disposisi />} />
      <Route path="/penugasan" element={<Disposisi penugasan />} />
      <Route path="/arsip" element={<Arsip />} />
      <Route path="/pengguna" element={<Pengguna />} />
      <Route path="/aktivitas" element={<Aktivitas />} />
    </Route>
    <Route path="*" element={<Navigate to="/beranda" replace />} />
  </Routes>;
}
