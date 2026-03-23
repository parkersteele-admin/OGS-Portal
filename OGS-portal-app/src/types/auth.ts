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
  // Legacy customer role
  customer: '/portal/dashboard',
  // Customer sub-roles (onboarding)
  owner:    '/portal/dashboard',
  manager:  '/portal/dashboard',
  billing:  '/portal/dashboard',
  delivery: '/portal/dashboard',
  viewer:   '/portal/dashboard',
  // OGS internal roles
  admin:    '/ops/dashboard',
  dispatch: '/ops/dispatch',
  driver:   '/driver/schedule',
  sales:    '/crm/customers',
}
