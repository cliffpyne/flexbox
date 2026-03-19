import { AuthModel } from './models';

const AUTH_KEY = 'fs_auth';

// ─── Save auth to sessionStorage ──────────────────────────────────────────────
export function setAuth(auth: AuthModel): void {
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

// ─── Get auth from sessionStorage ─────────────────────────────────────────────
export function getAuth(): AuthModel | undefined {
  try {
    const stored = sessionStorage.getItem(AUTH_KEY);
    if (!stored) return undefined;
    return JSON.parse(stored) as AuthModel;
  } catch {
    return undefined;
  }
}

// ─── Remove auth from sessionStorage ──────────────────────────────────────────
export function removeAuth(): void {
  sessionStorage.removeItem(AUTH_KEY);
}
