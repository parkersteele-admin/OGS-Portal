import {
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { leadsCol } from '../lib/firestore'
import type { Lead, LeadStatus } from '../types/crm'
import type { CreateCustomerInput } from './customerService'
import { serviceCall, fromSnap, paginate, type Page, type PageOptions, OgsValidationError } from './base'

export interface LeadFilters {
  status?: LeadStatus
  assignedTo?: string
}

export interface CreateLeadInput {
  name: string
  email: string
  phone?: string
  company?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  source?: string
  assignedTo?: string
  estimatedValue?: number
  notes?: string
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getLead(id: string): Promise<Lead> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'leads', id))
    return fromSnap<Lead>(snap, 'leads')
  })
}

export async function getLeads(
  filters: LeadFilters = {},
  options: PageOptions = {},
): Promise<Page<Lead>> {
  return serviceCall(async () => {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')]
    if (filters.status)     constraints.push(where('status', '==', filters.status))
    if (filters.assignedTo) constraints.push(where('assignedTo', '==', filters.assignedTo))
    return paginate<Lead>(leadsCol, constraints, options)
  })
}

export function subscribeToLead(id: string, callback: (lead: Lead | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'leads', id), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Lead) : null)
  })
}

export function subscribeToLeads(
  filters: LeadFilters = {},
  callback: (leads: Lead[]) => void,
): Unsubscribe {
  const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')]
  if (filters.status)     constraints.push(where('status', '==', filters.status))
  if (filters.assignedTo) constraints.push(where('assignedTo', '==', filters.assignedTo))
  return onSnapshot(query(leadsCol, ...constraints), (snap) => {
    callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Lead))
  })
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createLead(data: CreateLeadInput): Promise<string> {
  return serviceCall(async () => {
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    const ref = await addDoc(leadsCol, {
      ...clean,
      status: 'new' as LeadStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as Omit<Lead, 'id'>)
    return ref.id
  })
}

export async function updateLead(
  id: string,
  data: Partial<Omit<Lead, 'id' | 'createdAt'>>,
): Promise<void> {
  return serviceCall(() => {
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    return updateDoc(doc(db, 'leads', id), { ...clean, updatedAt: serverTimestamp() })
  })
}

export async function advanceLeadStage(id: string, nextStatus: LeadStatus): Promise<void> {
  const ORDER: LeadStatus[] = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']
  return serviceCall(async () => {
    const lead = await getLead(id)
    const currentIdx = ORDER.indexOf(lead.status)
    const nextIdx = ORDER.indexOf(nextStatus)
    // Allow advancing forward or marking lost from any stage
    if (nextStatus !== 'lost' && nextIdx <= currentIdx) {
      throw new OgsValidationError(
        `Cannot move lead from '${lead.status}' to '${nextStatus}'`,
      )
    }
    await updateDoc(doc(db, 'leads', id), { status: nextStatus, updatedAt: serverTimestamp() })
  })
}

export async function deleteLead(id: string): Promise<void> {
  return serviceCall(() => deleteDoc(doc(db, 'leads', id)))
}

/**
 * Converts a won lead into a Customer record.
 * Marks the lead as 'won' and stores the resulting customerId on it.
 */
export async function convertLeadToCustomer(leadId: string): Promise<string> {
  return serviceCall(async () => {
    const lead = await getLead(leadId)
    if (lead.status === 'won' && lead.convertedToCustomerId) {
      throw new OgsValidationError('Lead has already been converted')
    }

    const { createCustomer } = await import('./customerService')
    const customerInput: CreateCustomerInput = {
      name: lead.company ?? lead.name,
      email: lead.email,
      phone: lead.phone ?? '',
      address: lead.address ?? '',
      city: lead.city ?? '',
      state: lead.state ?? '',
      zip: lead.zip ?? '',
      notes: lead.notes,
      leadId: leadId,
    }
    const customerId = await createCustomer(customerInput)

    await updateDoc(doc(db, 'leads', leadId), {
      status: 'won' as LeadStatus,
      convertedToCustomerId: customerId,
      updatedAt: serverTimestamp(),
    })

    return customerId
  })
}
