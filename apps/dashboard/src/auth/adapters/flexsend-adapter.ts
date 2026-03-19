import { AuthModel, UserModel, DASHBOARD_ROLES } from '@/auth/lib/models';
import { flexsendAuth } from '@/lib/flexsend';

/**
 * FlexSend adapter — same interface as the Supabase adapter
 * but calls FlexSend auth-service instead.
 */
export const FlexSendAdapter = {

  // ─── Login with username + password ────────────────────────────────────────
  async login(username: string, password: string): Promise<AuthModel & { must_change_password: boolean }> {
    const data = await flexsendAuth.login(username, password);
    return {
      access_token:         data.access_token,
      refresh_token:        data.refresh_token,
      must_change_password: data.must_change_password ?? false,
    };
  },

  // ─── Get current user from token ───────────────────────────────────────────
  async getCurrentUser(token: string): Promise<UserModel | null> {
    try {
      const user = await flexsendAuth.me(token);
      return FlexSendAdapter.transformUser(user);
    } catch {
      return null;
    }
  },

  // ─── Transform FlexSend user → UserModel ───────────────────────────────────
  transformUser(raw: any): UserModel {
    const fullName = raw.full_name || '';
    const parts    = fullName.split(' ');

    return {
      id:                   raw.user_id,
      username:             raw.username,
      phone:                raw.phone,
      full_name:            raw.full_name,
      role:                 raw.role,
      office_id:            raw.office_id,
      permissions:          raw.permissions || [],
      is_admin:             ['OPS_ADMIN', 'SUPER_ADMIN'].includes(raw.role),
      must_change_password: raw.must_change_password ?? false,
      is_active:            raw.is_active ?? true,
      last_login_at:        raw.last_login_at,

      // Metronic compatibility
      email:          raw.email || raw.phone,
      first_name:     parts[0] || '',
      last_name:      parts.slice(1).join(' ') || '',
      fullname:       fullName,
      pic:            raw.pic || '',
      language:       'en',
      occupation:     ROLE_LABELS[raw.role as keyof typeof ROLE_LABELS] || raw.role,
      company_name:   'FlexSend',
      companyName:    'FlexSend',
      roles:          [],
      email_verified: true,
    };
  },

  // ─── Logout ────────────────────────────────────────────────────────────────
  async logout(token: string): Promise<void> {
    await flexsendAuth.logout(token);
  },

  // ─── Change password ───────────────────────────────────────────────────────
  async changePassword(
    token: string,
    current_password: string,
    new_password: string,
  ): Promise<void> {
    await flexsendAuth.changePassword(token, current_password, new_password);
  },

  // ─── Forgot password ───────────────────────────────────────────────────────
  async forgotPassword(phone: string): Promise<void> {
    await flexsendAuth.forgotPassword(phone);
  },
};

// Import for occupation label
import { ROLE_LABELS } from '@/auth/lib/models';
