export const colors = {
  primary: '#1A56DB',
  primaryDark: '#1342A8',
  secondary: '#F97316',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  background: '#FFFFFF',
  surface: '#F9FAFB',
  border: '#E5E7EB',
  text: {
    primary: '#111827',
    secondary: '#6B7280',
    inverse: '#FFFFFF',
    placeholder: '#9CA3AF',
  },
  parcel: {
    pending: { bg: '#FEF3C7', text: '#D97706' },
    confirmed: { bg: '#DBEAFE', text: '#1E3A8A' },
    in_transit: { bg: '#FEF3C7', text: '#D97706' },
    delivered: { bg: '#D1FAE5', text: '#065F46' },
    failed: { bg: '#FEE2E2', text: '#991B1B' },
  },
};

export const spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const radius = {
  sm: 8, md: 12, lg: 16, xl: 24, full: 999,
};

export const fontSize = {
  xs: 12, sm: 14, md: 16, lg: 18, xl: 20, xxl: 24, xxxl: 32,
};

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};
