export type ColorScheme = 'light' | 'dark';

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  danger: string;
  onDanger: string;
  success: string;
  warning: string;
  tabInactive: string;
  overlay: string;
  /** Web only: the area around the centered app column on wide screens. */
  frame: string;
};

export const colors: Record<ColorScheme, ThemeColors> = {
  light: {
    background: '#F5F6F8',
    surface: '#FFFFFF',
    surfaceAlt: '#ECEEF2',
    border: '#D9DCE3',
    text: '#11141A',
    textMuted: '#5B6270',
    primary: '#2F5BEA',
    onPrimary: '#FFFFFF',
    danger: '#C62828',
    onDanger: '#FFFFFF',
    success: '#1E8E3E',
    warning: '#B26A00',
    tabInactive: '#7A8191',
    overlay: 'rgba(0, 0, 0, 0.4)',
    frame: '#E4E7EC',
  },
  dark: {
    background: '#0B0D10',
    surface: '#15181D',
    surfaceAlt: '#1E2228',
    border: '#2B3038',
    text: '#F2F4F7',
    textMuted: '#9AA2B1',
    primary: '#6E8EFF',
    onPrimary: '#0B0D10',
    danger: '#FF6B6B',
    onDanger: '#0B0D10',
    success: '#4CC38A',
    warning: '#F5A524',
    tabInactive: '#7A8191',
    overlay: 'rgba(0, 0, 0, 0.6)',
    frame: '#000000',
  },
};
