import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ScreenLoader } from '@/components/common/screen-loader';
import { useAuth } from './context/auth-context';

/**
 * Protects routes requiring authentication.
 * Also handles first-login password change redirect.
 */
export const RequireAuth = () => {
  const { auth, verify, loading: globalLoading, user } = useAuth();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const verificationStarted = useRef(false);

  useEffect(() => {
    const checkAuth = async () => {
      if (!auth?.access_token || !verificationStarted.current) {
        verificationStarted.current = true;
        try {
          await verify();
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    };
    checkAuth();
  }, [auth, verify]);

  // Show loader while checking
  if (loading || globalLoading) return <ScreenLoader />;

  // Not authenticated → login
  if (!auth?.access_token) {
    return (
      <Navigate
        to={`/auth/signin?next=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }

  // First login — must change password before anything else
  if (user?.must_change_password) {
    const isOnChangePage = location.pathname === '/auth/change-password';
    if (!isOnChangePage) {
      return <Navigate to="/auth/change-password" replace />;
    }
  }

  return <Outlet />;
};
