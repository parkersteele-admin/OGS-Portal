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
import type { RecurringRunTemplate } from '../types/recurringRun'
import type { Notification } from '../types/index'
import type { Cylinder, ManifestItem, CylinderFlag } from '../types/cylinder'

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

export const customerProductPricingCol = (customerId: string) =>
  col<import('../types/customerPricing').CustomerProductPricing>(`customers/${customerId}/productPricing`)

// ── Tanks (top-level for fleet queries) ──────────────────────────────────────
export const tanksCol      = col<Tank>('tanks')
export const tankEventsCol = (tankId: string) =>
  col<import('../types/tank').TankEvent>(`tanks/${tankId}/events`)

// ── Orders ────────────────────────────────────────────────────────────────────
export const ordersCol = col<Order>('orders')

// ── Runs ──────────────────────────────────────────────────────────────────────
export const runsCol = col<Run>('runs')

/** Recurring run templates used by the Runs recurring planner UI. */
export const recurringRunsCol = col<RecurringRunTemplate>('recurringRuns')

/** /runs/{runId}/stops */
export const runStopsCol = (runId: string) =>
  col<RunStop>(`runs/${runId}/stops`)

/** /runs/{runId}/manifest */
export const runManifestCol = (runId: string) =>
  col<ManifestItem>(`runs/${runId}/manifest`)

/** /runs/{runId}/flags */
export const runFlagsCol = (runId: string) =>
  col<CylinderFlag>(`runs/${runId}/flags`)

// ── Cylinders (physical cylinder registry) ────────────────────────────────────
export const cylindersCol = col<Cylinder>('cylinders')

// ── Invoices ──────────────────────────────────────────────────────────────────
export const invoicesCol = col<Invoice>('invoices')

// ── Payments ──────────────────────────────────────────────────────────────────
export const paymentsCol = col<Payment>('payments')

/** /customers/{customerId}/paymentMethods */
export const paymentMethodsCol = (customerId: string) =>
  col<PaymentMethod>(`customers/${customerId}/paymentMethods`)

// ── Route Schedules ───────────────────────────────────────────────────────────
import type { RouteSchedule } from '../types/order'

/** /customers/{customerId}/routeSchedule (single doc) */
export const routeScheduleRef = (customerId: string) =>
  doc(db, 'customers', customerId, 'routeSchedule', 'current')

/** /customers/{customerId}/routeSchedule/history (audit log sub-collection) */
export const routeScheduleHistoryCol = (customerId: string) =>
  col<import('../types/order').RouteSchedule & { updatedBy: string; updatedAt: import('firebase/firestore').Timestamp }>(
    `customers/${customerId}/routeScheduleHistory`,
  )

export type { RouteSchedule }

// ── CRM ───────────────────────────────────────────────────────────────────────
export const leadsCol = col<Lead>('leads')
export const quotesCol = col<Quote>('quotes')

// ── Sales Pipeline (leads 1:1 with customers/{companyId}) ─────────────────────
export const pipelineLeadsCol = col<import('../types/pipeline').PipelineLead>('leads')

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
export const companySettingsRef  = doc(db, 'settings', 'company')

// ── Onboarding / Company ──────────────────────────────────────────────────────
import type {
  Company,
  DeliveryLocation,
  CreditApplication,
  QuoteRequest,
  TeamInvite,
  JoinRequest,
} from '../types/company'
import type { OrderRequest } from '../types/orderRequest'

/** /customers/{companyId}/locations */
export const companyLocationsCol = (companyId: string) =>
  col<DeliveryLocation>(`customers/${companyId}/locations`)

/** /creditApplications/{companyId} */
export const creditApplicationsCol = col<CreditApplication>('creditApplications')

/** /quoteRequests/{quoteId} */
export const quoteRequestsCol = col<QuoteRequest>('quoteRequests')
export const orderRequestsCol = col<OrderRequest>('orderRequests')

/** /invites/{inviteId} */
export const invitesCol = col<TeamInvite>('invites')

/** /joinRequests/{requestId} */
export const joinRequestsCol = col<JoinRequest>('joinRequests')

// Re-export customersCol typed as Company for onboarding use
export { customersCol as companiesCol }
export type { Company }
