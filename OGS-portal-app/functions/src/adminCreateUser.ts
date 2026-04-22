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
import { SENDGRID_API_KEY, requireSecret } from './config'
import { sendEmail } from './email/sendEmail'

const VALID_ROLES = [
  'admin', 'dispatch', 'driver', 'sales', 'customer',        // OGS internal + legacy
  'owner', 'manager', 'billing', 'delivery', 'viewer',      // Customer portal sub-roles
] as const
type UserRole = typeof VALID_ROLES[number]

/** These roles belong to customer-company portal users and need companyId in claims. */
const PORTAL_ROLES = new Set(['owner', 'manager', 'billing', 'delivery', 'viewer'])
const APP_URL = 'https://app.ohiogassupply.com'

function buildPasswordSetupEmail(name: string, resetLink: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#111827">
      <div style="background:#111111;padding:24px 32px">
        <div style="font-size:22px;font-weight:700;color:#ffffff">Ohio Gas Supply</div>
        <div style="margin-top:8px;font-size:13px;color:#f5c9a6">Portal account setup</div>
      </div>
      <div style="padding:28px 32px;border:1px solid #e5e7eb;border-top:none;background:#ffffff">
        <p style="margin:0 0 16px">Hi ${name || 'there'},</p>
        <p style="margin:0 0 16px">
          Your OGS Portal account is ready. Use the button below to set your password and sign in.
        </p>
        <p style="margin:24px 0">
          <a
            href="${resetLink}"
            style="display:inline-block;background:#E87722;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:700"
          >
            Set Password
          </a>
        </p>
        <p style="margin:0 0 16px;font-size:13px;color:#4b5563">
          If the button does not work, copy and paste this link into your browser:
        </p>
        <p style="margin:0 0 20px;font-size:13px;word-break:break-all;color:#E87722">${resetLink}</p>
        <p style="margin:0;font-size:13px;color:#6b7280">
          After setting your password, sign in at
          <a href="${APP_URL}/login" style="color:#E87722">${APP_URL}/login</a>.
        </p>
      </div>
    </div>
  `
}

async function sendPasswordResetLinkEmail(email: string, name: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase()

  try {
    const resetLink = await adminAuth.generatePasswordResetLink(normalizedEmail, {
      url: `${APP_URL}/login`,
    })

    requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY')
    await sendEmail({
      to: normalizedEmail,
      subject: 'Set your Ohio Gas Supply Portal password',
      html: buildPasswordSetupEmail(name.trim(), resetLink),
    })
    console.log(`[adminCreateUser] password setup email sent to ${normalizedEmail}`)
    return true
  } catch (emailErr) {
    console.error('[adminCreateUser] Failed to send password setup email:', emailErr)
    return false
  }
}

export const adminCreateUser = onCall({ secrets: [SENDGRID_API_KEY] }, async (request) => {
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
  let emailSent = false
  if (!isExistingUser) {
    emailSent = await sendPasswordResetLinkEmail(email, name)
  }

  return { uid, linked: isExistingUser, emailSent }
})

/**
 * sendUserPasswordResetEmail — sends a SendGrid-backed password-reset email.
 *
 * Behavior intentionally mirrors Firebase Auth reset semantics:
 *  - Returns success even if the email does not exist, to avoid enumeration
 *  - Can be called unauthenticated from the public reset-password screen
 *  - Uses the same email provider/logging path as the rest of the app
 */
export const sendUserPasswordResetEmail = onCall({ secrets: [SENDGRID_API_KEY] }, async (request) => {
  const data = request.data as Record<string, unknown>
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''

  if (!email) {
    throw new HttpsError('invalid-argument', 'email is required.')
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.')
  }

  try {
    const userRecord = await adminAuth.getUserByEmail(email)
    const name = userRecord.displayName?.trim() || email
    const emailSent = await sendPasswordResetLinkEmail(email, name)
    return { success: true, emailSent }
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? ''
    if (code === 'auth/user-not-found') {
      console.warn(`[sendUserPasswordResetEmail] No auth user found for ${email}`)
      return { success: true, emailSent: false }
    }
    console.error('[sendUserPasswordResetEmail] unexpected error:', err)
    throw new HttpsError('internal', 'Failed to send reset email.')
  }
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
