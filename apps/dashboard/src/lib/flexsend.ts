// ─── FlexSend API client ──────────────────────────────────────────────────────
// Replaces the Supabase client. All calls to FlexSend microservices go through here.

export const FLEXSEND_URLS = {
  auth:    import.meta.env.VITE_AUTH_SERVICE_URL    || 'https://flexboxauth-service-production.up.railway.app',
  office:  import.meta.env.VITE_OFFICE_SERVICE_URL  || 'https://flexboxoffice-service-production.up.railway.app',
  parcel:  import.meta.env.VITE_PARCEL_SERVICE_URL  || 'https://flexboxparcel-service-production.up.railway.app',
  routing: import.meta.env.VITE_ROUTING_SERVICE_URL || 'https://flexboxrouting-service-production.up.railway.app',
};

// ─── Typed fetch wrapper ──────────────────────────────────────────────────────
export async function flexsendFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const res  = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Request failed');
  return data.data as T;
}

// ─── Auth service calls ───────────────────────────────────────────────────────
export const flexsendAuth = {
  login: (username: string, password: string) =>
    flexsendFetch<{ access_token: string; refresh_token: string; must_change_password: boolean; user: any }>(
      `${FLEXSEND_URLS.auth}/auth/password/login`,
      { method: 'POST', body: JSON.stringify({ username, password }) }
    ),

  me: (token: string) =>
    flexsendFetch<any>(
      `${FLEXSEND_URLS.auth}/auth/me`,
      { headers: { Authorization: `Bearer ${token}` } }
    ),

  logout: (token: string) =>
    fetch(`${FLEXSEND_URLS.auth}/auth/logout`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {}),

  changePassword: (token: string, current_password: string, new_password: string) =>
    flexsendFetch(
      `${FLEXSEND_URLS.auth}/auth/password/change`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ current_password, new_password }),
      }
    ),

  forgotPassword: (phone: string) =>
    fetch(`${FLEXSEND_URLS.auth}/auth/password/forgot`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone }),
    }),
};
