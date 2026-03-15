/**
 * src/hooks/useAuth.ts
 *
 * Reads from the Zustand authStore (populated by AuthProvider) and surfaces
 * convenience role-boolean helpers alongside the raw AppUser.
 *
 * NOTE: This hook does NOT set up its own onAuthStateChanged listener.
 *       AuthProvider (src/context/AuthContext.tsx) owns the single listener.
 *       Make sure <AuthProvider> wraps the component tree before using this hook.
 */

import { useAuthStore } from '../store/authStore'
import type { AppUser } from '../types/user'
import type { UserRole } from '../types/user'

export interface UseAuthResult {
  user:       AppUser | null
  loading:    boolean
  error:      string | null
  role:       UserRole | null
  isAdmin:    boolean
  /** isDispatch is true for both 'admin' and 'dispatch' roles. */
  isDispatch: boolean
  isDriver:   boolean
  isCustomer: boolean
  isSales:    boolean
}

export function useAuth(): UseAuthResult {
  const { user, loading, error } = useAuthStore()
  const role = (user?.role ?? null) as UserRole | null

  return {
    user,
    loading,
    error,
    role,
    isAdmin:    role === 'admin',
    isDispatch: role === 'admin' || role === 'dispatch',
    isDriver:   role === 'driver',
    isCustomer: role === 'customer',
    isSales:    role === 'sales',
  }
}
