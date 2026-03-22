import type { Timestamp } from 'firebase/firestore'

export type DeliveryTier = 'standard' | 'next-day' | 'same-day'

/** How this order was created / what it represents in the delivery model. */
export type OrderType = 'route' | 'offRoute' | 'addOn'

/** A la carte item added to an existing route stop. */
export interface AddOnItem {
  productId: string
  productName: string
  qty: number
  addedBy: string
  addedAt: Timestamp
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
  | 'delivered'
  | 'invoiced'
  | 'paid'
  | 'cancelled'
  | 'archived'

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
  status: OrderStatus
  notes?: string
  /** Links all items from a single customer checkout into one order reference. */
  groupId?: string
  /** Classifies whether this is a recurring route, one-time, or add-on order. */
  orderType?: OrderType
  /** For addOn orders: the parent route order this is attached to. */
  parentOrderId?: string
  /** A la carte items added to this order (populated on route orders). */
  addOns?: AddOnItem[]
  /** When true, changes to this order apply only to this occurrence, not the recurring schedule. */
  modifyThisOnly?: boolean
  /** Final line items recorded by driver at delivery. */
  deliveredLineItems?: { productId: string; qty: number }[]
  /** Final add-on items recorded by driver at delivery. */
  deliveredAddOns?: { productId: string; qty: number }[]
  requestedAt: Timestamp
  scheduledAt?: Timestamp
}
