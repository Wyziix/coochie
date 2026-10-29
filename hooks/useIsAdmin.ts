import { useProfile } from './useProfile';

/**
 * Whether to show admin UI. Cosmetic only: every admin action is checked
 * again on the server (is_admin() in SQL).
 */
export function useIsAdmin(): boolean {
  return useProfile().data?.role === 'admin';
}
