import type { Timestamp } from 'firebase/firestore'

export type DeliveryTier = 'standard' | 'next-day' | 'same-day'

/** How this order was created / what it represents in the delivery model. */
export type OrderType = 'route' | 'offRoute' | 'addOn'

/** A la carte item added to an existing route stop. */
export interface AddOnItem {
  productId: string
  productName: string
  qty: number
  unitPrice?: number
  addedBy: string
  addedAt: Timestamp | string
}

/** One product line in a recurring route schedule. */
export interface RouteLineItem {
  productId: string
  qty: number
  unitPrice: number
}

/** Cadence for a recurring route. */
export type RouteCadence = 'weekly' | 'biweekly' | 'monthly' | 'custom'

/**
 * Stored at /customers/{customerId}/routeSchedule
 * Governs the customer's standing delivery pattern.
 */
export interface RouteSchedule {
  isActive: boolean
  cadence: RouteCadence
  /** Only set when cadence === 'custom'. */
  customIntervalDays?: number
  /** Day of week (0 = Sunday … 6 = Saturday). */
  dayOfWeek?: number
  nextDeliveryDate: Timestamp
  lineItems: RouteLineItem[]
  routeId: string
  notes: string
  updatedBy: string
  updatedAt: Timestamp
}

export type OrderStatus =
  | 'pending'
  | 'scheduled'
  | 'assigned'
  | 'in-transit'
  | 'in_transit'
  | 'delivered'
  | 'ready_to_invoice'
  | 'invoice_sent_pending'
  | 'invoice_sent'
  | 'paid'
  | 'cancelled'
  | 'archived'

export type OrderStatusEvent = {
  status: OrderStatus
  changedAt: Timestamp
  changedBy: string
  changedByName?: string
  note?: string
}

/** Per-tier pricing configuration (admin-configurable). */
export interface DeliveryTierConfig {
  deliveryFee: number
  upchargePercent: number
}

/** Full delivery settings document stored in /settings/delivery. */
export type DeliverySettings = Record<DeliveryTier, DeliveryTierConfig>

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  standard:   { deliveryFee: 35, upchargePercent: 0 },
  'next-day': { deliveryFee: 50, upchargePercent: 0.10 },
  'same-day': { deliveryFee: 75, upchargePercent: 0.25 },
}

export interface Order {
  id: string
  customerId: string
  productId: string
  tankId?: string
  quantity: number
  deliveryTier: DeliveryTier
  /** Additional percentage charged for expedited delivery tiers. */
  upchargePercent: number
  unitPrice: number
  subtotal: number
  deliveryFee: number
  total: number
  applySalesTax?: boolean
  salesTaxRate?: number
  salesTaxAmount?: number
  taxRate?: number
  quoteSubtotal?: number
  quoteTax?: number
  quoteTotal?: number
  status: OrderStatus
  statusHistory?: OrderStatusEvent[]
  statusUpdatedAt?: Timestamp
  notes?: string
  /** Links all items from a single customer checkout into one order reference. */
  groupId?: string
  /** Classifies whether this is a recurring route, one-time, or add-on order. */
  orderType?: OrderType
  /** For addOn orders: the parent route order this is attached to. */
  parentOrderId?: string
  /** A la carte items added to this order (populated on route orders). */
  addOns?: AddOnItem[]
  /** Quote that created this operational order, if any. */
  quoteId?: string
  quoteNumber?: string
  approvedByName?: string
  approvedByEmail?: string
  salesRepId?: string
  salesRepName?: string
  salesRepEmail?: string
  salesRepPhone?: string
  primaryCommunicationMethod?: 'email' | 'phone' | 'text'
  paymentPreference?: 'card_on_file' | 'net_terms' | 'cod' | 'send_invoice' | 'undecided'
  quoteProvidedTo?: string
  quotedLineItems?: Array<{
    productId: string
    description: string
    quantity: number
    unitPrice: number
    amount: number
  }>
  /** When true, changes to this order apply only to this occurrence, not the recurring schedule. */
  modifyThisOnly?: boolean
  /** Final line items recorded by driver at delivery. */
  deliveredLineItems?: { productId: string; qty: number }[]
  /** Final add-on items recorded by driver at delivery. */
  deliveredAddOns?: { productId: string; qty: number }[]
  /** Extended proof-of-delivery state once a signature-backed delivery is finalized. */
  deliveryStatus?: 'signed'
  deliveredAt?: Timestamp
  signedAt?: Timestamp
  signedByUid?: string
  signedByName?: string
  receivedByName?: string
  deliveryContactName?: string
  deliveryContactPhone?: string
  deliveryContactEmail?: string
  signatureUrl?: string
  billOfLadingUrl?: string
  invoicePdfUrl?: string
  deliveryNotes?: string
  deliveryConfirmationRecipients?: string[]
  runId?: string
  runStopId?: string
  requestedAt: Timestamp
  createdAt?: Timestamp
  scheduledAt?: Timestamp
  /** QB invoice number entered by admin when marking invoice sent. */
  qbInvoiceNumber?: string | null
  /** When invoice was sent from QuickBooks and confirmed in OGS. */
  invoiceSentAt?: Timestamp | null
  /** Amount invoiced in QuickBooks. */
  invoiceAmount?: number
  /** Amount actually received from customer. */
  paidAmount?: number
  /** Timestamp when order was marked ready for invoice. */
  readyForInvoiceAt?: Timestamp | null
  /** When payment was received. */
  paidAt?: Timestamp | null
  /** Timestamp when the order was cancelled. */
  cancelledAt?: Timestamp | null
  /** UID of the user who cancelled the order. */
  cancelledBy?: string | null
}
