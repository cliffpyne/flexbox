// ─── Auth session token ───────────────────────────────────────────────────────
export interface AuthModel {
  access_token: string;
  refresh_token?: string;
}

// ─── FlexSend user roles ──────────────────────────────────────────────────────
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

// ─── User model ───────────────────────────────────────────────────────────────
export interface UserModel {
  // Core identity
  id: string;              // maps to user_id
  email?: string;          // not used in FlexSend but kept for Metronic compat
  username: string | null;
  phone: string;
  full_name: string | null;

  // Role & access
  role: UserRole;
  office_id: string | null;
  permissions: string[];
  is_admin: boolean;       // true for OPS_ADMIN and SUPER_ADMIN

  // First login flag
  must_change_password: boolean;
  is_active: boolean;

  // Metronic compatibility fields (used in profile UI)
  first_name: string;
  last_name: string;
  fullname?: string;
  pic?: string;
  language?: string;
  occupation?: string;
  company_name?: string;
  companyName?: string;
  roles?: number[];
  email_verified?: boolean;
  password?: string;
  last_login_at?: string;
}

// ─── Role labels ──────────────────────────────────────────────────────────────
export const ROLE_LABELS: Record<UserRole, string> = {
  CUSTOMER:        'Customer',
  AGENT:           'Agent',
  RIDER:           'Rider',
  OFFICE_WORKER:   'Office Worker',
  OFFICE_MANAGER:  'Office Manager',
  BRANCH_MANAGER:  'Branch Manager',
  SUPPORT_AGENT:   'Support Agent',
  PRICING_MANAGER: 'Pricing Manager',
  OPS_ADMIN:       'Operations Admin',
  SUPER_ADMIN:     'Super Admin',
};

// Roles that can access the dashboard
export const DASHBOARD_ROLES: UserRole[] = [
  'OFFICE_WORKER',
  'OFFICE_MANAGER',
  'BRANCH_MANAGER',
  'SUPPORT_AGENT',
  'PRICING_MANAGER',
  'OPS_ADMIN',
  'SUPER_ADMIN',
];
