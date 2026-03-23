/**
 * src/services/onboardingService.ts
 *
 * Firestore read/write operations for the customer onboarding flow.
 * All writes go through serviceCall() for consistent error handling.
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  collection,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import {
  companiesCol,
  companyLocationsCol,
  creditApplicationsCol,
  quoteRequestsCol,
  invitesCol,
  joinRequestsCol,
} from '../lib/firestore'
import type {
  Company,
  CompanySetupStep,
  DeliveryLocation,
  CreditApplication,
  QuoteRequest,
  TeamInvite,
  JoinRequest,
  OnboardingUser,
} from '../types/company'
import { serviceCall } from './base'

// ── Company ───────────────────────────────────────────────────────────────────

export async function getCompany(companyId: string): Promise<Company | null> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'customers', companyId))
    if (!snap.exists()) return null
    return { companyId: snap.id, ...(snap.data() as Omit<Company, 'companyId'>) }
  })
}

export function subscribeToCompany(
  companyId: string,
  callback: (company: Company | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'customers', companyId), (snap) => {
    if (!snap.exists()) {
      callback(null)
      return
    }
    callback({ companyId: snap.id, ...(snap.data() as Omit<Company, 'companyId'>) })
  })
}

export async function updateCompany(
  companyId: string,
  data: Partial<Omit<Company, 'companyId' | 'createdAt' | 'createdBy'>>,
): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'customers', companyId), data as Record<string, unknown>),
  )
}

export async function advanceSetupStep(
  companyId: string,
  step: CompanySetupStep,
): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'customers', companyId), { setupStep: step }),
  )
}

// ── Locations ─────────────────────────────────────────────────────────────────

export async function getLocations(companyId: string): Promise<DeliveryLocation[]> {
  return serviceCall(async () => {
    const snap = await getDocs(companyLocationsCol(companyId))
    return snap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as Omit<DeliveryLocation, 'id'>) }),
    )
  })
}

export async function saveLocation(
  companyId: string,
  data: Omit<DeliveryLocation, 'id'>,
  locationId?: string,
): Promise<string> {
  return serviceCall(async () => {
    if (locationId) {
      await setDoc(
        doc(db, 'customers', companyId, 'locations', locationId),
        data,
        { merge: true },
      )
      return locationId
    }
    const ref = await addDoc(companyLocationsCol(companyId), data)
    return ref.id
  })
}

export async function deleteLocation(companyId: string, locationId: string): Promise<void> {
  return serviceCall(async () => {
    const { deleteDoc } = await import('firebase/firestore')
    await deleteDoc(doc(db, 'customers', companyId, 'locations', locationId))
  })
}

// ── Credit Application ────────────────────────────────────────────────────────

export async function saveCreditApplication(
  data: Omit<CreditApplication, 'status'>,
): Promise<void> {
  return serviceCall(() =>
    setDoc(doc(db, 'creditApplications', data.companyId), {
      ...data,
      status: 'pending_review',
      submittedAt: serverTimestamp(),
    }),
  )
}

export async function getCreditApplication(
  companyId: string,
): Promise<CreditApplication | null> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'creditApplications', companyId))
    if (!snap.exists()) return null
    return snap.data() as CreditApplication
  })
}

// ── Quote Request ─────────────────────────────────────────────────────────────

export async function createQuoteRequest(
  data: Omit<QuoteRequest, 'id' | 'status' | 'createdAt'>,
): Promise<string> {
  return serviceCall(async () => {
    const ref = await addDoc(quoteRequestsCol, {
      ...data,
      status: 'pending',
      createdAt: serverTimestamp(),
    })
    return ref.id
  })
}

// ── Invites ───────────────────────────────────────────────────────────────────

export async function getInvite(inviteId: string): Promise<TeamInvite | null> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'invites', inviteId))
    if (!snap.exists()) return null
    return { id: snap.id, ...(snap.data() as Omit<TeamInvite, 'id'>) }
  })
}

export function subscribeToCompanyInvites(
  companyId: string,
  callback: (invites: TeamInvite[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(invitesCol, where('companyId', '==', companyId)),
    (snap) => {
      callback(
        snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Omit<TeamInvite, 'id'>) }),
        ),
      )
    },
  )
}

// ── Join Requests ─────────────────────────────────────────────────────────────

export function subscribeToJoinRequests(
  companyId: string,
  callback: (requests: JoinRequest[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      joinRequestsCol,
      where('companyId', '==', companyId),
      where('status', '==', 'pending'),
    ),
    (snap) => {
      callback(
        snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as Omit<JoinRequest, 'id'>) }),
        ),
      )
    },
  )
}

// ── Team (company users) ──────────────────────────────────────────────────────

export function subscribeToTeam(
  companyId: string,
  callback: (users: OnboardingUser[]) => void,
): Unsubscribe {
  const usersCol = collection(db, 'users')
  return onSnapshot(
    query(usersCol, where('companyId', '==', companyId)),
    (snap) => {
      callback(snap.docs.map((d) => d.data() as OnboardingUser))
    },
  )
}
