import axios from 'axios';

const BASE = import.meta.env.VITE_API_BASE || '/api';
const KEY = 'memoria_token';
const listeners = new Set();
const storage = (name) => { try { return window[name]; } catch { return null; } };
const local = storage('localStorage');
const session = storage('sessionStorage');
const read = (store) => { try { return store?.getItem(KEY) ?? null; } catch { return null; } };
const write = (store, value) => {
  try { if (value) store?.setItem(KEY, value); else store?.removeItem(KEY); } catch { /* Sesi tetap di memori. */ }
};
let token = read(local) || read(session);
let persistent = Boolean(read(local));

export function getToken() { return token; }

function update(next) {
  if (token === next) return;
  token = next;
  listeners.forEach((fn) => fn(token));
}

export function setToken(next, remember = false) {
  persistent = Boolean(next && remember);
  write(local, persistent ? next : null);
  write(session, next && !remember ? next : null);
  update(next);
}

export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

window.addEventListener('storage', (event) => {
  if (event.storageArea !== local || (event.key !== KEY && event.key !== null) || (token && !persistent)) return;
  const next = read(local);
  persistent = Boolean(next);
  update(next);
});

const api = axios.create({ baseURL: BASE });
api.interceptors.request.use((config) => {
  if (token && config.url !== '/auth/login') {
    config.sessionToken = token;
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
api.interceptors.response.use((res) => res, (error) => {
  // Respons lama atau gagal login tidak boleh mengakhiri sesi yang lebih baru.
  if (error.response?.status === 401 && error.config?.sessionToken && error.config.sessionToken === token) setToken(null);
  return Promise.reject(error);
});

export default api;
