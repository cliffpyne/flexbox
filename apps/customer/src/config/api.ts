import axios from 'axios';
import { useAuthStore } from '../store/authStore';

export const BASE_URL = 'https://flexboxapi-gateway-production.up.railway.app';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((cfg) => {
  const token = useAuthStore.getState().token;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      await useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  }
);
