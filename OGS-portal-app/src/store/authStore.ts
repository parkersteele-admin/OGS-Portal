/**
 * src/store/authStore.ts
 *
 * Zustand store for global auth state.
 * `AuthProvider` (src/context/AuthContext.tsx) is the sole writer.
 * All other components read via `useAuthStore()` or via `useAuth()`.
 */

import { create } from 'zustand'
import type { AppUser } from '../types/user'

interface AuthState {
  /** Fully-resolved user from Firestore (null = unauthenticated). */
  user: AppUser | null
  /** True until the first onAuthStateChanged callback fires. */
  loading: boolean
  /** Last auth error message, if any. */
  error: string | null

  // ── Actions ─────────────────────────────────────────────────────────────────
  setUser:    (user: AppUser | null) => void
  setLoading: (loading: boolean) => void
  setError:   (error: string | null) => void
  /**
   * Clears user + error — called by the signOut action in the UI so the
   * store reflects the signed-out state immediately without waiting for the
   * next onAuthStateChanged event.
   */
  signOut:    () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  user:    null,
  loading: true,
  error:   null,

  setUser:    (user)    => set({ user }),
  setLoading: (loading) => set({ loading }),
  setError:   (error)   => set({ error }),
  signOut:    ()        => set({ user: null, error: null }),
}))
