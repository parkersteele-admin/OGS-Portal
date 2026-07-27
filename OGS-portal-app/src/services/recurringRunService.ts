import {
  addDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { recurringRunsCol } from '../lib/firestore'
import type {
  RecurringRunAssignment,
  RecurringRunFrequency,
  RecurringRunTemplate,
} from '../types/recurringRun'
import { OgsValidationError, serviceCall, fromSnap, sanitizeForFirestore } from './base'

export interface CreateRecurringRunInput {
  name: string
  driverId?: string
  dayOfWeek: number
  frequency: RecurringRunFrequency
  startDate: Date
  customerAssignments: RecurringRunAssignment[]
  notes?: string
  isActive?: boolean
}

export interface UpdateRecurringRunInput {
  name?: string
  driverId?: string
  dayOfWeek?: number
  frequency?: RecurringRunFrequency
  startDate?: Date
  customerAssignments?: RecurringRunAssignment[]
  notes?: string
  isActive?: boolean
}

export interface RecurringRunConflict {
  customerId: string
  customerName?: string
  conflictingTemplateIds: string[]
  conflictingTemplateNames: string[]
  dayOfWeek: number
  frequency: RecurringRunFrequency
}

function alignToWeekday(date: Date, dayOfWeek: number): Date {
  const next = new Date(date)
  const diff = (dayOfWeek - next.getDay() + 7) % 7
  next.setDate(next.getDate() + diff)
  return next
}

function advanceDate(date: Date, frequency: RecurringRunFrequency, dayOfWeek: number): Date {
  const next = new Date(date)
  if (frequency === 'weekly') {
    next.setDate(next.getDate() + 7)
    return next
  }
  if (frequency === 'biweekly') {
    next.setDate(next.getDate() + 14)
    return next
  }
  next.setMonth(next.getMonth() + 1)
  return alignToWeekday(next, dayOfWeek)
}

function computeNextRunDate(startDate: Date, dayOfWeek: number, frequency: RecurringRunFrequency): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let next = alignToWeekday(startDate, dayOfWeek)
  let guard = 0
  while (next < today && guard < 520) {
    next = advanceDate(next, frequency, dayOfWeek)
    guard += 1
  }
  return next
}

function normalizeAssignments(assignments: RecurringRunAssignment[]): RecurringRunAssignment[] {
  const keySet = new Set<string>()
  const normalized: RecurringRunAssignment[] = []

  for (const assignment of assignments) {
    const customerId = assignment.customerId?.trim()
    if (!customerId) continue
    const locationId = assignment.locationId?.trim() || undefined
    const key = `${customerId}::${locationId ?? ''}`
    if (keySet.has(key)) continue
    keySet.add(key)
    normalized.push({
      customerId,
      ...(locationId ? { locationId } : {}),
      ...(assignment.locationName ? { locationName: assignment.locationName } : {}),
    })
  }

  return normalized
}

function normalizedTemplateAssignments(template: RecurringRunTemplate): RecurringRunAssignment[] {
  const preferred = template.customerAssignments
  if (preferred && preferred.length > 0) return normalizeAssignments(preferred)
  return normalizeAssignments((template.customerIds ?? []).map((customerId) => ({ customerId })))
}

function assignmentCustomerIds(assignments: RecurringRunAssignment[]): string[] {
  return [...new Set(assignments.map((assignment) => assignment.customerId))]
}

function findConflicts(
  allTemplates: RecurringRunTemplate[],
  nextTemplate: {
    templateId?: string
    templateName: string
    dayOfWeek: number
    frequency: RecurringRunFrequency
    isActive: boolean
    assignments: RecurringRunAssignment[]
  },
): RecurringRunConflict[] {
  if (!nextTemplate.isActive) return []

  const nextCustomerIds = assignmentCustomerIds(nextTemplate.assignments)
  if (nextCustomerIds.length === 0) return []

  const conflictsByCustomer = new Map<string, RecurringRunConflict>()

  for (const existing of allTemplates) {
    if (!existing.isActive) continue
    if (nextTemplate.templateId && existing.id === nextTemplate.templateId) continue
    if (existing.dayOfWeek !== nextTemplate.dayOfWeek) continue
    if (existing.frequency !== nextTemplate.frequency) continue

    const existingCustomerIds = assignmentCustomerIds(normalizedTemplateAssignments(existing))
    for (const customerId of nextCustomerIds) {
      if (!existingCustomerIds.includes(customerId)) continue
      const prior = conflictsByCustomer.get(customerId)
      if (!prior) {
        conflictsByCustomer.set(customerId, {
          customerId,
          conflictingTemplateIds: [existing.id],
          conflictingTemplateNames: [existing.name],
          dayOfWeek: existing.dayOfWeek,
          frequency: existing.frequency,
        })
      } else {
        prior.conflictingTemplateIds.push(existing.id)
        prior.conflictingTemplateNames.push(existing.name)
      }
    }
  }

  return [...conflictsByCustomer.values()]
}

function assertNoConflicts(conflicts: RecurringRunConflict[]): void {
  if (conflicts.length === 0) return
  const conflictSummary = conflicts
    .slice(0, 5)
    .map((item) => `${item.customerId} in [${item.conflictingTemplateNames.join(', ')}]`)
    .join('; ')
  throw new OgsValidationError(`Recurring route conflict detected: ${conflictSummary}`)
}

export async function getRecurringRunTemplate(id: string): Promise<RecurringRunTemplate> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'recurringRuns', id))
    return fromSnap<RecurringRunTemplate>(snap, 'recurringRuns')
  })
}

export async function listRecurringRunTemplates(): Promise<RecurringRunTemplate[]> {
  return serviceCall(async () => {
    const snap = await getDocs(query(recurringRunsCol, orderBy('name')))
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as RecurringRunTemplate)
  })
}

export async function getRecurringRunConflicts(
  candidate: {
    templateId?: string
    templateName?: string
    dayOfWeek: number
    frequency: RecurringRunFrequency
    isActive: boolean
    customerAssignments: RecurringRunAssignment[]
  },
): Promise<RecurringRunConflict[]> {
  return serviceCall(async () => {
    const templates = await listRecurringRunTemplates()
    return findConflicts(templates, {
      templateId: candidate.templateId,
      templateName: candidate.templateName ?? 'Untitled Template',
      dayOfWeek: candidate.dayOfWeek,
      frequency: candidate.frequency,
      isActive: candidate.isActive,
      assignments: normalizeAssignments(candidate.customerAssignments),
    })
  })
}

export async function createRecurringRunTemplate(data: CreateRecurringRunInput): Promise<string> {
  return serviceCall(async () => {
    const startDate = alignToWeekday(data.startDate, data.dayOfWeek)
    const nextRunDate = computeNextRunDate(startDate, data.dayOfWeek, data.frequency)
    const customerAssignments = normalizeAssignments(data.customerAssignments)

    const templates = await listRecurringRunTemplates()
    const conflicts = findConflicts(templates, {
      templateName: data.name,
      dayOfWeek: data.dayOfWeek,
      frequency: data.frequency,
      isActive: data.isActive ?? true,
      assignments: customerAssignments,
    })
    assertNoConflicts(conflicts)

    const ref = await addDoc(recurringRunsCol, sanitizeForFirestore({
      name: data.name.trim(),
      driverId: data.driverId?.trim() || undefined,
      dayOfWeek: data.dayOfWeek,
      frequency: data.frequency,
      startDate: Timestamp.fromDate(startDate),
      customerAssignments,
      customerIds: assignmentCustomerIds(customerAssignments),
      notes: data.notes?.trim() || undefined,
      isActive: data.isActive ?? true,
      nextRunDate: Timestamp.fromDate(nextRunDate),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as Omit<RecurringRunTemplate, 'id'>))
    return ref.id
  })
}

export async function updateRecurringRunTemplate(
  id: string,
  patch: UpdateRecurringRunInput,
): Promise<void> {
  return serviceCall(async () => {
    const current = await getRecurringRunTemplate(id)
    const dayOfWeek = patch.dayOfWeek ?? current.dayOfWeek
    const frequency = patch.frequency ?? current.frequency
    const customerAssignments = normalizeAssignments(
      patch.customerAssignments ?? normalizedTemplateAssignments(current),
    )
    const isActive = patch.isActive ?? current.isActive
    const startDate = alignToWeekday(
      patch.startDate ?? current.startDate.toDate(),
      dayOfWeek,
    )

    const nextRunDate = computeNextRunDate(startDate, dayOfWeek, frequency)

    const templates = await listRecurringRunTemplates()
    const conflicts = findConflicts(templates, {
      templateId: id,
      templateName: patch.name ?? current.name,
      dayOfWeek,
      frequency,
      isActive,
      assignments: customerAssignments,
    })
    assertNoConflicts(conflicts)

    await updateDoc(doc(db, 'recurringRuns', id), sanitizeForFirestore({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.driverId !== undefined ? { driverId: patch.driverId.trim() || null } : {}),
      ...(patch.dayOfWeek !== undefined ? { dayOfWeek: patch.dayOfWeek } : {}),
      ...(patch.frequency !== undefined ? { frequency: patch.frequency } : {}),
      ...(patch.startDate !== undefined || patch.dayOfWeek !== undefined
        ? { startDate: Timestamp.fromDate(startDate) }
        : {}),
      ...(patch.customerAssignments !== undefined
        ? {
            customerAssignments,
            customerIds: assignmentCustomerIds(customerAssignments),
          }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() || null } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      nextRunDate: Timestamp.fromDate(nextRunDate),
      updatedAt: serverTimestamp(),
    }))
  })
}

export async function deleteRecurringRunTemplate(id: string): Promise<void> {
  return serviceCall(async () => {
    await deleteDoc(doc(db, 'recurringRuns', id))
  })
}

export function getTemplateAssignments(template: RecurringRunTemplate): RecurringRunAssignment[] {
  return normalizedTemplateAssignments(template)
}
