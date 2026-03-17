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

const VALID_ROLES = ['admin', 'dispatch', 'driver', 'sales', 'customer'] as const
type UserRole = typeof VALID_ROLES[number]

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

  if (!name  || typeof name  !== 'string') throw new HttpsError('invalid-argument', 'name is required.')
  if (!email || typeof email !== 'string') throw new HttpsError('invalid-argument', 'email is required.')
  if (!role || !VALID_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of: ${VALID_ROLES.join(', ')}.`)
  }
  if (role === 'customer' && customerId && typeof customerId !== 'string') {
    throw new HttpsError('invalid-argument', 'customerId must be a string when provided.')
  }

  // ── Create Firebase Auth user ──────────────────────────────────────────────
  let uid: string
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
      throw new HttpsError('already-exists', 'An account with this email already exists.')
    }
    console.error('[adminCreateUser] createUser error:', err)
    throw new HttpsError('internal', `Failed to create Auth user: ${msg}`)
  }

  // ── Set custom claims immediately ──────────────────────────────────────────
  await adminAuth.setCustomUserClaims(uid, {
    role,
    customerId: customerId ?? null,
  })

  // ── Write Firestore user doc ───────────────────────────────────────────────
  const userDoc: Record<string, unknown> = {
    name:      name.trim(),
    email:     email.trim().toLowerCase(),
    role,
    active:    true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (customerId) userDoc.customerId = customerId

  await db.collection('users').doc(uid).set(userDoc)

  // ── Send password-reset / setup email ─────────────────────────────────────
  // This email lets the user set their own password on first sign-in.
  // Non-fatal: Auth + Firestore are complete regardless.
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

  return { uid }
})
