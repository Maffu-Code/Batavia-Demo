import { useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Icon, Notice, pesanError } from '../components/Ui.jsx';
import './login.css';

const FITUR = [
  ['kunci', 'Akses berjenjang', 'Izin mengikuti peran, unit, dan penugasan.'],
  ['katalog', 'Arsip terstruktur', 'Catat dan kelompokkan surat masuk dan keluar.'],
  ['cari', 'Temu kembali', 'Telusuri nomor, perihal, atau klasifikasi surat.'],
];

export default function Login() {
  const { user, login, memulihkan } = useAuth();
  const passwordField = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [visible, setVisible] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function kirim(event) {
    event.preventDefault();
    if (busy || memulihkan) return;
    setBusy(true); setError('');
    try { await login(email.trim(), password, remember); }
    catch (e) { setError(pesanError(e)); }
    finally { setBusy(false); }
  }
  if (user) return <Navigate to="/beranda" replace />;
  return <div className="portal">
    <aside className="portal-identity" aria-label="Tentang Batavia">
      <div className="portal-brand">
        <span className="portal-emblem" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="8" y="8" width="24" height="24" rx="2"/><rect x="8" y="8" width="24" height="24" rx="2" transform="rotate(45 20 20)"/><path d="M12 16q4-2 8 1 4-3 8-1v9q-4-2-8 1-4-3-8-1zm8 1v9" strokeLinejoin="round"/></svg></span>
        <span><small>BATAVIA · PERSURATAN DIGITAL</small><strong>SMKIT Said Naum</strong></span>
      </div>
      <div className="portal-intro">
        <span className="portal-tag">Sistem Kearsipan Digital Terpadu</span>
        <h1>Pengelolaan Arsip &amp; Dokumen Administrasi Sekolah</h1>
        <p>Portal persuratan, disposisi, dan penelusuran arsip untuk Tata Usaha, pimpinan, serta unit sekolah.</p>
        <ul className="portal-features">{FITUR.map(([icon, title, description]) => <li key={title}><div><Icon nama={icon} width={16} height={16} /><strong>{title}</strong></div><p>{description}</p></li>)}</ul>
      </div>
      <div className="portal-brand-footer"><span>Persuratan dan arsip sekolah</span><span>Jakarta Pusat</span></div>
    </aside>
    <main className="portal-auth">
      <div className="portal-environment">Lingkungan uji coba lokal</div>
      <section className="portal-card" aria-labelledby="portal-title">
        <p className="portal-greeting">Assalamu’alaikum Warahmatullahi Wabarakatuh</p>
        <h2 id="portal-title">Masuk ke Portal Arsip</h2>
        <p className="portal-description">Gunakan akun Batavia untuk membuka ruang kerja Anda.</p>
        <div className="portal-demo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v6m0-9v1"/></svg><p><strong>Pratinjau lokal.</strong> Akun sintetis tersedia setelah penyiapan dengan <code>--demo</code>. Gunakan kata sandi dari panduan setup atau pengelola lab.</p></div>
        <form onSubmit={kirim}>
          <div className="portal-field">
            <div className="portal-field-label"><label htmlFor="login-email">Alamat email</label><button type="button" className="portal-link" onClick={() => { setEmail('randy.septo.anggara@contoh.batavia.invalid'); passwordField.current?.focus(); }}>Isi email demo</button></div>
            <div className="portal-input"><Icon nama="surat" /><input id="login-email" name="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@contoh.id" required /></div>
          </div>
          <div className="portal-field">
            <div className="portal-field-label"><label htmlFor="login-password">Kata sandi</label><button type="button" className="portal-link" aria-expanded={help} onClick={() => setHelp(!help)}>Lupa kata sandi?</button></div>
            <div className="portal-input"><Icon nama="kunci" /><input id="login-password" name="password" ref={passwordField} type={visible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Masukkan kata sandi" required /><button type="button" className="icon-button" aria-label={visible ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} onClick={() => setVisible(!visible)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>{visible && <path d="m3 3 18 18"/>}</svg></button></div>
          </div>
          <label className="portal-remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Ingat sesi perangkat ini</label>
          {help && <Notice>Hubungi Superadmin untuk pengaturan ulang kata sandi.</Notice>}<Notice error>{error}</Notice>
          <button type="submit" className="button portal-submit" disabled={busy || memulihkan}>{busy ? 'Memverifikasi...' : memulihkan ? 'Memulihkan sesi...' : 'Masuk ke Sistem Arsip'}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 12h17m-6-6 6 6-6 6"/></svg></button>
        </form>
      </section>
      <footer className="portal-footer"><strong>Batavia · SMKIT Said Naum</strong><span>Unit Tata Usaha &amp; Kearsipan Digital</span></footer>
    </main>
  </div>;
}
