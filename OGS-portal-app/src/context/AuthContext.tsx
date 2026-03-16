/**
 * src/context/AuthContext.tsx
 *
 * AuthProvider mounts a single onAuthStateChange listener for the entire app.
 * It writes the resolved AppUser into the Zustand authStore so that any
 * component can read auth state without prop-drilling or context nesting.
 *
 * Mount AuthProvider once near the root (inside BrowserRouter so that hooks
 * like useNavigate work if needed downstream).
 */

import React, { createContext, useEffect } from 'react'
import { onAuthStateChange } from '../lib/auth'
import { useAuthStore } from '../store/authStore'
import type { AppUser } from '../types/user'

// ── Context shape ─────────────────────────────────────────────────────────────
// Intentionally minimal — components should prefer useAuth() (which adds role
// helpers) rather than destructuring the raw context value.

interface AuthContextValue {
  user:    AppUser | null
  loading: boolean
  error:   string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, loading, error, setUser, setLoading, setError } = useAuthStore()

  useEffect(() => {
    // Single listener for the entire app lifetime.
    const unsubscribe = onAuthStateChange((appUser) => {
      setUser(appUser)
      setLoading(false)
      setError(null)
    })
    return unsubscribe
  // These setters are stable Zustand references — safe to list as deps.
  }, [setUser, setLoading, setError])

  return (
    <AuthContext.Provider value={{ user, loading, error }}>
      {children}
    </AuthContext.Provider>
  )
}

