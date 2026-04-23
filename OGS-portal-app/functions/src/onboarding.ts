/**
 * functions/src/onboarding.ts
 *
 * Callable Cloud Functions for the customer onboarding feature.
 *
 *  checkForExistingCompany  — fuzzy name + domain duplicate check
 *  setCompanyClaim          — set companyId + role on Auth custom claim
 *  revokeCompanyClaim       — clear companyId from claim  (admin only)
 *  requestToJoinCompany     — create joinRequest doc + notify primary contact
 *  approveJoinRequest       — link user to company, set claim, email user
 *  denyJoinRequest          — mark denied, email user
 *  inviteTeamMember         — create invite doc + send invite email
 *  acceptInvite             — validate token, link user, set claim
 *  adminAssignUser          — admin direct-assign (no invite flow)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, adminAuth, FieldValue } from './admin'
import { sendEmail } from './email/sendEmail'
import { normalizeCompanyName, extractDomain } from './utils/companyName'

// ── Shared helpers ────────────────────────────────────────────────────────────

const CUSTOMER_ROLES = ['owner', 'manager', 'billing', 'delivery', 'viewer'] as const
type CustomerRole = typeof CUSTOMER_ROLES[number]

function assertAuth(request: { auth?: { uid: string; token: Record<string, unknown> } }) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.')
}

function assertAdmin(request: { auth?: { uid: string; token: Record<string, unknown> } }) {
  assertAuth(request)
  if (request.auth!.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.')
  }
}

/** Set companyId + role on a user's Auth custom claim AND update their Firestore doc. */
async function applyCompanyClaim(uid: string, companyId: string, role: CustomerRole) {
  await adminAuth.setCustomUserClaims(uid, { role, companyId })
  await db.collection('users').doc(uid).set(
    { role, companyId, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
}

// ── checkForExistingCompany ───────────────────────────────────────────────────

/**
 * Fuzzy duplicate check used on the /signup page.
 *
 * Input:  { companyName: string; email: string }
 * Output: { domainMatch: boolean; nameMatch: boolean; companyId?: string; companyName?: string }
 */
export const checkForExistingCompany = onCall(async (request) => {
  const data = request.data as Record<string, unknown>
  const rawName  = typeof data.companyName === 'string' ? data.companyName.trim() : ''
  const rawEmail = typeof data.email       === 'string' ? data.email.trim()       : ''

  if (!rawName) throw new HttpsError('invalid-argument', 'companyName is required.')

  const normalizedInput = normalizeCompanyName(rawName)
  const domain          = extractDomain(rawEmail)

  // Query all companies (collection is small at onboarding time)
  const snap = await db.collection('customers').get()

  let domainMatch = false
  let nameMatch   = false
  let matchedId   = ''
  let matchedName = ''

  for (const doc of snap.docs) {
    const d = doc.data()

    // Domain match
    if (domain && d.primaryEmail) {
      const existingDomain = extractDomain(d.primaryEmail as string)
      if (existingDomain === domain) {
        domainMatch = true
        matchedId   = doc.id
        matchedName = d.companyName as string
      }
    }

    // Name match (fuzzy normalized)
    if (d.companyName && normalizeCompanyName(d.companyName as string) === normalizedInput) {
      nameMatch   = true
      matchedId   = doc.id
      matchedName = d.companyName as string
    }
  }

  return {
    domainMatch,
    nameMatch,
    ...(matchedId ? { companyId: matchedId, companyName: matchedName } : {}),
  }
})

// ── setCompanyClaim ───────────────────────────────────────────────────────────

/**
 * Set companyId + customer role custom claim.  Called after sign-up.
 *
 * Input:  { companyId: string; role?: CustomerRole }
 * Output: { success: true }
 */
export const setCompanyClaim = onCall(async (request) => {
  assertAuth(request)

  const data      = request.data as Record<string, unknown>
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : ''
  const role      = (data.role as CustomerRole | undefined) ?? 'owner'

  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.')
  if (!CUSTOMER_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of: ${CUSTOMER_ROLES.join(', ')}`)
  }

  // Verify company exists
  const compSnap = await db.collection('customers').doc(companyId).get()
  if (!compSnap.exists) throw new HttpsError('not-found', `Company ${companyId} not found.`)

  await applyCompanyClaim(request.auth!.uid, companyId, role)
  return { success: true }
})

// ── revokeCompanyClaim ────────────────────────────────────────────────────────

/**
 * Admin-only: remove a user from a company by clearing their companyId claim.
 *
 * Input:  { uid: string }
 * Output: { success: true }
 */
export const revokeCompanyClaim = onCall(async (request) => {
  assertAdmin(request)

  const data = request.data as Record<string, unknown>
  const uid  = typeof data.uid === 'string' ? data.uid.trim() : ''
  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.')

  await adminAuth.setCustomUserClaims(uid, { role: 'customer', companyId: null })
  await db.collection('users').doc(uid).set(
    { role: 'customer', companyId: null, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
  return { success: true }
})

// ── requestToJoinCompany ──────────────────────────────────────────────────────

/**
 * Create a join request and email the primary contact of the target company.
 *
 * Input:  { companyId: string; message?: string }
 * Output: { requestId: string }
 */
export const requestToJoinCompany = onCall(
  async (request) => {
    assertAuth(request)

    const data      = request.data as Record<string, unknown>
    const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : ''
    if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.')

    const compSnap = await db.collection('customers').doc(companyId).get()
    if (!compSnap.exists) throw new HttpsError('not-found', 'Company not found.')

    const company   = compSnap.data()!
    const uid       = request.auth!.uid
    const userSnap  = await db.collection('users').doc(uid).get()
    const userData  = userSnap.data() ?? {}

    // Prevent duplicate pending requests
    const existing = await db.collection('joinRequests')
      .where('uid', '==', uid)
      .where('companyId', '==', companyId)
      .where('status', '==', 'pending')
      .limit(1)
      .get()
    if (!existing.empty) throw new HttpsError('already-exists', 'A pending request already exists.')

    const ref = await db.collection('joinRequests').add({
      uid,
      companyId,
      requesterName:  userData.name  ?? '',
      requesterEmail: userData.email ?? request.auth!.token.email ?? '',
      message:        typeof data.message === 'string' ? data.message.trim() : '',
      status:         'pending',
      createdAt:      FieldValue.serverTimestamp(),
    })

    // Notify primary contact
    if (company.primaryEmail) {
      await sendEmail({
        to:      company.primaryEmail as string,
        subject: `${userData.name ?? 'Someone'} wants to join ${company.companyName as string} on OGS Portal`,
        html: `
          <p>Hi there,</p>
          <p><strong>${userData.name ?? userData.email ?? 'A user'}</strong> has requested to join your company account on OGS Portal.</p>
          <p>Log in and go to <strong>Settings → Team</strong> to approve or deny the request.</p>
          <p style="margin-top:24px;color:#888;">Ohio Gas Supply Portal</p>
        `,
      })
    }

    return { requestId: ref.id }
  },
)

// ── approveJoinRequest ────────────────────────────────────────────────────────

/**
 * Approve a join request: link user, set claim, email the user.
 *
 * Input:  { requestId: string; role: CustomerRole }
 * Output: { success: true }
 */
export const approveJoinRequest = onCall(
  async (request) => {
    assertAuth(request)

    const data      = request.data as Record<string, unknown>
    const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : ''
    const role      = (data.role as CustomerRole | undefined) ?? 'viewer'

    if (!requestId) throw new HttpsError('invalid-argument', 'requestId is required.')
    if (!CUSTOMER_ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', `Invalid role: ${role}`)
    }

    const reqSnap = await db.collection('joinRequests').doc(requestId).get()
    if (!reqSnap.exists) throw new HttpsError('not-found', 'Join request not found.')

    const jr         = reqSnap.data()!
    const callerRole = request.auth!.token.role as string
    const callerCompanyId = request.auth!.token.companyId as string | undefined

    // Only owner/manager of the same company, or admin
    if (callerRole !== 'admin' && callerCompanyId !== jr.companyId) {
      throw new HttpsError('permission-denied', 'You are not authorised to approve this request.')
    }
    if (jr.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Request is no longer pending.')
    }

    await applyCompanyClaim(jr.uid, jr.companyId, role)
    await reqSnap.ref.update({
      status:      'approved',
      approvedBy:  request.auth!.uid,
      approvedAt:  FieldValue.serverTimestamp(),
      assignedRole: role,
    })

    // Email the requester
    if (jr.requesterEmail) {
      const compSnap = await db.collection('customers').doc(jr.companyId).get()
      const companyName = compSnap.data()?.companyName ?? 'your company'
      await sendEmail({
        to:      jr.requesterEmail as string,
        subject: `You've been added to ${companyName} on OGS Portal`,
        html: `
          <p>Hi ${jr.requesterName ?? ''},</p>
          <p>Your request to join <strong>${companyName}</strong> has been approved.
          You can now sign in to the OGS Portal.</p>
          <p style="margin-top:24px;color:#888;">Ohio Gas Supply Portal</p>
        `,
      })
    }

    return { success: true }
  },
)

// ── denyJoinRequest ───────────────────────────────────────────────────────────

/**
 * Deny a join request and optionally email the requester.
 *
 * Input:  { requestId: string; reason?: string }
 * Output: { success: true }
 */
export const denyJoinRequest = onCall(
  async (request) => {
    assertAuth(request)

    const data      = request.data as Record<string, unknown>
    const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : ''
    if (!requestId) throw new HttpsError('invalid-argument', 'requestId is required.')

    const reqSnap = await db.collection('joinRequests').doc(requestId).get()
    if (!reqSnap.exists) throw new HttpsError('not-found', 'Join request not found.')

    const jr         = reqSnap.data()!
    const callerRole = request.auth!.token.role as string
    const callerCompanyId = request.auth!.token.companyId as string | undefined

    if (callerRole !== 'admin' && callerCompanyId !== jr.companyId) {
      throw new HttpsError('permission-denied', 'Not authorised.')
    }
    if (jr.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Request is no longer pending.')
    }

    await reqSnap.ref.update({
      status:   'denied',
      deniedBy: request.auth!.uid,
      deniedAt: FieldValue.serverTimestamp(),
      reason:   typeof data.reason === 'string' ? data.reason.trim() : '',
    })

    if (jr.requesterEmail) {
      const compSnap = await db.collection('customers').doc(jr.companyId).get()
      const companyName = compSnap.data()?.companyName ?? 'the company'
      await sendEmail({
        to:      jr.requesterEmail as string,
        subject: `Your OGS Portal access request was not approved`,
        html: `
          <p>Hi ${jr.requesterName ?? ''},</p>
          <p>Your request to join <strong>${companyName}</strong> on OGS Portal was not approved
          at this time. Please contact your account administrator if you believe this is an error.</p>
          <p style="margin-top:24px;color:#888;">Ohio Gas Supply Portal</p>
        `,
      })
    }

    return { success: true }
  },
)

// ── inviteTeamMember ──────────────────────────────────────────────────────────

/**
 * Create an invite doc and send the invite email.
 *
 * Input:  { email: string; role: CustomerRole; companyId?: string }
 * Output: { inviteId: string }
 */
export const inviteTeamMember = onCall(
  async (request) => {
    assertAuth(request)

    const data      = request.data as Record<string, unknown>
    const email     = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
    const role      = (data.role as CustomerRole | undefined) ?? 'viewer'
    const callerRole = request.auth!.token.role as string
    const callerCompanyId = (request.auth!.token.companyId ?? data.companyId) as string | undefined

    if (!email) throw new HttpsError('invalid-argument', 'email is required.')
    if (!CUSTOMER_ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', `Invalid role: ${role}`)
    }
    if (!callerCompanyId) throw new HttpsError('failed-precondition', 'No company context.')
    if (!['owner', 'manager', 'admin'].includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Only owners, managers, or admins can invite members.')
    }

    // Check for existing pending invite
    const existing = await db.collection('invites')
      .where('email', '==', email)
      .where('companyId', '==', callerCompanyId)
      .where('status', '==', 'pending')
      .limit(1)
      .get()
    if (!existing.empty) throw new HttpsError('already-exists', 'A pending invite already exists for this email.')

    const compSnap = await db.collection('customers').doc(callerCompanyId).get()
    const companyName = compSnap.data()?.companyName ?? 'your company'

    // Expires in 7 days
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const ref = await db.collection('invites').add({
      email,
      role,
      companyId:   callerCompanyId,
      companyName,
      invitedBy:   request.auth!.uid,
      status:      'pending',
      expiresAt:   expiresAt,
      createdAt:   FieldValue.serverTimestamp(),
    })

    const inviteUrl = `https://portal.ohiogassupply.com/accept-invite?token=${ref.id}`

    await sendEmail({
      to:      email,
      subject: `You've been invited to join ${companyName} on OGS Portal`,
      html: `
        <p>You've been invited to join <strong>${companyName}</strong> on Ohio Gas Supply Portal.</p>
        <p><a href="${inviteUrl}" style="background:#E87722;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">Accept Invitation</a></p>
        <p style="margin-top:16px;font-size:13px;color:#888;">This link expires in 7 days.</p>
        <p style="margin-top:24px;color:#888;">Ohio Gas Supply Portal</p>
      `,
    })

    return { inviteId: ref.id }
  },
)

// ── acceptInvite ──────────────────────────────────────────────────────────────

/**
 * Accept an invite: validate token, link user, set claim.
 *
 * Input:  { inviteId: string }
 * Output: { success: true; companyId: string; role: CustomerRole }
 */
export const acceptInvite = onCall(async (request) => {
  assertAuth(request)

  const data     = request.data as Record<string, unknown>
  const inviteId = typeof data.inviteId === 'string' ? data.inviteId.trim() : ''
  if (!inviteId) throw new HttpsError('invalid-argument', 'inviteId is required.')

  const invSnap = await db.collection('invites').doc(inviteId).get()
  if (!invSnap.exists) throw new HttpsError('not-found', 'Invite not found.')

  const inv = invSnap.data()!

  if (inv.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'This invite has already been used or cancelled.')
  }

  // Check expiry
  const expiresAt = inv.expiresAt?.toDate?.() as Date | undefined
  if (expiresAt && expiresAt < new Date()) {
    await invSnap.ref.update({ status: 'expired' })
    throw new HttpsError('deadline-exceeded', 'This invite has expired.')
  }

  // Verify caller email matches invite email (if verifiable)
  const callerEmail = (request.auth!.token.email ?? '').toLowerCase()
  if (callerEmail && inv.email && callerEmail !== inv.email) {
    throw new HttpsError('permission-denied', 'This invite was sent to a different email address.')
  }

  await applyCompanyClaim(request.auth!.uid, inv.companyId, inv.role as CustomerRole)
  await invSnap.ref.update({
    status:     'accepted',
    acceptedBy: request.auth!.uid,
    acceptedAt: FieldValue.serverTimestamp(),
  })

  // Sync the invited user's personal info to the company profile so it
  // appears correctly in the CRM.  For the 'owner' role (primary portal user),
  // update the billing contact name and email if they are not yet set.
  try {
    const userSnap  = await db.collection('users').doc(request.auth!.uid).get()
    const userData  = userSnap.data() ?? {}
    const userName  = (userData.name  as string | undefined) || ''
    const userEmail = (userData.email as string | undefined)
      || (request.auth!.token.email as string | undefined) || ''

    if (userName || userEmail) {
      const compSnap   = await db.collection('customers').doc(inv.companyId).get()
      const compData   = compSnap.data() ?? {}
      const updatePayload: Record<string, unknown> = {}

      // Always ensure flat 'name' and 'email' exist for CRM display
      if (!compData.name  && userName)  updatePayload.name  = userName
      if (!compData.email && userEmail) updatePayload.email = userEmail

      // For owner role: set billingContactName / billingEmail if missing
      if (inv.role === 'owner') {
        if (!compData.billingContactName && userName)  updatePayload.billingContactName = userName
        if (!compData.billingEmail       && userEmail) updatePayload.billingEmail       = userEmail
      }

      if (Object.keys(updatePayload).length > 0) {
        updatePayload.updatedAt = FieldValue.serverTimestamp()
        await db.collection('customers').doc(inv.companyId).update(updatePayload)
      }
    }
  } catch (syncErr) {
    // Non-fatal — claim is already applied
    console.warn('[acceptInvite] failed to sync user info to company —', syncErr)
  }

  return { success: true, companyId: inv.companyId, role: inv.role }
})

// ── adminAssignUser ───────────────────────────────────────────────────────────

/**
 * Admin shortcut: assign an existing user directly to a company.
 *
 * Input:  { uid: string; companyId: string; role: CustomerRole }
 * Output: { success: true }
 */
export const adminAssignUser = onCall(async (request) => {
  assertAdmin(request)

  const data      = request.data as Record<string, unknown>
  const uid       = typeof data.uid       === 'string' ? data.uid.trim()       : ''
  const companyId = typeof data.companyId === 'string' ? data.companyId.trim() : ''
  const role      = (data.role as CustomerRole | undefined) ?? 'viewer'

  if (!uid)       throw new HttpsError('invalid-argument', 'uid is required.')
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.')
  if (!CUSTOMER_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `Invalid role: ${role}`)
  }

  // Verify both user and company exist
  const [userSnap, compSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('customers').doc(companyId).get(),
  ])
  if (!userSnap.exists) throw new HttpsError('not-found', `User ${uid} not found.`)
  if (!compSnap.exists) throw new HttpsError('not-found', `Company ${companyId} not found.`)

  await applyCompanyClaim(uid, companyId, role)
  return { success: true }
})

// ── generateSetupLink ─────────────────────────────────────────────────────────

/**
 * Generate (or refresh) a one-time setup link for a customer to create their
 * portal account via QR code or shared URL.
 *
 * Input:  { customerId: string }
 * Output: { url: string; expiresAt: string }  (ISO date)
 */
export const generateSetupLink = onCall(async (request) => {
  assertAuth(request)

  const callerRole = request.auth!.token.role as string
  if (!['admin', 'sales'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only admins and sales staff can generate setup links.')
  }

  const data       = request.data as Record<string, unknown>
  const customerId = typeof data.customerId === 'string' ? data.customerId.trim() : ''
  if (!customerId) throw new HttpsError('invalid-argument', 'customerId is required.')

  const compSnap = await db.collection('customers').doc(customerId).get()
  if (!compSnap.exists) throw new HttpsError('not-found', 'Customer not found.')
  if (compSnap.data()!.setupComplete) {
    throw new HttpsError('failed-precondition', 'This customer has already completed account setup.')
  }

  const setupToken       = crypto.randomUUID()
  const expiresAt        = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  await db.collection('customers').doc(customerId).update({
    setupToken,
    setupTokenExpiry: expiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return {
    url:       `https://app.ohiogassupply.com/join/${setupToken}`,
    expiresAt: expiresAt.toISOString(),
  }
})

// ── getSetupLinkInfo ──────────────────────────────────────────────────────────

/**
 * Public (unauthenticated) lookup of a setup token.
 * Returns the minimal company info needed to render the account-creation form.
 *
 * Input:  { token: string }
 * Output: { companyId, companyName, address, city, state }
 */
export const getSetupLinkInfo = onCall(async (request) => {
  const data  = request.data as Record<string, unknown>
  const token = typeof data.token === 'string' ? data.token.trim() : ''
  if (!token) throw new HttpsError('invalid-argument', 'token is required.')

  const snap = await db.collection('customers')
    .where('setupToken', '==', token)
    .limit(1)
    .get()

  if (snap.empty) throw new HttpsError('not-found', 'Invalid or expired setup link.')

  const doc      = snap.docs[0]
  const customer = doc.data()

  const expiry = customer.setupTokenExpiry?.toDate?.() as Date | undefined
  if (expiry && expiry < new Date()) {
    throw new HttpsError('deadline-exceeded', 'This setup link has expired. Ask your sales rep for a new one.')
  }
  if (customer.setupComplete) {
    throw new HttpsError('failed-precondition', 'An account has already been created for this company.')
  }

  return {
    companyId:   doc.id,
    companyName: (customer.companyName || customer.name || '') as string,
    address:     (customer.address   || '') as string,
    city:        (customer.city      || '') as string,
    state:       (customer.state     || '') as string,
  }
})

// ── completeAccountSetup ──────────────────────────────────────────────────────

/**
 * Called after the customer creates their Firebase Auth account on the /join page.
 * Validates the setup token, applies the company claim, and marks setup complete.
 *
 * Input:  { token: string; role: CustomerRole }
 * Output: { success: true; companyId: string; role: CustomerRole }
 */
export const completeAccountSetup = onCall(async (request) => {
  assertAuth(request)

  const data  = request.data as Record<string, unknown>
  const token = typeof data.token === 'string' ? data.token.trim() : ''
  const role  = (data.role as CustomerRole | undefined) ?? 'owner'

  if (!token) throw new HttpsError('invalid-argument', 'token is required.')
  if (!CUSTOMER_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of: ${CUSTOMER_ROLES.join(', ')}`)
  }

  const snap = await db.collection('customers')
    .where('setupToken', '==', token)
    .limit(1)
    .get()

  if (snap.empty) throw new HttpsError('not-found', 'Invalid or expired setup link.')

  const doc      = snap.docs[0]
  const compData = doc.data()
  const companyId = doc.id

  const expiry = compData.setupTokenExpiry?.toDate?.() as Date | undefined
  if (expiry && expiry < new Date()) {
    await doc.ref.update({ setupToken: FieldValue.delete(), setupTokenExpiry: FieldValue.delete() })
    throw new HttpsError('deadline-exceeded', 'This setup link has expired.')
  }
  if (compData.setupComplete) {
    throw new HttpsError('failed-precondition', 'An account has already been set up for this company.')
  }

  // Link user to company with their chosen role
  await applyCompanyClaim(request.auth!.uid, companyId, role)

  // Mark setup complete and consume the one-time token
  await doc.ref.update({
    setupComplete:    true,
    setupToken:       FieldValue.delete(),
    setupTokenExpiry: FieldValue.delete(),
    updatedAt:        FieldValue.serverTimestamp(),
  })

  // Sync user info to the company profile
  try {
    const userSnap  = await db.collection('users').doc(request.auth!.uid).get()
    const userData  = userSnap.data() ?? {}
    const userName  = (userData.name  as string | undefined) || ''
    const userEmail = (userData.email as string | undefined)
      || (request.auth!.token.email as string | undefined) || ''

    if (userName || userEmail) {
      const updatePayload: Record<string, unknown> = {}
      if (!compData.name  && userName)  updatePayload.name  = userName
      if (!compData.email && userEmail) updatePayload.email = userEmail
      if (role === 'owner') {
        if (!compData.billingContactName && userName)  updatePayload.billingContactName = userName
        if (!compData.billingEmail       && userEmail) updatePayload.billingEmail       = userEmail
      }
      if (Object.keys(updatePayload).length > 0) {
        updatePayload.updatedAt = FieldValue.serverTimestamp()
        await doc.ref.update(updatePayload)
      }
    }
  } catch (syncErr) {
    console.warn('[completeAccountSetup] failed to sync user info —', syncErr)
  }

  return { success: true, companyId, role }
})
