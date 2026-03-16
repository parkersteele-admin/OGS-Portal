import { collection } from 'firebase/firestore'
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
export const tanksCol = col<Tank>('tanks')

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
