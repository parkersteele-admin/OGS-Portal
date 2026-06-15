/**
 * src/services/permissionService.ts
 *
 * Client-side authorization service.
 * Prevents unauthorized requests from reaching the backend.
 *
 * PROBLEM SOLVED:
 * ───────────────
 * Previously: Authorization ONLY at Firestore rules level
 *   - User clicks button → Service makes API call → Backend rejects
 *   - UX is poor (spinner, then error)
 *   - Wasted network bandwidth
 *   - Malicious user could spam unauthorized requests
 *
 * NOW: Authorization checks BEFORE making service calls
 *   - No spinner if user doesn't have permission
 *   - Better security posture
 *   - Fail-fast principle
 */

import type { AuthUser } from '../types/auth'
import type { Order } from '../types/order'
import type { Run } from '../types/run'

export interface PermissionContext {
  user: AuthUser
  isAdmin: boolean
  isDispatch: boolean
  isDriver: boolean
  isSales: boolean
  isCustomer: boolean
}

/**
 * Check if current user has permission to view a customer record.
 *
 * @param context - Current user's auth context
 * @param customerId - Customer ID to access
 * @returns true if user can view this customer
 *
 * @example
 *   const canView = canViewCustomer(userContext, customerId)
 *   if (!canView) throw new OgsPermissionError('Cannot view this customer')
 *
 * RULES:
 *   - Admin: Can view any customer
 *   - Dispatch: Can view customers they manage
 *   - Customer: Can view only their own records
 *   - Driver: Cannot view customer records (only via runs)
 */
export function canViewCustomer(
  context: PermissionContext,
  customerId: string,
): boolean {
  if (context.isAdmin) return true
  if (context.isDispatch) return true // Dispatch can view all
  if (context.isCustomer && (context.user as any).customerId === customerId) return true
  return false
}

/**
 * Check if current user can edit an order.
 *
 * @param context - Current user's auth context
 * @param order - Order to edit
 * @returns true if user can edit this order
 *
 * RULES:
 *   - Admin: Can edit any order in any status
 *   - Dispatch: Can edit orders in 'pending' or 'assigned' status
 *   - Customer: Can edit only their own orders in 'pending' status
 *   - Driver: Cannot edit orders
 */
export function canEditOrder(
  context: PermissionContext,
  order: Order,
): boolean {
  if (context.isAdmin) return true

  if (context.isDispatch) {
    return order.status === 'pending' || order.status === 'assigned'
  }

  if (
    context.isCustomer &&
    (context.user as any).customerId === order.customerId &&
    order.status === 'pending'
  ) {
    return true
  }

  return false
}

/**
 * Check if current user can delete an order.
 *
 * RULES:
 *   - Admin: Can delete any order
 *   - Dispatch: Can delete 'pending' orders only
 *   - Customer: Can delete their own 'pending' orders
 */
export function canDeleteOrder(
  context: PermissionContext,
  order: Order,
): boolean {
  if (context.isAdmin) return true
  if (context.isDispatch && order.status === 'pending') return true
  if (
    context.isCustomer &&
    (context.user as any).customerId === order.customerId &&
    order.status === 'pending'
  ) {
    return true
  }
  return false
}

/**
 * Check if current user can access a run for viewing/editing.
 *
 * @param context - Current user's auth context
 * @param run - Run to access
 * @returns true if user can access this run
 *
 * RULES:
 *   - Admin: Can access any run
 *   - Dispatch: Can access any run (they manage dispatch)
 *   - Driver: Can access only runs assigned to them
 *   - Customer: Cannot access runs directly
 */
export function canAccessRun(
  context: PermissionContext,
  run: Run,
): boolean {
  if (context.isAdmin) return true
  if (context.isDispatch) return true
  if (context.isDriver && context.user.uid === (run as any).assignedDriverId) {
    return true
  }
  return false
}

/**
 * Check if current user can edit a run (change driver, reorder stops, etc).
 *
 * RULES:
 *   - Admin: Can edit any run in any status
 *   - Dispatch: Can edit runs in 'pending' or 'assigned' status
 *   - Driver: Cannot edit runs
 */
export function canEditRun(context: PermissionContext, run: Run): boolean {
  if (context.isAdmin) return true
  if (context.isDispatch && (run.status === 'scheduled' || run.status === 'in-progress')) {
    return true
  }
  return false
}

/**
 * Check if current user can view an invoice.
 *
 * RULES:
 *   - Admin: Can view any invoice
 *   - Dispatch: Can view customer invoices they manage
 *   - Customer: Can view only their own invoices
 */
export function canViewInvoice(
  context: PermissionContext,
  invoiceCustomerId: string,
): boolean {
  if (context.isAdmin) return true
  if (context.isDispatch) return true
  if (context.isCustomer && (context.user as any).customerId === invoiceCustomerId) {
    return true
  }
  return false
}

/**
 * Check if current user can pay an invoice.
 *
 * RULES:
 *   - Admin: Can mark any invoice as paid (for admin manual payments)
 *   - Customer: Can pay only their own unpaid invoices
 */
export function canPayInvoice(
  context: PermissionContext,
  invoiceCustomerId: string,
): boolean {
  if (context.isAdmin) return true
  if (
    context.isCustomer &&
    (context.user as any).customerId === invoiceCustomerId
  ) {
    return true
  }
  return false
}

/**
 * USAGE IN SERVICE LAYER
 *
 * Before:
 * ───────
 * export async function updateOrder(id: string, data: Partial<Order>) {
 *   // No permission check! User sees error only after network call
 *   const docRef = doc(db, 'orders', id)
 *   return updateDoc(docRef, sanitizeForFirestore(data))
 * }
 *
 * After:
 * ──────
 * export async function updateOrder(id: string, data: Partial<Order>) {
 *   const currentUser = useAuth() // Get from context/hook
 *   const order = await getOrder(id)
 *
 *   const permissions = {
 *     user: currentUser,
 *     isAdmin: currentUser.role === 'admin',
 *     isDispatch: currentUser.role === 'dispatch',
 *     isDriver: currentUser.role === 'driver',
 *     isSales: currentUser.role === 'sales',
 *     isCustomer: ['customer', 'owner', 'manager'].includes(currentUser.role),
 *   }
 *
 *   if (!canEditOrder(permissions, order)) {
 *     throw new OgsPermissionError(
 *       `You don't have permission to edit this order (status: ${order.status})`
 *     )
 *   }
 *
 *   const docRef = doc(db, 'orders', id)
 *   return updateDoc(docRef, {
 *     ...sanitizeForFirestore(data),
 *     updatedAt: serverTimestamp(),
 *   })
 * }
 *
 * Benefits:
 * ─────────
 * ✅ Fails immediately (no wasted network calls)
 * ✅ Better error messages for users
 * ✅ Firestore rules still enforce security (defense in depth)
 * ✅ Prevents accidental malicious requests
 */
