/**
 * src/modules/orders/new/orderService.ts
 *
 * All Firestore reads/writes for the New Order module.
 */

import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import type { Product } from '../../../types/models'
import type { NewOrder, SavedOrder, ReorderPoint, RecurringSchedule, LineItem } from './types'

// ── Collection helpers ────────────────────────────────────────────────────────

function savedOrdersCol(customerId: string) {
  return collection(db, `customers/${customerId}/savedOrders`)
}

function reorderPointsCol(customerId: string) {
  return collection(db, `customers/${customerId}/reorderPoints`)
}

// ── Products ──────────────────────────────────────────────────────────────────

export async function getVisibleProducts(): Promise<Product[]> {
  const snap = await getDocs(
    query(
      collection(db, 'products'),
      where('isVisible', '==', true),
      orderBy('category'),
      orderBy('sortOrder'),
    ),
  )
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as unknown as Product)
}

// ── New Order writes ──────────────────────────────────────────────────────────

export async function submitNewOrder(
  payload: Omit<NewOrder, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'orders'), {
    ...payload,
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
    submittedAt: serverTimestamp(),
  })
  return ref.id
}

export async function saveDraftOrder(
  payload: Omit<NewOrder, 'id' | 'createdAt' | 'updatedAt' | 'submittedAt'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'orders'), {
    ...payload,
    submittedAt: null,
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
  })
  return ref.id
}

export async function updateOrderRecurring(
  orderId: string,
  schedule: RecurringSchedule,
): Promise<void> {
  await updateDoc(doc(db, 'orders', orderId), {
    isRecurring:       true,
    recurringSchedule: schedule,
    updatedAt:         serverTimestamp(),
  })
}

// ── Notification ──────────────────────────────────────────────────────────────

export async function notifyDispatch(payload: {
  orderId:      string
  customerId:   string
  customerName: string
  total:        number
  createdBy:    string
}): Promise<void> {
  await addDoc(collection(db, 'notifications'), {
    type:        'new_order',
    title:       `New order from ${payload.customerName}`,
    body:        `Order submitted — ${payload.customerName}`,
    orderId:     payload.orderId,
    customerId:  payload.customerId,
    total:       payload.total,
    createdBy:   payload.createdBy,
    read:        false,
    createdAt:   serverTimestamp(),
    targetRoles: ['admin', 'dispatch'],
  })
}

// ── Saved Order Templates ─────────────────────────────────────────────────────

export async function getSavedOrders(customerId: string): Promise<SavedOrder[]> {
  const snap = await getDocs(
    query(savedOrdersCol(customerId), orderBy('lastUsedAt', 'desc')),
  )
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as unknown as SavedOrder)
}

export async function saveOrderTemplate(
  customerId:   string,
  templateName: string,
  lineItems:    LineItem[],
  notes:        string,
): Promise<string> {
  const colRef = savedOrdersCol(customerId)
  // Check for existing template with same name
  const existing = await getDocs(query(colRef, where('templateName', '==', templateName)))
  if (!existing.empty) {
    const existingId = existing.docs[0].id
    await updateDoc(doc(colRef, existingId), {
      lineItems,
      notes,
      lastUsedAt: serverTimestamp(),
      useCount:   (existing.docs[0].data().useCount ?? 0) + 1,
    })
    return existingId
  }
  const ref = await addDoc(colRef, {
    templateName,
    lineItems,
    notes,
    createdAt:  serverTimestamp(),
    lastUsedAt: null,
    useCount:   0,
  })
  return ref.id
}

export async function updateTemplateUsage(
  customerId:  string,
  templateId:  string,
  currentCount: number,
): Promise<void> {
  await updateDoc(doc(savedOrdersCol(customerId), templateId), {
    lastUsedAt: serverTimestamp(),
    useCount:   currentCount + 1,
  })
}

export async function deleteSavedOrder(
  customerId:  string,
  templateId:  string,
): Promise<void> {
  await deleteDoc(doc(savedOrdersCol(customerId), templateId))
}

export async function checkTemplateNameExists(
  customerId:   string,
  templateName: string,
): Promise<string | null> {
  const snap = await getDocs(
    query(savedOrdersCol(customerId), where('templateName', '==', templateName)),
  )
  return snap.empty ? null : snap.docs[0].id
}

export async function forceUpdateTemplate(
  customerId:   string,
  templateId:   string,
  templateName: string,
  lineItems:    LineItem[],
  notes:        string,
): Promise<void> {
  await setDoc(doc(savedOrdersCol(customerId), templateId), {
    templateName,
    lineItems,
    notes,
    lastUsedAt: serverTimestamp(),
    useCount:   0,
    createdAt:  serverTimestamp(),
  })
}

// ── Reorder Points ────────────────────────────────────────────────────────────

export async function getReorderPoints(customerId: string): Promise<ReorderPoint[]> {
  const snap = await getDocs(reorderPointsCol(customerId))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as unknown as ReorderPoint)
}

export async function saveReorderPoint(
  customerId: string,
  point:      Omit<ReorderPoint, 'id'>,
): Promise<void> {
  await setDoc(doc(reorderPointsCol(customerId), point.productId), point)
}

export async function updateReorderPoint(
  customerId: string,
  productId:  string,
  patch:      Partial<ReorderPoint>,
): Promise<void> {
  await updateDoc(doc(reorderPointsCol(customerId), productId), patch)
}

export async function deleteReorderPoint(
  customerId: string,
  productId:  string,
): Promise<void> {
  await deleteDoc(doc(reorderPointsCol(customerId), productId))
}
