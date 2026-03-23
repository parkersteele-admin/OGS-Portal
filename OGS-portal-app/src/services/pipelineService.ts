/**
 * src/services/pipelineService.ts
 *
 * Frontend service for the Sales Pipeline feature.
 * Reads/writes leads/{companyId} documents; wraps with serviceCall() for
 * standardised error mapping. Real-time subscriptions return Unsubscribe.
 */

import {
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../lib/firebase'
import { pipelineLeadsCol } from '../lib/firestore'
import { serviceCall } from './base'
import type {
  PipelineLead,
  PipelineStage,
  PipelineFilters,
  LeadPriority,
  ActivityType,
  LossReason,
} from '../types/pipeline'

// ── Re-export helper for consistent use ──────────────────────────────────────

function toId(snap: QueryDocumentSnapshot): PipelineLead {
  return { id: snap.id, ...snap.data() } as PipelineLead
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function getLead(companyId: string): Promise<PipelineLead | null> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'leads', companyId))
    return snap.exists() ? toId(snap) : null
  })
}

export async function getLeadsByStage(stage: PipelineStage): Promise<PipelineLead[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(pipelineLeadsCol, where('stage', '==', stage), orderBy('updatedAt', 'desc')),
    )
    return snap.docs.map(toId)
  })
}

export async function getAllActiveLeads(): Promise<PipelineLead[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(
        pipelineLeadsCol,
        where('stage', 'not-in', ['won', 'lost']),
        orderBy('stage'),
        orderBy('updatedAt', 'desc'),
      ),
    )
    return snap.docs.map(toId)
  })
}

export async function getWonLeads(): Promise<PipelineLead[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(pipelineLeadsCol, where('stage', '==', 'won'), orderBy('updatedAt', 'desc')),
    )
    return snap.docs.map(toId)
  })
}

export async function getLostLeads(): Promise<PipelineLead[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(pipelineLeadsCol, where('stage', '==', 'lost'), orderBy('updatedAt', 'desc')),
    )
    return snap.docs.map(toId)
  })
}

/** Today's overdue follow-ups (nextFollowUpAt < now, not won/lost) */
export async function getOverdueFollowUps(): Promise<PipelineLead[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(
        pipelineLeadsCol,
        where('nextFollowUpAt', '<', Timestamp.now()),
        where('stage', 'not-in', ['won', 'lost']),
        orderBy('nextFollowUpAt', 'asc'),
      ),
    )
    return snap.docs.map(toId)
  })
}

/** New online signups created today */
export async function getNewSignupsToday(): Promise<PipelineLead[]> {
  return serviceCall(async () => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const snap = await getDocs(
      query(
        pipelineLeadsCol,
        where('source', '==', 'online_signup'),
        where('createdAt', '>=', Timestamp.fromDate(todayStart)),
        orderBy('createdAt', 'desc'),
      ),
    )
    return snap.docs.map(toId)
  })
}

export async function getStalledLeads(): Promise<PipelineLead[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(pipelineLeadsCol, where('stage', '==', 'stalled'), orderBy('updatedAt', 'asc')),
    )
    return snap.docs.map(toId)
  })
}

// ── Real-time subscriptions ───────────────────────────────────────────────────

/** Live subscription to all active (non-terminal) leads. */
export function subscribeToActiveLeads(
  callback: (leads: PipelineLead[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      pipelineLeadsCol,
      where('stage', 'not-in', ['won', 'lost']),
      orderBy('stage'),
      orderBy('updatedAt', 'desc'),
    ),
    (snap) => callback(snap.docs.map(toId)),
  )
}

/** Live subscription to a specific lead doc. */
export function subscribeToLead(
  companyId: string,
  callback: (lead: PipelineLead | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'leads', companyId), (snap) => {
    callback(snap.exists() ? toId(snap) : null)
  })
}

// ── Filter helper ─────────────────────────────────────────────────────────────

export function applyFilters(leads: PipelineLead[], filters: PipelineFilters): PipelineLead[] {
  return leads.filter((l) => {
    if (filters.unassignedOnly && l.assignedTo !== null) return false
    if (filters.assignedTo.length > 0 && !filters.assignedTo.includes(l.assignedTo ?? '')) return false
    if (filters.businessType.length > 0 && !filters.businessType.includes(l.businessType ?? '')) return false
    if (filters.priority.length > 0 && !filters.priority.includes(l.priority)) return false
    return true
  })
}

// ── Callables ─────────────────────────────────────────────────────────────────

export async function callAdvanceLeadStage(
  companyId: string,
  stage: PipelineStage,
  note?: string,
): Promise<void> {
  const fn = httpsCallable(functions, 'advanceLeadStage')
  await fn({ companyId, stage, note })
}

export async function callMarkLeadWon(companyId: string, note?: string): Promise<void> {
  const fn = httpsCallable(functions, 'markLeadWon')
  await fn({ companyId, note })
}

export async function callMarkLeadLost(
  companyId: string,
  lostReason: LossReason,
  note?: string,
): Promise<void> {
  const fn = httpsCallable(functions, 'markLeadLost')
  await fn({ companyId, lostReason, note })
}

export async function callLogLeadActivity(
  companyId: string,
  type: ActivityType,
  body: string,
): Promise<void> {
  const fn = httpsCallable(functions, 'logLeadActivity')
  await fn({ companyId, type, body })
}

export async function callAssignLead(
  companyId: string,
  assignedTo: string | null,
): Promise<void> {
  const fn = httpsCallable(functions, 'assignLead')
  await fn({ companyId, assignedTo })
}

export async function callScheduleFollowUp(
  companyId: string,
  nextFollowUpAt: Date,
): Promise<void> {
  const fn = httpsCallable(functions, 'scheduleFollowUp')
  await fn({ companyId, nextFollowUpAt: nextFollowUpAt.getTime() })
}

export async function callCalculateLeadValue(companyId: string): Promise<number> {
  const fn = httpsCallable<{ companyId: string }, { estimatedMonthlyValue: number }>(
    functions, 'calculateLeadValue',
  )
  const result = await fn({ companyId })
  return result.data.estimatedMonthlyValue
}

// ── Priority helper ───────────────────────────────────────────────────────────

export async function updateLeadPriority(
  companyId: string,
  priority: LeadPriority,
): Promise<void> {
  // Direct Firestore write — no callable needed for priority
  const { updateDoc } = await import('firebase/firestore')
  const { serverTimestamp } = await import('firebase/firestore')
  await updateDoc(doc(db, 'leads', companyId), {
    priority,
    updatedAt: serverTimestamp(),
  })
}
