declare const __DEV__: any;
import axios, { AxiosInstance } from 'axios';

export const getBaseURL = () => {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    return "http://10.0.2.2:4000";
  }
  return process.env.API_BASE_URL || "https://your-app.up.railway.app";
};

export const createApiClient = (getToken: () => Promise<string | null>): AxiosInstance => {
  const client = axios.create({
    baseURL: getBaseURL(),
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
  });

  client.interceptors.request.use(async (config) => {
    const token = await getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  return client;
};
