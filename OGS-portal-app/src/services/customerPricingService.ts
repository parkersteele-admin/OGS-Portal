import {
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { customerProductPricingCol } from '../lib/firestore'
import type { CustomerProductPricing } from '../types/customerPricing'
import { serviceCall } from './base'

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getCustomerProductPricing(
  customerId: string,
): Promise<CustomerProductPricing[]> {
  return serviceCall(async () => {
    const snap = await getDocs(customerProductPricingCol(customerId))
    return snap.docs.map((d) => ({ ...d.data(), productId: d.id }) as CustomerProductPricing)
  })
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function setCustomerProductPrice(
  customerId: string,
  productId: string,
  price: number,
  setBy: string,
  options?: { source?: 'manual' | 'quote'; quoteId?: string; note?: string },
): Promise<void> {
  const entry: Record<string, unknown> = {
    productId,
    price,
    source: options?.source ?? 'manual',
    setBy,
    setAt: serverTimestamp(),
  }
  if (options?.quoteId) entry.quoteId = options.quoteId
  if (options?.note)    entry.note    = options.note

  return serviceCall(() =>
    setDoc(doc(db, 'customers', customerId, 'productPricing', productId), entry),
  )
}

export async function removeCustomerProductPrice(
  customerId: string,
  productId: string,
): Promise<void> {
  return serviceCall(() =>
    deleteDoc(doc(db, 'customers', customerId, 'productPricing', productId)),
  )
}
