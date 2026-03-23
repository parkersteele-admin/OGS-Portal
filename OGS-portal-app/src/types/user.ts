import type { Timestamp } from 'firebase/firestore'

/** OGS internal roles */
export type OgsRole = 'admin' | 'dispatch' | 'driver' | 'sales'

/** Customer-side granular roles (set as custom claims on onboarding) */
export type CustomerRole = 'owner' | 'manager' | 'billing' | 'delivery' | 'viewer'

/**
 * All supported user roles.
 * `'customer'` is the legacy single-role value kept for backward compatibility
 * with accounts created before the onboarding flow. New customer accounts will
 * have one of the CustomerRole values above.
 */
export type UserRole = OgsRole | CustomerRole | 'customer'

export interface AppUser {
  id: string
  email: string
  name: string
  role: UserRole
  active: boolean
  createdAt: Timestamp
  /** Set for customer-role users; links to the customers collection (CRM). */
  customerId?: string
  /**
   * Links to the customers/{companyId} document created during onboarding.
   * Null until a join request is approved or an invite is accepted.
   */
  companyId?: string | null
  phone?: string
  avatarUrl?: string
  updatedAt: Timestamp
}
