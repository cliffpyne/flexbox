import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth, DASHBOARD_ROLES } from '@/contexts/AuthContext';

const AuthGuard = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  // Still loading from sessionStorage — show nothing (avoids flash)
  if (isLoading) return null;

  // Not logged in → go to login
  if (!isAuthenticated) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  // Mobile-only role trying to access dashboard
  if (user && !DASHBOARD_ROLES.includes(user.role)) {
    return <Navigate to="/auth/login" replace />;
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

export default AuthGuard;
