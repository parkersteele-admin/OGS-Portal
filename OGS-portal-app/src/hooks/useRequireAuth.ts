/**
 * src/hooks/useRequireAuth.ts
 *
 * Redirects unauthenticated visitors to the login page.
 * Use inside page components that must be protected but are not already
 * wrapped by <ProtectedRoute> in the router (e.g. nested modals, detail pages).
 *
 * Example:
 *   const { user } = useRequireAuth()
 *   if (!user) return null  // render nothing while redirect is in-flight
 */

import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import type { AppUser } from '../types/user'

interface UseRequireAuthResult {
  user:    AppUser | null
  loading: boolean
}

/**
 * @param redirectTo  Path to send unauthenticated users to (default: '/login').
 */
export function useRequireAuth(redirectTo = '/login'): UseRequireAuthResult {
  const { user, loading } = useAuthStore()
  const navigate  = useNavigate()
  const location  = useLocation()

  useEffect(() => {
    // Wait until the initial auth check resolves before redirecting.
    if (loading) return

    if (!user) {
      navigate(redirectTo, {
        // Preserve the attempted URL so the login page can redirect back.
        state:   { from: location },
        replace: true,
      })
    }
  }, [user, loading, navigate, location, redirectTo])

  return { user, loading }
}
