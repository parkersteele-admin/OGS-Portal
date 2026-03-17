import type { UserRole } from './user'

export type { UserRole } from './user'

/** Lightweight Firebase Auth + role shape used by useAuth / ProtectedRoute. */
export interface AuthUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  role: UserRole
}

/** Default landing path for each role after sign-in */
export const ROLE_HOME: Record<UserRole, string> = {
  customer: '/portal/dashboard',
  admin:    '/ops/dashboard',
  dispatch: '/ops/dashboard',
  driver:   '/driver/schedule',
  sales:    '/crm/customers',
}
