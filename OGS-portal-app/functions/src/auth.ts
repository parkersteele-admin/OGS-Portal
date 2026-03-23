/**
 * functions/src/auth.ts
 *
 * Firebase Auth + user-role Cloud Functions.
 *
 * onUserCreated      — Firestore trigger: syncs role claim on new user doc
 * onUserRoleUpdated  — Firestore trigger: syncs role claim when doc role changes
 * setUserRole        — Admin-only callable: change a user's role
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, adminAuth, FieldValue } from './admin'

const VALID_ROLES = [
  // OGS internal
  'admin', 'dispatch', 'driver', 'sales',
  // Customer (legacy single-role)
  'customer',
  // Customer sub-roles
  'owner', 'manager', 'billing', 'delivery', 'viewer',
] as const
type UserRole = typeof VALID_ROLES[number]

// ── Firestore triggers ────────────────────────────────────────────────────────

/** Stamp the custom claim onto a new user's Auth record when their Firestore
 *  document is created (e.g. by the seed script or admin console). */
export const onUserCreated = onDocumentCreated('users/{userId}', async (event) => {
  const data = event.data?.data()
  if (!data?.role) return

  await adminAuth.setCustomUserClaims(event.params.userId, {
    role:       data.role,
    customerId: data.customerId ?? null,
  })
})

/** Keep the custom claim in sync when an admin updates the role field on an
 *  existing user document. The user must refresh their token to see the change. */
export const onUserRoleUpdated = onDocumentUpdated('users/{userId}', async (event) => {
  const before = event.data?.before.data()
  const after  = event.data?.after.data()

  if (!after) return

  const roleChanged       = before?.role       !== after.role
  const customerIdChanged = before?.customerId !== after.customerId

  if (!roleChanged && !customerIdChanged) return

  await adminAuth.setCustomUserClaims(event.params.userId, {
    role:       after.role,
    customerId: after.customerId ?? null,
  })
})

// ── Callable ──────────────────────────────────────────────────────────────────

/**
 * Admin-only callable.  Sets a Firebase Auth custom claim AND updates the
 * Firestore user document so both sources of truth stay in sync.
 *
 * The target user must call `getIdToken(true)` or sign out and back in to
 * receive the updated claim in their ID token.
 *
 * Input:  { uid: string, role: UserRole }
 * Output: { success: true, uid: string, role: UserRole }
 */
export const setUserRole = onCall(async (request) => {
  // ── Authorisation ──────────────────────────────────────────────────────────
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.')
  }
  if (request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can assign roles.')
  }

  // ── Input validation ───────────────────────────────────────────────────────
  const data = request.data as Record<string, unknown>
  const { uid, role } = data

  if (typeof uid !== 'string' || !uid) {
    throw new HttpsError('invalid-argument', 'uid must be a non-empty string.')
  }
  if (!VALID_ROLES.includes(role as UserRole)) {
    throw new HttpsError(
      'invalid-argument',
      `role must be one of: ${VALID_ROLES.join(', ')}.`,
    )
  }

  // Verify the target user exists in Firebase Auth.
  try {
    await adminAuth.getUser(uid)
  } catch {
    throw new HttpsError('not-found', `No Firebase Auth user with uid: ${uid}`)
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  await adminAuth.setCustomUserClaims(uid, { role })
  await db.collection('users').doc(uid).update({
    role,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { success: true, uid, role }
})
