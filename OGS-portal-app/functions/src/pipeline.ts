/**
 * functions/src/pipeline.ts
 *
 * Callable Cloud Functions for the Sales Pipeline feature.
 *
 *   calculateLeadValue  — (re)calculates estimatedMonthlyValue from usageProfile
 *   logLeadActivity     — appends an ActivityEntry to leads/{companyId}.notes
 *   advanceLeadStage    — validates transition + writes new stage to stageHistory
 *   markLeadWon         — sets stage to 'won', optional win note
 *   markLeadLost        — sets stage to 'lost', requires loss reason
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, FieldValue, adminAuth } from './admin'
import { calculateEstimatedValue } from './lib/leadValue'
import { SENDGRID_API_KEY } from './config'
import { v4 as uuid } from 'uuid'

// ── Shared helpers ────────────────────────────────────────────────────────────

const STAGE_ORDER = [
  'new_signup',
  'pending_setup',
  'quote_requested',
  'quote_sent',
  'negotiating',
  'won',
]

const ALL_STAGES = [...STAGE_ORDER, 'lost', 'stalled']

function assertSalesOrAdmin(request: { auth?: { uid: string; token: Record<string, unknown> } }) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'You must be signed in.')
  const role = request.auth.token.role as string
  if (!['admin', 'sales'].includes(role)) {
    throw new HttpsError('permission-denied', 'Sales or admin role required.')
  }
}

async function getLead(companyId: string) {
  const snap = await db.collection('leads').doc(companyId).get()
  if (!snap.exists) throw new HttpsError('not-found', `Lead not found: ${companyId}`)
  return snap.data()!
}

// ── calculateLeadValue ────────────────────────────────────────────────────────

export const calculateLeadValue = onCall(async (request) => {
  assertSalesOrAdmin(request)
  const { companyId } = request.data as { companyId: string }
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.')

  const customerSnap = await db.collection('customers').doc(companyId).get()
  if (!customerSnap.exists) throw new HttpsError('not-found', `Customer not found: ${companyId}`)

  const emv = await calculateEstimatedValue(companyId, customerSnap.data()!)

  await db.collection('leads').doc(companyId).update({
    estimatedMonthlyValue: emv,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { estimatedMonthlyValue: emv }
})

// ── logLeadActivity ───────────────────────────────────────────────────────────

export const logLeadActivity = onCall(async (request) => {
  assertSalesOrAdmin(request)
  const { companyId, type, body } = request.data as {
    companyId: string
    type: string
    body: string
  }
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.')
  if (!body?.trim()) throw new HttpsError('invalid-argument', 'Activity body is required.')

  const validTypes = ['note', 'call', 'email', 'meeting']
  if (!validTypes.includes(type)) throw new HttpsError('invalid-argument', 'Invalid activity type.')

  const entry = {
    id: uuid(),
    type,
    body: body.trim(),
    createdBy: request.auth!.uid,
    createdAt: new Date(),
  }

  await db.collection('leads').doc(companyId).update({
    notes: FieldValue.arrayUnion(entry),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { success: true }
})

// ── advanceLeadStage ──────────────────────────────────────────────────────────

export const advanceLeadStage = onCall(async (request) => {
  assertSalesOrAdmin(request)
  const { companyId, stage, note } = request.data as {
    companyId: string
    stage: string
    note?: string
  }
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.')
  if (!ALL_STAGES.includes(stage)) throw new HttpsError('invalid-argument', `Invalid stage: ${stage}`)

  const lead = await getLead(companyId)
  const currentStage = lead.stage as string

  if (currentStage === stage) return { stage }  // no-op

  // Validate: won/lost are handled by their own callables; block direct calls
  if (stage === 'won' || stage === 'lost') {
    throw new HttpsError('invalid-argument', 'Use markLeadWon or markLeadLost for terminal stages.')
  }

  // Validate direction (can go backward for manual corrections, but log it)
  // FieldValue.serverTimestamp() cannot be used inside arrays;
  // use a real Date for values that go into stageHistory or arrayUnion entries.
  const now = FieldValue.serverTimestamp()
  const nowDate = new Date()
  const history = Array.isArray(lead.stageHistory) ? [...lead.stageHistory] : []
  const updated = history.map((e: Record<string, unknown>) =>
    e.exitedAt === null ? { ...e, exitedAt: nowDate } : e,
  )
  updated.push({
    stage,
    enteredAt: nowDate,
    exitedAt: null,
    actor: request.auth!.uid,
    note: note ?? null,
  })

  const activityEntry = {
    id: uuid(),
    type: 'stage_change',
    body: `Stage changed from "${currentStage}" to "${stage}"${note ? `: ${note}` : ''}`,
    createdBy: request.auth!.uid,
    createdAt: nowDate,
  }

  await db.collection('leads').doc(companyId).update({
    stage,
    stageHistory: updated,
    notes: FieldValue.arrayUnion(activityEntry),
    updatedAt: now,
  })

  return { stage }
})

// ── markLeadWon ───────────────────────────────────────────────────────────────

export const markLeadWon = onCall(async (request) => {
  assertSalesOrAdmin(request)
  const { companyId, note } = request.data as { companyId: string; note?: string }
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.')

  const lead = await getLead(companyId)
  if (lead.stage === 'won') return { stage: 'won' }

  const now = FieldValue.serverTimestamp()
  const nowDate = new Date()
  const history = Array.isArray(lead.stageHistory) ? [...lead.stageHistory] : []
  const updated = history.map((e: Record<string, unknown>) =>
    e.exitedAt === null ? { ...e, exitedAt: nowDate } : e,
  )
  updated.push({ stage: 'won', enteredAt: nowDate, exitedAt: null, actor: request.auth!.uid, note: note ?? null })

  const activityEntry = {
    id: uuid(),
    type: 'stage_change',
    body: `Lead marked as Won${note ? `: ${note}` : ''}`,
    createdBy: request.auth!.uid,
    createdAt: nowDate,
  }

  await db.collection('leads').doc(companyId).update({
    stage: 'won',
    stageHistory: updated,
    notes: FieldValue.arrayUnion(activityEntry),
    updatedAt: now,
  })

  return { stage: 'won' }
})

// ── markLeadLost ──────────────────────────────────────────────────────────────

export const markLeadLost = onCall(
  { secrets: [SENDGRID_API_KEY] },
  async (request) => {
    assertSalesOrAdmin(request)
    const { companyId, lostReason, note } = request.data as {
      companyId: string
      lostReason: string
      note?: string
    }
    if (!companyId)   throw new HttpsError('invalid-argument', 'companyId is required.')
    if (!lostReason)  throw new HttpsError('invalid-argument', 'lostReason is required.')

    const validReasons = ['chose_competitor', 'price', 'no_longer_needed', 'unresponsive', 'other']
    if (!validReasons.includes(lostReason)) {
      throw new HttpsError('invalid-argument', `Invalid lostReason: ${lostReason}`)
    }

    const lead = await getLead(companyId)
    if (lead.stage === 'lost') return { stage: 'lost' }

    const now = FieldValue.serverTimestamp()
    const nowDate = new Date()
    const history = Array.isArray(lead.stageHistory) ? [...lead.stageHistory] : []
    const updated = history.map((e: Record<string, unknown>) =>
      e.exitedAt === null ? { ...e, exitedAt: nowDate } : e,
    )
    updated.push({ stage: 'lost', enteredAt: nowDate, exitedAt: null, actor: request.auth!.uid, note: note ?? null })

    const activityEntry = {
      id: uuid(),
      type: 'stage_change',
      body: `Lead marked as Lost — Reason: ${lostReason}${note ? ` — ${note}` : ''}`,
      createdBy: request.auth!.uid,
      createdAt: nowDate,
    }

    await db.collection('leads').doc(companyId).update({
      stage: 'lost',
      lostReason,
      stageHistory: updated,
      notes: FieldValue.arrayUnion(activityEntry),
      updatedAt: now,
    })

    return { stage: 'lost' }
  },
)

// ── assignLead ────────────────────────────────────────────────────────────────

export const assignLead = onCall(async (request) => {
  assertSalesOrAdmin(request)
  const { companyId, assignedTo } = request.data as {
    companyId: string
    assignedTo: string | null
  }
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.')

  if (assignedTo) {
    // Validate the assigned user exists and has sales or admin role
    try {
      const user = await adminAuth.getUser(assignedTo)
      const role = (user.customClaims as Record<string, unknown> | undefined)?.role as string
      if (!['admin', 'sales'].includes(role)) {
        throw new HttpsError('invalid-argument', 'Assigned user must be a sales rep or admin.')
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err
      throw new HttpsError('not-found', 'Assigned user not found.')
    }
  }

  await db.collection('leads').doc(companyId).update({
    assignedTo: assignedTo ?? null,
    assignedAt: assignedTo ? FieldValue.serverTimestamp() : null,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { success: true }
})

// ── scheduleFollowUp ──────────────────────────────────────────────────────────

export const scheduleFollowUp = onCall(async (request) => {
  assertSalesOrAdmin(request)
  const { companyId, nextFollowUpAt } = request.data as {
    companyId: string
    nextFollowUpAt: number  // Unix milliseconds
  }
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.')
  if (!nextFollowUpAt) throw new HttpsError('invalid-argument', 'nextFollowUpAt is required.')

  const date = new Date(nextFollowUpAt)
  await db.collection('leads').doc(companyId).update({
    nextFollowUpAt: date,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { success: true }
})
