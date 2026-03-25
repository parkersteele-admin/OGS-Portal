/**
 * functions/src/adminCreateUser.ts
 *
 * Admin-only callable that provisions a new portal user end-to-end:
 *
 *   1. Creates the Firebase Auth account (random temp password)
 *   2. Sets the custom role claim immediately so the next token refresh
 *      contains the correct role — no trigger lag
 *   3. Writes the Firestore /users/{uid} document
 *   4. Sends a password-reset email so the user can set their own password
 *
 * Input:  { name, email, role, customerId? }
 * Output: { uid }
 *
 * Only callers with role === 'admin' in their ID-token claims may invoke this.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, adminAuth, FieldValue } from './admin'

const VALID_ROLES = [
  'admin', 'dispatch', 'driver', 'sales', 'customer',        // OGS internal + legacy
  'owner', 'manager', 'billing', 'delivery', 'viewer',      // Customer portal sub-roles
] as const
type UserRole = typeof VALID_ROLES[number]

/** These roles belong to customer-company portal users and need companyId in claims. */
const PORTAL_ROLES = new Set(['owner', 'manager', 'billing', 'delivery', 'viewer'])

export const adminCreateUser = onCall(async (request) => {
  // ── Auth guard ─────────────────────────────────────────────────────────────
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.')
  }
  if (request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can create users.')
  }

  // ── Validate input ─────────────────────────────────────────────────────────
  const data = request.data as Record<string, unknown>
  const name       = data.name       as string | undefined
  const email      = data.email      as string | undefined
  const role       = data.role       as UserRole | undefined
  const customerId = data.customerId as string | undefined
  const companyId  = data.companyId  as string | undefined

  if (!name  || typeof name  !== 'string') throw new HttpsError('invalid-argument', 'name is required.')
  if (!email || typeof email !== 'string') throw new HttpsError('invalid-argument', 'email is required.')
  if (!role || !VALID_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of: ${VALID_ROLES.join(', ')}.`)
  }
  if (PORTAL_ROLES.has(role) && !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required for portal user roles (owner, manager, billing, delivery, viewer).')
  }

  // ── Create Firebase Auth user (or link an existing one) ──────────────────
  let uid: string
  let isExistingUser = false
  try {
    const record = await adminAuth.createUser({
      email:         email.trim().toLowerCase(),
      displayName:   name.trim(),
      emailVerified: false,
      // Temporary random password — user will reset via password-reset email
      password: `OGS_${Math.random().toString(36).slice(2, 10).toUpperCase()}!`,
    })
    uid = record.uid
  } catch (err: unknown) {
    const msg = (err as { message?: string }).message ?? String(err)
    if (msg.includes('email-already-exists') || msg.includes('EMAIL_EXISTS')) {
      // Look up the existing account and link it to this company instead of failing.
      const existing = await adminAuth.getUserByEmail(email.trim().toLowerCase())
      const existingRole = (existing.customClaims as Record<string, unknown> | undefined)?.role as string | undefined

      // Never silently overwrite OGS staff accounts.
      const OGS_STAFF_ROLES = new Set(['admin', 'dispatch', 'driver', 'sales'])
      if (existingRole && OGS_STAFF_ROLES.has(existingRole)) {
        throw new HttpsError(
          'already-exists',
          `This email belongs to an OGS staff account (${existingRole}). It cannot be added as a portal user.`,
        )
      }

      uid = existing.uid
      isExistingUser = true
    } else {
      console.error('[adminCreateUser] createUser error:', err)
      throw new HttpsError('internal', `Failed to create Auth user: ${msg}`)
    }
  }

  // ── Set custom claims immediately ──────────────────────────────────────────
  // Portal sub-roles need companyId; legacy 'customer' role uses customerId.
  const claims: Record<string, unknown> = { role }
  if (PORTAL_ROLES.has(role) && companyId) {
    claims.companyId = companyId
  } else if (role === 'customer' && customerId) {
    claims.customerId = customerId
  } else {
    claims.customerId = null
  }
  await adminAuth.setCustomUserClaims(uid, claims)

  // ── Write Firestore user doc ───────────────────────────────────────────────
  const userDoc: Record<string, unknown> = {
    name:      name.trim(),
    email:     email.trim().toLowerCase(),
    role,
    active:    true,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (!isExistingUser) {
    userDoc.createdAt = FieldValue.serverTimestamp()
  }
  if (PORTAL_ROLES.has(role) && companyId) {
    userDoc.companyId = companyId
  } else if (customerId) {
    userDoc.customerId = customerId
  }

  // merge: true so we don't wipe extra fields on an existing user doc
  await db.collection('users').doc(uid).set(userDoc, { merge: true })

  // ── Send password-reset / setup email ─────────────────────────────────────
  // Skip for existing users — they already have a password set.
  // Non-fatal: Auth + Firestore are complete regardless.
  if (!isExistingUser) {
    try {
      const resetLink = await adminAuth.generatePasswordResetLink(
        email.trim().toLowerCase(),
        { url: 'https://ogs-portal.web.app/login' },
      )
      console.log(`[adminCreateUser] Password-reset link generated for ${email}: ${resetLink}`)
      // TODO: send via SendGrid when available — for now the link is logged
      // and the client also calls sendPasswordResetEmail() as belt-and-suspenders
    } catch (emailErr) {
      console.warn('[adminCreateUser] Failed to generate reset link:', emailErr)
    }
  }

  return { uid, linked: isExistingUser }
})

/**
 * adminDeleteUser — Admin-only callable that fully removes a user:
 *   1. Deletes the Firebase Auth account
 *   2. Deletes the Firestore /users/{uid} document
 *
 * Input:  { uid: string }
 * Output: { success: true }
 */
export const adminDeleteUser = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.')
  }
  if (request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can delete users.')
  }

  const data = request.data as Record<string, unknown>
  const uid  = data.uid as string | undefined
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('invalid-argument', 'uid is required.')
  }
  // Prevent self-deletion
  if (uid === request.auth.uid) {
    throw new HttpsError('failed-precondition', 'You cannot delete your own account.')
  }

  try {
    await adminAuth.deleteUser(uid)
  } catch (err: unknown) {
    const msg = (err as { message?: string }).message ?? String(err)
    // If user-not-found in Auth, still clean up Firestore
    if (!msg.includes('user-not-found')) {
      console.error('[adminDeleteUser] Auth deleteUser error:', err)
      throw new HttpsError('internal', `Failed to delete Auth user: ${msg}`)
    }
  }

  await db.collection('users').doc(uid).delete()

  return { success: true }
})

/**
 * adminUpdateUserCompany — Admin-only callable to assign a user to a company.
 * Updates both the Firestore doc and the Auth custom claims.
 *
 * Input:  { uid: string; companyId: string | null }
 * Output: { success: true }
 */
export const adminUpdateUserCompany = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.')
  }
  if (request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can update user companies.')
  }

  const data      = request.data as Record<string, unknown>
  const uid       = data.uid       as string | undefined
  const companyId = data.companyId as string | null | undefined

  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('invalid-argument', 'uid is required.')
  }

  // Update custom claims to keep companyId in sync
  const existingRecord = await adminAuth.getUser(uid)
  const currentClaims  = existingRecord.customClaims ?? {}
  await adminAuth.setCustomUserClaims(uid, { ...currentClaims, companyId: companyId ?? null })

  // Update Firestore
  await db.collection('users').doc(uid).update({
    companyId:  companyId ?? null,
    customerId: companyId ?? null, // keep legacy field in sync
    updatedAt:  FieldValue.serverTimestamp(),
  })

  return { success: true }
})
