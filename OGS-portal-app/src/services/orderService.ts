import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { ordersCol, deliverySettingsRef } from '../lib/firestore'
import type { Order, OrderStatus, DeliveryTier, DeliveryTierConfig, DeliverySettings } from '../types/order'
import { DEFAULT_DELIVERY_SETTINGS } from '../types/order'
import { serviceCall, fromSnap, paginate, type Page, type PageOptions, OgsValidationError } from './base'

export type { DeliveryTierConfig, DeliverySettings }

export interface OrderFilters {
  customerId?: string
  status?: OrderStatus
  deliveryTier?: DeliveryTier
  scheduledAfter?: Date
  scheduledBefore?: Date
}

export interface CreateOrderInput {
  customerId: string
  productId: string
  tankId?: string
  quantity: number
  deliveryTier: DeliveryTier
  notes?: string
}

export interface CreateBatchOrderInput extends CreateOrderInput {
  unitPrice: number
}

// Upcharge percentages by tier (fallback when settings not loaded)
const TIER_UPCHARGE: Record<DeliveryTier, number> = {
  standard: 0,
  'next-day': 0.1,
  'same-day': 0.25,
}

// ── Delivery Settings ─────────────────────────────────────────────────────────────────

/** Fetch admin-configurable delivery tier settings from Firestore. */
export async function getDeliverySettings(): Promise<DeliverySettings> {
  return serviceCall(async () => {
    const snap = await getDoc(deliverySettingsRef)
    if (!snap.exists()) return DEFAULT_DELIVERY_SETTINGS
    const data = snap.data() as Partial<DeliverySettings>
    return {
      standard:   { ...DEFAULT_DELIVERY_SETTINGS.standard,   ...(data.standard   ?? {}) },
      'next-day': { ...DEFAULT_DELIVERY_SETTINGS['next-day'], ...(data['next-day'] ?? {}) },
      'same-day': { ...DEFAULT_DELIVERY_SETTINGS['same-day'], ...(data['same-day'] ?? {}) },
    } as DeliverySettings
  })
}

/** Persist delivery settings. Admin only. */
export async function updateDeliverySettings(settings: DeliverySettings): Promise<void> {
  return serviceCall(() =>
    setDoc(deliverySettingsRef, settings, { merge: true }),
  )
}

/** Generate a short human-readable order group ID. */
export function generateGroupId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let id = 'ORD-'
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

// ── Pricing ───────────────────────────────────────────────────────────────────

export interface OrderPricing {
  unitPrice: number
  upchargePercent: number
  subtotal: number
  deliveryFee: number
  total: number
}

export function calculateOrderPricing(
  quantity: number,
  unitPrice: number,
  tier: DeliveryTier,
  deliveryFee = 35,
): OrderPricing {
  const upchargePercent = TIER_UPCHARGE[tier]
  const effectiveUnit = unitPrice * (1 + upchargePercent)
  const subtotal = parseFloat((effectiveUnit * quantity).toFixed(2))
  const total = parseFloat((subtotal + deliveryFee).toFixed(2))
  return { unitPrice, upchargePercent, subtotal, deliveryFee, total }
}

// ── Valid status transitions ──────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending:    ['scheduled', 'cancelled'],
  scheduled:  ['assigned',  'pending', 'cancelled'],
  assigned:   ['in-transit','scheduled'],
  'in-transit': ['delivered'],
  delivered:  ['invoiced'],
  invoiced:   ['paid'],
  paid:       [],
  cancelled:  [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getOrder(id: string): Promise<Order> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'orders', id))
    return fromSnap<Order>(snap, 'orders')
  })
}

export async function getOrders(
  filters: OrderFilters = {},
  options: PageOptions = {},
): Promise<Page<Order>> {
  return serviceCall(async () => {
    const constraints: QueryConstraint[] = [orderBy('requestedAt', 'desc')]
    if (filters.customerId) constraints.push(where('customerId', '==', filters.customerId))
    if (filters.status)     constraints.push(where('status', '==', filters.status))
    if (filters.deliveryTier) constraints.push(where('deliveryTier', '==', filters.deliveryTier))
    if (filters.scheduledAfter)  constraints.push(where('scheduledAt', '>=', filters.scheduledAfter))
    if (filters.scheduledBefore) constraints.push(where('scheduledAt', '<=', filters.scheduledBefore))
    return paginate<Order>(ordersCol, constraints, options)
  })
}

export function subscribeToOrder(id: string, callback: (order: Order | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'orders', id), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Order) : null)
  })
}

export function subscribeToOrders(
  filters: OrderFilters = {},
  callback: (orders: Order[]) => void,
): Unsubscribe {
  const constraints: QueryConstraint[] = [orderBy('requestedAt', 'desc')]
  if (filters.customerId) constraints.push(where('customerId', '==', filters.customerId))
  if (filters.status)     constraints.push(where('status', '==', filters.status))
  return onSnapshot(query(ordersCol, ...constraints), (snap) => {
    callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Order))
  })
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createOrder(
  data: CreateOrderInput,
  unitPrice: number,
): Promise<string> {
  return serviceCall(async () => {
    const pricing = calculateOrderPricing(data.quantity, unitPrice, data.deliveryTier)
    // Strip undefined fields — Firestore rejects them
    const payload = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    )
    const ref = await addDoc(ordersCol, {
      ...payload,
      ...pricing,
      status: 'pending' as OrderStatus,
      requestedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as unknown as Omit<Order, 'id'>)
    return ref.id
  })
}

export async function createBatchOrders(
  items: CreateBatchOrderInput[],
  deliveryFee = 35,
  groupId?: string,
): Promise<string[]> {
  return serviceCall(async () => {
    const orderIds = await Promise.all(
      items.map(async ({ unitPrice, ...item }, index) => {
        const pricing = calculateOrderPricing(
          item.quantity,
          unitPrice,
          item.deliveryTier,
          index === 0 ? deliveryFee : 0,
        )
        const payload = Object.fromEntries(
          Object.entries(item).filter(([, value]) => value !== undefined),
        )
        const ref = await addDoc(ordersCol, {
          ...payload,
          ...pricing,
          ...(groupId ? { groupId } : {}),
          status: 'pending' as OrderStatus,
          requestedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } as unknown as Omit<Order, 'id'>)
        return ref.id
      }),
    )

    return orderIds
  })
}

export async function updateOrder(
  id: string,
  data: Partial<Omit<Order, 'id' | 'createdAt' | 'requestedAt'>>,
): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'orders', id), { ...data, updatedAt: serverTimestamp() }),
  )
}

export async function transitionOrderStatus(
  id: string,
  nextStatus: OrderStatus,
): Promise<void> {
  return serviceCall(async () => {
    const order = await getOrder(id)
    if (!canTransition(order.status, nextStatus)) {
      throw new OgsValidationError(
        `Cannot transition order from '${order.status}' to '${nextStatus}'`,
      )
    }
    await updateDoc(doc(db, 'orders', id), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    })
  })
}

export async function deleteOrder(id: string): Promise<void> {
  return serviceCall(() => deleteDoc(doc(db, 'orders', id)))
}
