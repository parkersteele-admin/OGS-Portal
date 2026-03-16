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
    if (!['admin', 'dispatch', 'driver', 'sales', 'customer'].includes(role)) {
      throw new OgsValidationError(`Invalid role: ${role}`)
    }
    const { httpsCallable } = await import('firebase/functions')
    const { functions } = await import('../lib/firebase')
    const fn = httpsCallable<{ userId: string; role: UserRole }, void>(
      functions,
      'setUserRole',
    )
    await fn({ userId, role })
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
}

export async function createAppUser(data: CreateUserInput): Promise<string> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions }     = await import('../lib/firebase')
    const fn = httpsCallable<CreateUserInput, { uid: string }>(
      functions,
      'adminCreateUser',
    )
    const result = await fn(data)
    return result.data.uid
  })
}
