import type { Timestamp } from 'firebase/firestore'

/** Structured address — used on Customer billingAddress and elsewhere. */
export interface Address {
  line1: string
  line2?: string
  city: string
  state: string
  zip: string
}

export type CustomerStatus = 'active' | 'inactive' | 'hold'

export interface Customer {
  id: string
  name: string
  email: string
  phone: string
  /** Street line — intentionally flat for easy display and map geocoding. */
  address: string
  city: string
  state: string
  zip: string
  lat?: number
  lng?: number
  status: CustomerStatus
  creditLimit: number
  notes?: string
  /** Stripe Customer ID — set by createSetupIntent on first payment method save. */
  stripeCustomerId?: string
  /** Whether autopay is active for this customer. */
  autopayEnabled?: boolean
  /** Stripe PM ID currently used for autopay charges. */
  autopayStripePaymentMethodId?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
