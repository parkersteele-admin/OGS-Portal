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
  requestedAt: Timestamp
  scheduledAt?: Timestamp
}
