/**
 * src/lib/auth.ts
 *
 * Thin wrapper over the Firebase Auth SDK.  All functions deal in AppUser
 * (the full Firestore-backed shape) rather than raw Firebase User objects.
 *
 * A module-level cache (`_currentUser`) lets `getCurrentUser()` return
 * synchronously after the initial auth-state resolution.
 */

import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onIdTokenChanged,
  type Unsubscribe,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import type { AppUser } from '../types/user'

// ── Module-level cache ────────────────────────────────────────────────────────
// Populated by signIn() and by onAuthStateChange().
let _currentUser: AppUser | null = null

// ── Internal helper ───────────────────────────────────────────────────────────
async function fetchAppUser(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  return { id: snap.id, ...(snap.data() as Omit<AppUser, 'id'>) }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sign in with email + password.
 * Fetches the Firestore user document to resolve role and profile fields.
 * Throws FirebaseError on invalid credentials.
 */
export async function signIn(email: string, password: string): Promise<AppUser> {
  const { user: firebaseUser } = await signInWithEmailAndPassword(auth, email, password)
  const appUser = await fetchAppUser(firebaseUser.uid)
  if (!appUser) {
    // Auth succeeded but no user document exists — sign back out to leave a
    // clean state and surface a clear error.
    await firebaseSignOut(auth)
    throw new Error('User account not found. Contact your administrator.')
  }
  _currentUser = appUser
  return appUser
}

/**
 * Sign out the current user and clear the local cache.
 */
export async function signOut(): Promise<void> {
  _currentUser = null
  await firebaseSignOut(auth)
}

/**
 * Send a password-reset email to the given address.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const { httpsCallable } = await import('firebase/functions')
  const { functions }     = await import('./firebase')
  const fn = httpsCallable<{ email: string }, { success: boolean; emailSent: boolean }>(
    functions,
    'sendUserPasswordResetEmail',
  )
  await fn({ email: email.trim().toLowerCase() })
}

/**
 * Synchronously returns the last resolved AppUser, or null if unauthenticated.
 * Valid after the first `onAuthStateChange` callback has fired.
 */
export function getCurrentUser(): AppUser | null {
  return _currentUser
}

/**
 * Forces an ID-token refresh and re-fetches the Firestore user document.
 * Call this after a role change to pick up the new role without signing out.
 */
export async function refreshCurrentUser(): Promise<AppUser | null> {
  const firebaseUser = auth.currentUser
  if (!firebaseUser) return null
  await firebaseUser.getIdToken(/* forceRefresh = */ true)
  const appUser = await fetchAppUser(firebaseUser.uid)
  _currentUser = appUser
  return appUser
}

/**
 * Subscribes to Firebase auth-state changes.
 * On each change the Firestore user document is fetched so the callback always
 * receives a fully-populated AppUser (or null when signed out).
 *
 * Returns an unsubscribe function — call it in a cleanup effect.
 */
export function onAuthStateChange(
  callback: (user: AppUser | null) => void,
): Unsubscribe {
  // onIdTokenChanged fires on sign-in, sign-out, AND whenever the ID token
  // is refreshed (e.g. after custom claims are updated via setCustomUserClaims).
  // This ensures role changes propagate without requiring a full sign-out/sign-in.
  return onIdTokenChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      _currentUser = null
      callback(null)
      return
    }

    const appUser = await fetchAppUser(firebaseUser.uid)
    _currentUser = appUser
    callback(appUser)
  })
}
