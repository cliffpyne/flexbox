import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────
export type UserRole =
  | 'CUSTOMER'
  | 'AGENT'
  | 'RIDER'
  | 'OFFICE_WORKER'
  | 'OFFICE_MANAGER'
  | 'BRANCH_MANAGER'
  | 'SUPPORT_AGENT'
  | 'PRICING_MANAGER'
  | 'OPS_ADMIN'
  | 'SUPER_ADMIN';

export interface AuthUser {
  user_id: string;
  username: string | null;
  phone: string;
  full_name: string | null;
  role: UserRole;
  office_id: string | null;
  must_change_password: boolean;
  is_active: boolean;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<{ must_change_password: boolean }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────
const AUTH_KEY = "flexbox_auth";

const AUTH_URL =
  import.meta.env.VITE_AUTH_SERVICE_URL ||
  "https://flexboxauth-service-production.up.railway.app";

// ─── Context ────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    refreshToken: null,
    isLoading: true,
  });

  // ─── Rehydrate (load from storage) ─────────────────────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(AUTH_KEY);

      if (stored) {
        const parsed = JSON.parse(stored);

        setState({
          user: parsed.user || null,
          accessToken: parsed.accessToken || null,
          refreshToken: parsed.refreshToken || null,
          isLoading: false,
        });
      } else {
        setState((s) => ({ ...s, isLoading: false }));
      }
    } catch (error) {
      console.error("Failed to parse auth storage:", error);
      localStorage.removeItem(AUTH_KEY);
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, []);

  // ─── Debug (remove later) ──────────────────────────────────────────────────
  useEffect(() => {
    console.log("AUTH STATE:", state);
  }, [state]);

  // ─── Login ─────────────────────────────────────────────────────────────────
  const login = async (username: string, password: string) => {
    const res = await fetch(`${AUTH_URL}/auth/password/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.message || "Login failed");
    }

    // Fetch full profile
    const meRes = await fetch(`${AUTH_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${data.data.access_token}`,
      },
    });

    const meData = await meRes.json();

    if (!meData.success) {
      throw new Error("Failed to load user profile");
    }

    const authData: AuthState = {
      user: meData.data as AuthUser,
      accessToken: data.data.access_token,
      refreshToken: data.data.refresh_token,
      isLoading: false,
    };

    // Save to storage
    localStorage.setItem(AUTH_KEY, JSON.stringify(authData));

    setState(authData);

    return {
      must_change_password: meData.data.must_change_password,
    };
  };

  // ─── Logout ────────────────────────────────────────────────────────────────
  const logout = () => {
    if (state.accessToken) {
      fetch(`${AUTH_URL}/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.accessToken}`,
        },
      }).catch(() => {});
    }

    localStorage.removeItem(AUTH_KEY);

    setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,
    });
  };

  // ─── Refresh User ──────────────────────────────────────────────────────────
  const refreshUser = async () => {
    if (!state.accessToken) return;

    try {
      const res = await fetch(`${AUTH_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${state.accessToken}`,
        },
      });

      const data = await res.json();

      if (data.success) {
        const updated: AuthState = {
          ...state,
          user: data.data as AuthUser,
        };

        localStorage.setItem(AUTH_KEY, JSON.stringify(updated));
        setState(updated);
      } else {
        logout(); // token invalid → force logout
      }
    } catch (error) {
      console.error("Failed to refresh user:", error);
      logout();
    }
  };

  // ─── Auth Flag ─────────────────────────────────────────────────────────────
  const isAuthenticated =
    !!state.accessToken &&
    !!state.user &&
    state.user.is_active === true;

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        refreshUser,
        isAuthenticated,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

// ─── Role Helpers ───────────────────────────────────────────────────────────
export const ROLE_LABELS: Record<UserRole, string> = {
  CUSTOMER: "Customer",
  AGENT: "Agent",
  RIDER: "Rider",
  OFFICE_WORKER: "Office Worker",
  OFFICE_MANAGER: "Office Manager",
  BRANCH_MANAGER: "Branch Manager",
  SUPPORT_AGENT: "Support Agent",
  PRICING_MANAGER: "Pricing Manager",
  OPS_ADMIN: "Operations Admin",
  SUPER_ADMIN: "Super Admin",
};

export const DASHBOARD_ROLES: UserRole[] = [
  "OFFICE_WORKER",
  "OFFICE_MANAGER",
  "BRANCH_MANAGER",
  "SUPPORT_AGENT",
  "PRICING_MANAGER",
  "OPS_ADMIN",
  "SUPER_ADMIN",
];