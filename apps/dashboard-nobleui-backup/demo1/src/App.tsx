import { AppRoutes } from '@/routes/AppRoutes';
import { GlobalErrorBoundary } from '@/components/error-boundaries';
import { ThemeModeProvider } from '@/contexts/ThemeModeContext';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { AuthProvider } from '@/contexts/AuthContext';

const App = () => {
  return (
    <GlobalErrorBoundary>
      <ThemeModeProvider>
        <SettingsProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </SettingsProvider>
      </ThemeModeProvider>
    </GlobalErrorBoundary>
  );
};

export default App;
