import axios from 'axios';
import { getSocketId } from './socket';

const api = axios.create({ baseURL: `${import.meta.env.VITE_API_URL || ''}/api` });

// Request context is held in module state so every call carries it automatically.
const ctx = { token: localStorage.getItem('kanban.token'), tenantId: null };

export function setToken(token) {
  ctx.token = token;
  if (token) localStorage.setItem('kanban.token', token);
  else localStorage.removeItem('kanban.token');
}
export const getToken = () => ctx.token;

/** The active tenant. The server re-verifies membership on every request. */
export function setActiveTenant(tenantId) {
  ctx.tenantId = tenantId;
}

api.interceptors.request.use((config) => {
  if (ctx.token) config.headers.Authorization = `Bearer ${ctx.token}`;
  if (ctx.tenantId && !config.headers['X-Tenant-Id']) config.headers['X-Tenant-Id'] = ctx.tenantId;
  const sid = getSocketId();
  if (sid) config.headers['X-Socket-Id'] = sid;
  return config;
});

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && ctx.token) onUnauthorized();
    return Promise.reject(err);
  }
);

export function errorMessage(err) {
  const data = err?.response?.data;
  if (data?.errors?.length) return data.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
  return data?.error || err?.message || 'Something went wrong';
}

export default api;
