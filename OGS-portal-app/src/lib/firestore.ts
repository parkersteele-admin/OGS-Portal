import { collection, doc } from 'firebase/firestore'
import type { CollectionReference, DocumentData } from 'firebase/firestore'
import { db } from './firebase'
import type {
  AppUser,
  Customer,
  Tank,
  Order,
  Run,
  RunStop,
  Invoice,
  Payment,
  PaymentMethod,
  Lead,
  Quote,
  Product,
} from '../types/models'
import type { Notification } from '../types/index'

/** Cast a generic collection ref to a typed one. */
function col<T = DocumentData>(path: string): CollectionReference<T> {
  return collection(db, path) as CollectionReference<T>
}

// ── Users ─────────────────────────────────────────────────────────────────────
export const usersCol = col<AppUser>('users')

// ── Notifications ─────────────────────────────────────────────────────────────
export const notificationsCol = col<Notification>('notifications')

// ── Customers ─────────────────────────────────────────────────────────────────
export const customersCol = col<Customer>('customers')

/** /customers/{customerId}/tanks */
export const customerTanksCol = (customerId: string) =>
  col<Tank>(`customers/${customerId}/tanks`)

// ── Tanks (top-level for fleet queries) ──────────────────────────────────────
export const tanksCol      = col<Tank>('tanks')
export const tankEventsCol = (tankId: string) =>
  col<import('../types/tank').TankEvent>(`tanks/${tankId}/events`)

// ── Orders ────────────────────────────────────────────────────────────────────
export const ordersCol = col<Order>('orders')

// ── Runs ──────────────────────────────────────────────────────────────────────
export const runsCol = col<Run>('runs')

/** /runs/{runId}/stops */
export const runStopsCol = (runId: string) =>
  col<RunStop>(`runs/${runId}/stops`)

// ── Invoices ──────────────────────────────────────────────────────────────────
export const invoicesCol = col<Invoice>('invoices')

// ── Payments ──────────────────────────────────────────────────────────────────
export const paymentsCol = col<Payment>('payments')

/** /customers/{customerId}/paymentMethods */
export const paymentMethodsCol = (customerId: string) =>
  col<PaymentMethod>(`customers/${customerId}/paymentMethods`)

// ── CRM ───────────────────────────────────────────────────────────────────────
export const leadsCol = col<Lead>('leads')
export const quotesCol = col<Quote>('quotes')

// ── Products ──────────────────────────────────────────────────────────────────
export const productsCol = col<Product>('products')
export const productPricingCol = col<import('../types/product').ProductPricingInternal>('productPricing')

// ── Audit Log ─────────────────────────────────────────────────────────────────
export type AuditLogEntry = {
  id: string
  entity: string
  entityId: string
  field: string
  oldValue: string | number | boolean | null
  newValue: string | number | boolean | null
  changedBy: string   // uid
  changedAt: import('firebase/firestore').Timestamp
}
export const auditLogCol = col<AuditLogEntry>('auditLog')

// ── Settings ──────────────────────────────────────────────────────────────────
export const deliverySettingsRef = doc(db, 'settings', 'delivery')
