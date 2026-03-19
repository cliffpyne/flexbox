import { PropsWithChildren, useEffect, useState } from 'react';
import { FlexSendAdapter } from '@/auth/adapters/flexsend-adapter';
import { AuthContext } from '@/auth/context/auth-context';
import * as authHelper from '@/auth/lib/helpers';
import { AuthModel, UserModel, DASHBOARD_ROLES } from '@/auth/lib/models';

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<AuthModel | undefined>(authHelper.getAuth());
  const [currentUser, setCurrentUser] = useState<UserModel | undefined>();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setIsAdmin(currentUser?.is_admin === true);
  }, [currentUser]);

  const verify = async () => {
    if (auth?.access_token) {
      try {
        const user = await FlexSendAdapter.getCurrentUser(auth.access_token);
        if (user) {
          setCurrentUser(user);
        } else {
          saveAuth(undefined);
          setCurrentUser(undefined);
        }
      } catch {
        saveAuth(undefined);
        setCurrentUser(undefined);
      }
    }
  };

  const saveAuth = (auth: AuthModel | undefined) => {
    setAuth(auth);
    if (auth) {
      authHelper.setAuth(auth);
    } else {
      authHelper.removeAuth();
    }
  };

  const login = async (username: string, password: string) => {
    try {
      const result = await FlexSendAdapter.login(username, password);
      saveAuth({ access_token: result.access_token, refresh_token: result.refresh_token });
      const user = await FlexSendAdapter.getCurrentUser(result.access_token);
      setCurrentUser(user || undefined);
      if (user && !DASHBOARD_ROLES.includes(user.role)) {
        saveAuth(undefined);
        setCurrentUser(undefined);
        throw new Error('This portal is for FlexSend staff only. Please use the mobile app.');
      }
    } catch (error) {
      saveAuth(undefined);
      throw error;
    }
  };

  const logout = () => {
    if (auth?.access_token) {
      FlexSendAdapter.logout(auth.access_token).catch(() => {});
    }
    saveAuth(undefined);
    setCurrentUser(undefined);
  };

  const changePassword = async (currentPass: string, newPass: string) => {
    if (!auth?.access_token) throw new Error('Not authenticated');
    await FlexSendAdapter.changePassword(auth.access_token, currentPass, newPass);
    const user = await FlexSendAdapter.getCurrentUser(auth.access_token);
    setCurrentUser(user || undefined);
  };

  const requestPasswordReset = async (phone: string) => {
    await FlexSendAdapter.forgotPassword(phone);
  };

  const register = async () => {
    throw new Error('Self-registration is not available.');
  };

  const resetPassword = async () => {
    throw new Error('Use the forgot password flow via SMS.');
  };

  const resendVerificationEmail = async () => {};

  const getUser = async () => {
    if (!auth?.access_token) return null;
    return FlexSendAdapter.getCurrentUser(auth.access_token);
  };

  const updateProfile = async (_userData: Partial<UserModel>) => {
    return currentUser as UserModel;
  };

  return (
    <AuthContext.Provider
      value={{
        loading, setLoading, auth, saveAuth,
        user: currentUser, setUser: setCurrentUser,
        login, register, requestPasswordReset, resetPassword,
        resendVerificationEmail, getUser, updateProfile,
        logout, verify, isAdmin, changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
