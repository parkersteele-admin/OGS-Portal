/**
 * src/services/productService.ts
 *
 * CRUD + real-time operations for the products catalog.
 * Admin/Sales operations include optional audit logging for price changes.
 */

import {
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  writeBatch,
  serverTimestamp,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { productsCol, auditLogCol } from '../lib/firestore'
import { serviceCall } from './base'
import type { Product } from '../types/product'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreateProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateProductInput = Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>>

export interface ProductDropdownItem {
  id: string
  sku: string
  name: string
  category: string
  unit: string
  basePrice: number
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** All products (including hidden), ordered by sortOrder then name. Admin/Sales only. */
export async function getAllProducts(): Promise<Product[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(productsCol, where('active', '==', true), orderBy('sortOrder'), orderBy('name')),
    )
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Product)
  })
}

/** Only is_visible=true products, sorted by sortOrder. Used by customer catalog. */
export async function getVisibleProducts(): Promise<Product[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(
        productsCol,
        where('active', '==', true),
        where('isVisible', '==', true),
        orderBy('sortOrder'),
        orderBy('name'),
      ),
    )
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Product)
  })
}

/** Single product by id. */
export async function getProduct(id: string): Promise<Product> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'products', id))
    if (!snap.exists()) throw new Error(`Product ${id} not found`)
    return { ...snap.data(), id: snap.id } as Product
  })
}

/**
 * Product dropdown for inventory add-item form.
 * Returns lightweight items grouped-friendly (sorted by category then name).
 */
export async function getProductDropdown(): Promise<ProductDropdownItem[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(productsCol, where('active', '==', true), orderBy('category'), orderBy('name')),
    )
    return snap.docs.map((d) => {
      const p = { ...d.data(), id: d.id } as Product
      return { id: p.id, sku: p.sku, name: p.name, category: p.category, unit: p.unit, basePrice: p.basePrice }
    })
  })
}

// ── Real-time ─────────────────────────────────────────────────────────────────

/** Real-time listener for all active products. */
export function subscribeToProducts(
  cb: (products: Product[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(productsCol, where('active', '==', true), orderBy('sortOrder'), orderBy('name')),
    (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Product)),
  )
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Create a new product. */
export async function createProduct(data: CreateProductInput): Promise<string> {
  return serviceCall(async () => {
    const ref = await addDoc(productsCol, {
      ...data,
      // Keep pricePerUnit in sync for legacy compatibility
      pricePerUnit: data.basePrice,
      active: data.active ?? true,
      isVisible: data.isVisible ?? false,
      isFeatured: data.isFeatured ?? false,
      sortOrder: data.sortOrder ?? 0,
      tags: data.tags ?? [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as unknown as Product)
    return ref.id
  })
}

/**
 * Update a product. If `basePrice` changes, writes an audit log entry.
 * @param changedByUid  UID of the admin/sales user making the change (optional)
 */
export async function updateProduct(
  id: string,
  data: UpdateProductInput,
  changedByUid?: string,
): Promise<void> {
  return serviceCall(async () => {
    const ref = doc(db, 'products', id)

    // Audit price changes
    if (data.basePrice !== undefined && changedByUid) {
      const existing = await getDoc(ref)
      if (existing.exists()) {
        const old = existing.data() as Product
        if (old.basePrice !== data.basePrice) {
          await addDoc(auditLogCol, {
            entity: 'product',
            entityId: id,
            field: 'basePrice',
            oldValue: old.basePrice,
            newValue: data.basePrice,
            changedBy: changedByUid,
            changedAt: serverTimestamp(),
          } as unknown as import('../lib/firestore').AuditLogEntry)
        }
      }
    }

    await updateDoc(ref, {
      ...data,
      // Keep pricePerUnit in sync
      ...(data.basePrice !== undefined ? { pricePerUnit: data.basePrice } : {}),
      updatedAt: serverTimestamp(),
    })
  })
}

/** Soft-delete (sets active=false). Admin only. */
export async function deleteProduct(id: string): Promise<void> {
  return serviceCall(async () => {
    await updateDoc(doc(db, 'products', id), {
      active: false,
      isVisible: false,
      updatedAt: serverTimestamp(),
    })
  })
}

/** Hard-delete. Use with caution. */
export async function hardDeleteProduct(id: string): Promise<void> {
  return serviceCall(async () => {
    await deleteDoc(doc(db, 'products', id))
  })
}

/**
 * Batch update sortOrder for drag-and-drop merchandising.
 * Accepts an array of { id, sortOrder } and writes all in one batch.
 */
export async function batchUpdateSortOrder(
  updates: Array<{ id: string; sortOrder: number }>,
): Promise<void> {
  return serviceCall(async () => {
    const batch = writeBatch(db)
    for (const { id, sortOrder } of updates) {
      batch.update(doc(db, 'products', id), { sortOrder, updatedAt: serverTimestamp() })
    }
    await batch.commit()
  })
}

/**
 * Toggle a single boolean field on a product (isVisible, isFeatured).
 * Returns the new value.
 */
export async function toggleProductField(
  id: string,
  field: 'isVisible' | 'isFeatured',
): Promise<boolean> {
  return serviceCall(async () => {
    const ref = doc(db, 'products', id)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error(`Product ${id} not found`)
    const newVal = !((snap.data() as Product)[field])
    await updateDoc(ref, { [field]: newVal, updatedAt: serverTimestamp() })
    return newVal
  })
}
