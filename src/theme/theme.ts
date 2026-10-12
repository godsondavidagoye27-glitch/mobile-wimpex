export const theme = {
  colors: {
    black: '#000000',
    white: '#FFFFFF',
    primary: '#38BDF8',
    success: '#22C55E',
    gold: '#FFD700',
    surface: '#111418',
    surfaceLight: '#F1F5F9',
    line: '#1E242B',
    lineLight: '#E2E8F0',
    text: '#FFFFFF',
    textMuted: '#94A3B8',
    textMutedLight: '#64748B',
    textDark: '#111827',
    overlay: 'rgba(0, 0, 0, 0.7)',
    danger: '#EF4444',
    warning: '#F59E0B',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
  radii: {
    sm: 8,
    md: 18,
    lg: 22,
    pill: 999,
  },
  shadows: {
    soft: {
      shadowColor: '#000000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
  },
  typography: {
    title: { fontSize: 24, fontWeight: '800' as const },
    heading: { fontSize: 18, fontWeight: '700' as const },
    body: { fontSize: 15, fontWeight: '500' as const },
    caption: { fontSize: 12, fontWeight: '500' as const },
    label: { fontSize: 10, fontWeight: '700' as const },
  },
} as const;

export type AppTheme = typeof theme;
