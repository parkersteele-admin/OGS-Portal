import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { usersCol } from '../lib/firestore'
import type { AppUser } from '../types/user'
import type { UserRole } from '../types/user'
import { serviceCall, fromSnap, OgsValidationError } from './base'

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getUser(id: string): Promise<AppUser> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'users', id))
    return fromSnap<AppUser>(snap, 'users')
  })
}

export async function getUsersByRole(role: UserRole): Promise<AppUser[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(usersCol, where('role', '==', role), orderBy('name')),
    )
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AppUser)
  })
}

export async function getActiveUsers(): Promise<AppUser[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(usersCol, where('active', '==', true), orderBy('name')),
    )
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AppUser)
  })
}

/**
 * Fetches all users belonging to a company (either via `companyId` or the
 * legacy `customerId` field). Sorts by name client-side to avoid composite
 * index requirements and the silent-exclusion problem with orderBy.
 */
export async function getUsersByCompany(companyId: string): Promise<AppUser[]> {
  return serviceCall(async () => {
    const [byCompanyId, byCustomerId] = await Promise.all([
      getDocs(query(usersCol, where('companyId',  '==', companyId))),
      getDocs(query(usersCol, where('customerId', '==', companyId))),
    ])
    const seen = new Set<string>()
    const users: AppUser[] = []
    for (const snap of [byCompanyId, byCustomerId]) {
      for (const d of snap.docs) {
        if (!seen.has(d.id)) {
          seen.add(d.id)
          const data = d.data() as unknown as Record<string, unknown>
          const fullName = [`${data['firstName'] ?? ''}`, `${data['lastName'] ?? ''}`].join(' ').trim()
          const name =
            (data['name'] as string | undefined) ||
            fullName ||
            (data['email'] as string | undefined) ||
            d.id
          users.push({ ...data, name, id: d.id } as AppUser)
        }
      }
    }
    return users.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  })
}

export function subscribeToUser(id: string, callback: (user: AppUser | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'users', id), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as AppUser) : null)
  })
}

// ── Write ─────────────────────────────────────────────────────────────────────

export type ProfileUpdateInput = Partial<Pick<AppUser, 'name' | 'phone' | 'avatarUrl'>>

export async function updateUserProfile(id: string, data: ProfileUpdateInput): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'users', id), { ...data, updatedAt: serverTimestamp() }),
  )
}

/** Role changes must go through a Cloud Function that also updates custom claims. */
export async function assignUserRole(userId: string, role: UserRole): Promise<void> {
  return serviceCall(async () => {
    const ALL_ROLES: UserRole[] = [
      'admin', 'dispatch', 'driver', 'sales',
      'customer', 'owner', 'manager', 'billing', 'delivery', 'viewer',
    ]
    if (!ALL_ROLES.includes(role)) {
      throw new OgsValidationError(`Invalid role: ${role}`)
    }
    const { httpsCallable } = await import('firebase/functions')
    const { functions } = await import('../lib/firebase')
    const fn = httpsCallable<{ uid: string; role: UserRole }, void>(
      functions,
      'setUserRole',
    )
    await fn({ uid: userId, role })
    // Optimistically update the Firestore doc — the Function also updates it server-side
    await updateDoc(doc(db, 'users', userId), { role, updatedAt: serverTimestamp() })
  })
}

export async function deactivateUser(id: string): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'users', id), { active: false, updatedAt: serverTimestamp() }),
  )
}

export async function reactivateUser(id: string): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'users', id), { active: true, updatedAt: serverTimestamp() }),
  )
}

export async function deleteUser(id: string): Promise<void> {
  return serviceCall(() => deleteDoc(doc(db, 'users', id)))
}

/** Hard-deletes a user from both Firebase Auth and Firestore via Cloud Function. */
export async function hardDeleteUser(uid: string): Promise<void> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions }     = await import('../lib/firebase')
    const fn = httpsCallable<{ uid: string }, { success: boolean }>(
      functions,
      'adminDeleteUser',
    )
    await fn({ uid })
  })
}

/** Sends a password-reset email to the given address via Firebase Auth client SDK. */
export async function sendPasswordReset(email: string): Promise<void> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions }     = await import('../lib/firebase')
    const fn = httpsCallable<{ email: string }, { success: boolean; emailSent: boolean }>(
      functions,
      'sendUserPasswordResetEmail',
    )
    await fn({ email: email.trim().toLowerCase() })
  })
}

/** Updates a user's company assignment in both Auth custom claims and Firestore. */
export async function updateUserCompany(uid: string, companyId: string | null): Promise<void> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions }     = await import('../lib/firebase')
    const fn = httpsCallable<{ uid: string; companyId: string | null }, { success: boolean }>(
      functions,
      'adminUpdateUserCompany',
    )
    await fn({ uid, companyId })
  })
}

// ── Admin: create user ────────────────────────────────────────────────────────
// Calls the adminCreateUser Cloud Function which uses the Admin SDK to:
//   1. Create the Firebase Auth user
//   2. Create the Firestore user doc
//   3. Set the custom role claim via setUserRole

export interface CreateUserInput {
  name:        string
  email:       string
  role:        UserRole
  customerId?: string
  companyId?:  string
}

export async function createAppUser(data: CreateUserInput): Promise<{ uid: string; linked: boolean; emailSent: boolean }> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions }     = await import('../lib/firebase')
    const fn = httpsCallable<CreateUserInput, { uid: string; linked: boolean; emailSent: boolean }>(
      functions,
      'adminCreateUser',
    )
    const result = await fn(data)
    return result.data
  })
}
