import type { Timestamp } from 'firebase/firestore'

/**
 * Per-customer override price for a specific product.
 * Stored in `customers/{customerId}/productPricing/{productId}`.
 *
 * Set automatically when a quote is accepted/converted, or manually
 * by admins/sales from the customer's "Product Pricing" tab.
 */
export interface CustomerProductPricing {
  productId: string
  /** Customer-specific price per unit. */
  price: number
  /** How this price was set. */
  source: 'manual' | 'quote'
  /** The quote ID that sourced this price, if applicable. */
  quoteId?: string
  /** When this pricing was set. */
  setAt: Timestamp
  /** UID of the staff member who set this price. */
  setBy: string
  /** Optional internal note about this pricing. */
  note?: string
}
