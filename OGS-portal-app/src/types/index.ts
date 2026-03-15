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

export interface Notification {
  id: string
  userId: string
  title: string
  body: string
  read: boolean
  createdAt: Date
}
