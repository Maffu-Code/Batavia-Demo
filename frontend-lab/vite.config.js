import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api untuk lab lokal. Backend mengizinkan origin loopback secara otomatis.
export default defineConfig({
  plugins: [react()],
  server: {
    // Hanya loopback. Jangan pakai host: true / --host 0.0.0.0:
    // dev server Vite yang terbuka ke jaringan menjadi target pencurian
    // berkas (CVE-2026-112946, Oktober 2026).
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:6080' },
  },
});
