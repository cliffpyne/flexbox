import axios from 'axios';

const BASE_URL = __DEV__
  ? 'http://10.0.2.2:4000'
  : 'https://flexboxapi-gateway-production.up.railway.app';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Auto-attach JWT
api.interceptors.request.use(async (cfg) => {
  const { useAuthStore } = await import('../store/authStore');
  const token = useAuthStore.getState().token;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      const { useAuthStore } = await import('../store/authStore');
      await useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  }
);
