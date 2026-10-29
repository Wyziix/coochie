import type { ReactNode } from 'react';

/** Native: the app fills the screen. See AppFrame.web.tsx for the web column. */
export function AppFrame({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
