/**
 * src/store/viewAsStore.ts
 *
 * Admin-only "View as customer" impersonation state.
 * When `viewAsUser` is non-null, `useAuth()` returns this user so every
 * page renders exactly as that customer would see it.
 *
 * The real admin identity is never replaced in authStore — we always keep it
 * so sign-out still works and we can fall back to it when exiting the mode.
 */

import { create } from 'zustand'
import type { AppUser } from '../types/user'

interface ViewAsState {
  viewAsUser: AppUser | null
  setViewAsUser: (user: AppUser | null) => void
  exitViewAs: () => void
}

export const useViewAsStore = create<ViewAsState>()((set) => ({
  viewAsUser: null,
  setViewAsUser: (user) => set({ viewAsUser: user }),
  exitViewAs:    ()     => set({ viewAsUser: null }),
}))
