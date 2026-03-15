// Central re-export barrel — import from individual modules for tree-shaking,
// or import from here for convenience in pages/hooks.
export type { UserRole, AppUser } from './user'
export type { AuthUser } from './auth'
export { ROLE_HOME } from './auth'
export type { Customer, CustomerStatus, Address } from './customer'
export type { Product, ProductType } from './product'
export type { Tank, TankStatus, TankOwnership } from './tank'
export type { Order, OrderStatus, DeliveryTier } from './order'
export type { Run, RunStop, RunStatus, RunStopStatus } from './run'
export type {
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  Payment,
  PaymentStatus,
  PaymentMethod,
} from './billing'
export type { Lead, LeadStatus, Quote, QuoteItem, QuoteStatus, ContactLog } from './crm'
export type { AppFile } from './file'

export type NotificationType =
  | 'rush_order'
  | 'delivery_complete'
  | 'payment_received'
  | 'payment_failed'
  | 'low_tank'
  | 'overdue_invoice'
  | 'cert_expiry'
  | string  // allow extension without a breaking change

export interface Notification {
  id: string
  /** Target user ID, or null for role-broadcast notifications. */
  userId: string | null
  /** Target role for broadcast notifications (e.g. 'dispatch'). */
  role?: string
  type: NotificationType
  title: string
  body: string
  /** Optional deep link to navigate to on click. */
  link?: string
  /** Related Firestore document ID (orderId, invoiceId, etc.). */
  entityId?: string
  /** 'high' notifications may be visually emphasised. */
  priority?: 'normal' | 'high' | 'urgent'
  read: boolean
  createdAt: import('firebase/firestore').Timestamp
}
