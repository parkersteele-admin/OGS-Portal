import type { Timestamp } from 'firebase/firestore'

export type DeliveryTier = 'standard' | 'next-day' | 'same-day'

export type OrderStatus =
  | 'pending'
  | 'scheduled'
  | 'assigned'
  | 'in-transit'
  | 'delivered'
  | 'invoiced'
  | 'paid'
  | 'cancelled'

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
  requestedAt: Timestamp
  scheduledAt?: Timestamp
}
