import type { Timestamp } from 'firebase/firestore'

export type UserRole = 'admin' | 'dispatch' | 'driver' | 'sales' | 'customer'

export interface AppUser {
  id: string
  email: string
  name: string
  role: UserRole
  active: boolean
  createdAt: Timestamp
  /** Set for customer-role users; links to the customers collection. */
  customerId?: string
  phone?: string
  avatarUrl?: string
  updatedAt: Timestamp
}
