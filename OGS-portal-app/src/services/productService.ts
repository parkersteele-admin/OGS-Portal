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
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  documentId,
  writeBatch,
  serverTimestamp,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '../lib/firebase'
import { productsCol, productPricingCol, auditLogCol } from '../lib/firestore'
import { serviceCall } from './base'
import type { Product, ProductPricingInternal } from '../types/product'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreateProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'minPrice'>
export type UpdateProductInput = Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'minPrice'>>

export interface ProductDropdownItem {
  id: string
  sku: string
  name: string
  category: string
  unit: string
  basePrice: number
  cost: number
  minMarginPercent: number
  minPrice: number
}

export interface InternalProductPricingGuard {
  productId: string
  cost: number
  minMarginPercent: number
  minPrice: number
}

const DEFAULT_MARGIN_DECIMAL = 0.2
const PRICING_CACHE_TTL_MS = 30_000
const DROPDOWN_CACHE_TTL_MS = 60_000

let pricingMapCache: Map<string, ProductPricingInternal> | null = null
let pricingMapCacheUntil = 0
let pricingMapInflight: Promise<Map<string, ProductPricingInternal>> | null = null

let dropdownCache: ProductDropdownItem[] | null = null
let dropdownCacheUntil = 0
let dropdownInflight: Promise<ProductDropdownItem[]> | null = null

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize))
  }
  return chunks
}

function stripUndefinedFields<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

function invalidateProductCaches(): void {
  pricingMapCache = null
  pricingMapCacheUntil = 0
  pricingMapInflight = null

  dropdownCache = null
  dropdownCacheUntil = 0
  dropdownInflight = null
}

async function getCurrentRole(): Promise<string | null> {
  const auth = getAuth()
  const currentUser = auth.currentUser
  if (!currentUser) return null

  try {
    const token = await currentUser.getIdTokenResult()
    const role = token.claims.role
    if (typeof role === 'string' && role) return role
  } catch {
    // Fall through to users/{uid} lookup if token claims are stale.
  }

  try {
    const userSnap = await getDoc(doc(db, 'users', currentUser.uid))
    if (userSnap.exists()) {
      const role = (userSnap.data() as { role?: unknown }).role
      if (typeof role === 'string' && role) return role
    }
  } catch {
    // Ignore fallback read errors and fail closed below.
  }

  return null
}

async function assertAdminCatalogWrite(): Promise<void> {
  const role = await getCurrentRole()
  if (role !== 'admin') {
    throw new Error('Only admins can modify the master product catalog.')
  }
}

export function computeMinPrice(cost: number, minMarginPercent: number): number {
  const safeCost = Number.isFinite(cost) ? Math.max(cost, 0) : 0
  const safeMargin = Math.min(Math.max(minMarginPercent, 0), 0.95)
  return parseFloat((safeCost / (1 - safeMargin)).toFixed(2))
}

function normalizeMarginPercent(value: number | undefined): number {
  if (!Number.isFinite(value as number)) return DEFAULT_MARGIN_DECIMAL
  const raw = value as number
  const normalized = raw > 1 ? raw / 100 : raw
  return Math.min(Math.max(normalized, 0), 0.95)
}

function fallbackCost(basePrice: number): number {
  return parseFloat((Math.max(basePrice, 0) * 0.75).toFixed(2))
}

function normalizeCost(cost: number | undefined, basePrice: number): number {
  if (!Number.isFinite(cost as number)) return fallbackCost(basePrice)
  return parseFloat(Math.max(cost as number, 0).toFixed(2))
}

function sanitizePublicProduct(raw: Product, id: string): Product {
  const basePrice = Number.isFinite(raw.basePrice) ? raw.basePrice : Number(raw.pricePerUnit ?? 0)
  const pricePerUnit = Number.isFinite(raw.pricePerUnit) ? raw.pricePerUnit : basePrice
  const { cost: _cost, minMarginPercent: _minMarginPercent, minPrice: _minPrice, ...safe } = raw
  return {
    ...safe,
    id,
    basePrice,
    pricePerUnit,
  } as Product
}

function mergeInternalPricing(product: Product, pricing?: ProductPricingInternal | null): Product {
  const cost = pricing?.cost ?? normalizeCost(undefined, product.basePrice)
  const minMarginPercent = pricing?.minMarginPercent ?? DEFAULT_MARGIN_DECIMAL
  const minPrice = pricing?.minPrice ?? computeMinPrice(cost, minMarginPercent)

  return {
    ...product,
    cost,
    minMarginPercent,
    minPrice,
  }
}

async function getPricingMap(): Promise<Map<string, ProductPricingInternal>> {
  const now = Date.now()
  if (pricingMapCache && now < pricingMapCacheUntil) {
    return pricingMapCache
  }

  if (pricingMapInflight) {
    return pricingMapInflight
  }

  pricingMapInflight = getDocs(productPricingCol)
    .then((snap) => {
      const map = new Map<string, ProductPricingInternal>()

      snap.docs.forEach((d) => {
        const data = d.data() as ProductPricingInternal
        map.set(d.id, {
          ...data,
          productId: d.id,
          minPrice: computeMinPrice(data.cost, data.minMarginPercent),
        })
      })

      pricingMapCache = map
      pricingMapCacheUntil = Date.now() + PRICING_CACHE_TTL_MS
      return map
    })
    .catch((err) => {
      const code = (err as { code?: string })?.code ?? ''
      if (code === 'permission-denied') {
        // Allow product reads to proceed when internal pricing is restricted.
        const empty = new Map<string, ProductPricingInternal>()
        pricingMapCache = empty
        pricingMapCacheUntil = Date.now() + PRICING_CACHE_TTL_MS
        return empty
      }
      throw err
    })
    .finally(() => {
      pricingMapInflight = null
    })

  return pricingMapInflight
}

async function getProductsByIds(productIds: string[]): Promise<Map<string, Product>> {
  const map = new Map<string, Product>()
  if (productIds.length === 0) return map

  const chunks = chunkArray(productIds, 10)
  await Promise.all(chunks.map(async (chunk) => {
    const snap = await getDocs(query(productsCol, where(documentId(), 'in', chunk)))
    snap.docs.forEach((d) => {
      map.set(d.id, sanitizePublicProduct({ ...d.data(), id: d.id } as Product, d.id))
    })
  }))

  return map
}

async function getPricingMapForIds(productIds: string[]): Promise<Map<string, ProductPricingInternal>> {
  const uniqueIds = [...new Set(productIds.filter(Boolean))]
  const map = new Map<string, ProductPricingInternal>()
  if (uniqueIds.length === 0) return map

  const chunks = chunkArray(uniqueIds, 10)
  try {
    await Promise.all(chunks.map(async (chunk) => {
      const snap = await getDocs(query(productPricingCol, where(documentId(), 'in', chunk)))
      snap.docs.forEach((d) => {
        const data = d.data() as ProductPricingInternal
        map.set(d.id, {
          ...data,
          productId: d.id,
          minPrice: computeMinPrice(data.cost, data.minMarginPercent),
        })
      })
    }))
  } catch (err) {
    const code = (err as { code?: string })?.code ?? ''
    if (code !== 'permission-denied') {
      throw err
    }
  }

  return map
}

async function getProductAndPricing(productId: string): Promise<{ product: Product; pricing: ProductPricingInternal | null }> {
  const productSnap = await getDoc(doc(db, 'products', productId))
  if (!productSnap.exists()) throw new Error(`Product ${productId} not found`)

  const product = sanitizePublicProduct({ ...productSnap.data(), id: productSnap.id } as Product, productSnap.id)

  let pricing: ProductPricingInternal | null = null
  try {
    const pricingSnap = await getDoc(doc(db, 'productPricing', productId))
    pricing = pricingSnap.exists()
      ? ({
        ...pricingSnap.data(),
        productId,
        minPrice: computeMinPrice(pricingSnap.data().cost, pricingSnap.data().minMarginPercent),
      } as ProductPricingInternal)
      : null
  } catch (err) {
    const code = (err as { code?: string })?.code ?? ''
    if (code !== 'permission-denied') {
      throw err
    }
  }

  return { product, pricing }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** All products (including hidden), ordered by sortOrder then name. Admin/Sales only. */
export async function getAllProducts(): Promise<Product[]> {
  return serviceCall(async () => {
    const [productSnap, pricingMap] = await Promise.all([
      getDocs(
        query(productsCol, where('active', '==', true)),
      ),
      getPricingMap(),
    ])

    const products = productSnap.docs.map((d) => {
      const base = sanitizePublicProduct({ ...d.data(), id: d.id } as Product, d.id)
      return mergeInternalPricing(base, pricingMap.get(d.id))
    })

    // Sort by sortOrder then name (client-side)
    return products.sort((a, b) => {
      const orderCmp = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      return orderCmp !== 0 ? orderCmp : a.name.localeCompare(b.name)
    })
  })
}

/**
 * Internal pricing guard lookup used by quote validation.
 * Returns only product IDs requested.
 */
export async function getInternalProductPricingGuards(productIds: string[]): Promise<Record<string, InternalProductPricingGuard>> {
  return serviceCall(async () => {
    const uniqueIds = [...new Set(productIds.filter(Boolean))]
    if (uniqueIds.length === 0) return {}

    const [productsById, pricingById] = await Promise.all([
      getProductsByIds(uniqueIds),
      getPricingMapForIds(uniqueIds),
    ])

    const entries = uniqueIds.map((id) => {
      const product = productsById.get(id)
      if (!product) {
        throw new Error(`Product ${id} not found`)
      }
      const pricing = pricingById.get(id) ?? null
      const merged = mergeInternalPricing(product, pricing)
      const cost = merged.cost ?? normalizeCost(undefined, merged.basePrice)
      const minMarginPercent = merged.minMarginPercent ?? DEFAULT_MARGIN_DECIMAL
      const minPrice = merged.minPrice ?? computeMinPrice(cost, minMarginPercent)
      return [id, { productId: id, cost, minMarginPercent, minPrice } satisfies InternalProductPricingGuard] as const
    })

    return Object.fromEntries(entries)
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
      ),
    )
    const products = snap.docs.map((d) => sanitizePublicProduct({ ...d.data(), id: d.id } as Product, d.id))
    // Sort by sortOrder then name (client-side)
    return products.sort((a, b) => {
      const orderCmp = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      return orderCmp !== 0 ? orderCmp : a.name.localeCompare(b.name)
    })
  })
}

/** Single product by id. */
export async function getProduct(id: string): Promise<Product> {
  return serviceCall(async () => {
    const { product, pricing } = await getProductAndPricing(id)
    return mergeInternalPricing(product, pricing)
  })
}

/**
 * Product dropdown for inventory add-item form.
 * Returns lightweight items grouped-friendly (sorted by category then name).
 */
export async function getProductDropdown(): Promise<ProductDropdownItem[]> {
  return serviceCall(async () => {
    const now = Date.now()
    if (dropdownCache && now < dropdownCacheUntil) {
      return dropdownCache
    }

    if (dropdownInflight) {
      return dropdownInflight
    }

    dropdownInflight = Promise.all([
      getDocs(
        query(productsCol, where('active', '==', true)),
      ),
      getPricingMap(),
    ])
      .then(([productSnap, pricingMap]) => {
        const items = productSnap.docs.map((d) => {
          const p = mergeInternalPricing(
            sanitizePublicProduct({ ...d.data(), id: d.id } as Product, d.id),
            pricingMap.get(d.id),
          )
          return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            category: p.category,
            unit: p.unit,
            basePrice: p.basePrice,
            cost: p.cost ?? normalizeCost(undefined, p.basePrice),
            minMarginPercent: p.minMarginPercent ?? DEFAULT_MARGIN_DECIMAL,
            minPrice: p.minPrice ?? computeMinPrice(p.cost ?? 0, p.minMarginPercent ?? DEFAULT_MARGIN_DECIMAL),
          }
        })

        // Sort by category then name (client-side)
        items.sort((a, b) => {
          const catCmp = a.category.localeCompare(b.category)
          return catCmp !== 0 ? catCmp : a.name.localeCompare(b.name)
        })

        dropdownCache = items
        dropdownCacheUntil = Date.now() + DROPDOWN_CACHE_TTL_MS
        return items
      })
      .finally(() => {
        dropdownInflight = null
      })

    return dropdownInflight
  })
}

// ── Real-time ─────────────────────────────────────────────────────────────────

/** Real-time listener for all active products. */
export function subscribeToProducts(
  cb: (products: Product[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(productsCol, where('active', '==', true)),
    (snap) => {
      void (async () => {
        try {
          const pricingMap = await getPricingMap()
          const products = snap.docs.map((d) => {
            const base = sanitizePublicProduct({ ...d.data(), id: d.id } as Product, d.id)
            return mergeInternalPricing(base, pricingMap.get(d.id))
          })
          // Sort by sortOrder then name (client-side)
          products.sort((a, b) => {
            const orderCmp = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
            return orderCmp !== 0 ? orderCmp : a.name.localeCompare(b.name)
          })
          cb(products)
        } catch (err) {
          const normalized = err instanceof Error
            ? err
            : new Error('Failed to load product pricing data')
          console.error('[subscribeToProducts:pricing]', normalized)
          onError?.(normalized)
        }
      })()
    },
    (err) => {
      console.error('[subscribeToProducts]', err)
      onError?.(err)
    },
  )
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Create a new product. */
export async function createProduct(data: CreateProductInput): Promise<string> {
  return serviceCall(async () => {
    await assertAdminCatalogWrite()

    const basePrice = parseFloat((data.basePrice ?? 0).toFixed(2))
    const cost = normalizeCost(data.cost, basePrice)
    const minMarginPercent = normalizeMarginPercent(data.minMarginPercent)
    const minPrice = computeMinPrice(cost, minMarginPercent)

    if (basePrice < minPrice) {
      throw new Error(`Base price (${basePrice.toFixed(2)}) cannot be lower than minimum price (${minPrice.toFixed(2)}).`)
    }

    const { cost: _cost, minMarginPercent: _minMarginPercent, ...publicData } = data
    const cleanPublicData = stripUndefinedFields(publicData as Record<string, unknown>)

    const ref = await addDoc(productsCol, {
      ...cleanPublicData,
      // Keep pricePerUnit in sync for legacy compatibility
      basePrice,
      pricePerUnit: basePrice,
      active: cleanPublicData.active ?? true,
      isVisible: cleanPublicData.isVisible ?? false,
      isFeatured: cleanPublicData.isFeatured ?? false,
      sortOrder: cleanPublicData.sortOrder ?? 0,
      tags: cleanPublicData.tags ?? [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as unknown as Product)

    await setDoc(doc(db, 'productPricing', ref.id), {
      productId: ref.id,
      cost,
      minMarginPercent,
      minPrice,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as unknown as ProductPricingInternal)

    invalidateProductCaches()

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
    await assertAdminCatalogWrite()

    const ref = doc(db, 'products', id)
    const pricingRef = doc(db, 'productPricing', id)

    const [existingProduct, existingPricing] = await Promise.all([
      getDoc(ref),
      getDoc(pricingRef),
    ])

    if (!existingProduct.exists()) {
      throw new Error(`Product ${id} not found`)
    }

    const oldProduct = sanitizePublicProduct(
      { ...existingProduct.data(), id: existingProduct.id } as Product,
      existingProduct.id,
    )
    const current = mergeInternalPricing(
      oldProduct,
      existingPricing.exists() ? ({ ...existingPricing.data(), productId: id } as ProductPricingInternal) : null,
    )

    const nextBasePrice = data.basePrice !== undefined ? parseFloat(data.basePrice.toFixed(2)) : current.basePrice
    const nextCost = data.cost !== undefined
      ? normalizeCost(data.cost, nextBasePrice)
      : (current.cost ?? normalizeCost(undefined, nextBasePrice))
    const nextMinMargin = data.minMarginPercent !== undefined
      ? normalizeMarginPercent(data.minMarginPercent)
      : (current.minMarginPercent ?? DEFAULT_MARGIN_DECIMAL)
    const nextMinPrice = computeMinPrice(nextCost, nextMinMargin)

    if (nextBasePrice < nextMinPrice) {
      throw new Error(`Base price (${nextBasePrice.toFixed(2)}) cannot be lower than minimum price (${nextMinPrice.toFixed(2)}).`)
    }

    // Audit price changes
    if (data.basePrice !== undefined && changedByUid) {
      if (oldProduct.basePrice !== data.basePrice) {
        await addDoc(auditLogCol, {
          entity: 'product',
          entityId: id,
          field: 'basePrice',
          oldValue: oldProduct.basePrice,
          newValue: data.basePrice,
          changedBy: changedByUid,
          changedAt: serverTimestamp(),
        } as unknown as import('../lib/firestore').AuditLogEntry)
      }
    }

    await setDoc(pricingRef, {
      productId: id,
      cost: nextCost,
      minMarginPercent: nextMinMargin,
      minPrice: nextMinPrice,
      updatedAt: serverTimestamp(),
    } as unknown as ProductPricingInternal, { merge: true })

    const { cost: _cost, minMarginPercent: _minMarginPercent, ...publicData } = data
    const cleanPublicData = stripUndefinedFields(publicData as Record<string, unknown>)
    const cleanBasePrice = publicData.basePrice !== undefined
      ? parseFloat(publicData.basePrice.toFixed(2))
      : undefined

    await updateDoc(ref, {
      ...cleanPublicData,
      ...(cleanBasePrice !== undefined ? { basePrice: cleanBasePrice } : {}),
      // Keep pricePerUnit in sync
      ...(cleanBasePrice !== undefined ? { pricePerUnit: cleanBasePrice } : {}),
      updatedAt: serverTimestamp(),
    })

    invalidateProductCaches()
  })
}

/** Soft-delete (sets active=false). Admin only. */
export async function deleteProduct(id: string): Promise<void> {
  return serviceCall(async () => {
    await assertAdminCatalogWrite()

    await updateDoc(doc(db, 'products', id), {
      active: false,
      isVisible: false,
      updatedAt: serverTimestamp(),
    })

    invalidateProductCaches()
  })
}

/** Hard-delete. Use with caution. */
export async function hardDeleteProduct(id: string): Promise<void> {
  return serviceCall(async () => {
    await assertAdminCatalogWrite()

    await deleteDoc(doc(db, 'products', id))
    invalidateProductCaches()
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
    await assertAdminCatalogWrite()

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
    await assertAdminCatalogWrite()

    const ref = doc(db, 'products', id)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error(`Product ${id} not found`)
    const newVal = !((snap.data() as Product)[field])
    await updateDoc(ref, { [field]: newVal, updatedAt: serverTimestamp() })
    return newVal
  })
}
