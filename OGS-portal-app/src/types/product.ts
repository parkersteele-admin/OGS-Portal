import type { Timestamp } from 'firebase/firestore'

/** Legacy type alias kept for non-catalog usage (orders, billing line items) */
export type ProductType = 'propane' | 'service' | 'equipment' | 'fee' | 'rental'

export type ProductCategory =
  | 'CO₂ Cylinders'
  | 'Nitrogen'
  | 'Beer Gas'
  | 'Rentals'
  | 'Fees'
  | string  // allow future categories

export interface Product {
  id: string

  // ── Identity ──────────────────────────────────────────────────
  sku: string
  category: ProductCategory
  name: string
  description?: string
  sizeLabel?: string

  // ── Pricing ───────────────────────────────────────────────────
  /** Base sale price (per unit). Aliased as `pricePerUnit` for legacy compat. */
  basePrice: number
  /** @deprecated Use basePrice. Kept so existing order/billing code compiles. */
  pricePerUnit: number
  rentalPrice?: number | null

  // ── Units ─────────────────────────────────────────────────────
  unit: string  // 'cylinder' | 'lb' | 'cf' | 'liter' | 'fee' | etc.

  // ── Catalog controls ──────────────────────────────────────────
  isVisible: boolean    // customer storefront visibility
  sortOrder: number     // merchandising order
  isFeatured: boolean   // shows 'Popular' badge
  tags?: string[]
  notes?: string        // internal only, never shown to customers

  // ── Status ────────────────────────────────────────────────────
  active: boolean

  // ── Timestamps ────────────────────────────────────────────────
  createdAt?: Timestamp
  updatedAt?: Timestamp
}
