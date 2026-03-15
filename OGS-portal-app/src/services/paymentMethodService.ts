/**
 * src/services/paymentMethodService.ts
 *
 * Firestore reads for payment methods.
 * Writes (save/remove) go through Cloud Functions — never directly from the
 * browser — because they require Stripe API calls with the secret key.
 */

import {
  onSnapshot,
  query,
  orderBy,
  type Unsubscribe,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'
import { paymentMethodsCol } from '../lib/firestore'
import type { PaymentMethod } from '../types/billing'

// ── Real-time listener ────────────────────────────────────────────────────────

/**
 * Subscribes to all payment methods for a customer, ordered oldest-first.
 * Returns an unsubscribe function — call it in a useEffect cleanup.
 */
export function subscribePaymentMethods(
  customerId: string,
  callback: (methods: PaymentMethod[], error?: Error) => void,
): Unsubscribe {
  const q = query(paymentMethodsCol(customerId), orderBy('createdAt', 'asc'))

  return onSnapshot(
    q,
    (snap) => {
      const methods = snap.docs.map((d) => ({ ...d.data(), id: d.id } as PaymentMethod))
      callback(methods)
    },
    (err) => callback([], err),
  )
}

// ── Cloud Function callables ──────────────────────────────────────────────────

/** Creates a Stripe SetupIntent and returns its clientSecret. */
export async function createSetupIntent(customerId?: string): Promise<{ clientSecret: string }> {
  const fn = httpsCallable<{ customerId?: string }, { clientSecret: string }>(
    functions,
    'createSetupIntent',
  )
  const result = await fn(customerId ? { customerId } : {})
  return result.data
}

/** Saves a confirmed payment method to Firestore via Cloud Function. */
export async function savePaymentMethod(params: {
  setupIntentId: string
  setAsDefault?: boolean
  customerId?: string
}): Promise<{ paymentMethodId: string }> {
  const fn = httpsCallable<typeof params, { paymentMethodId: string }>(
    functions,
    'savePaymentMethod',
  )
  const result = await fn(params)
  return result.data
}

/** Removes a payment method from Stripe and Firestore via Cloud Function. */
export async function removePaymentMethod(params: {
  paymentMethodId: string
  customerId?: string
}): Promise<void> {
  const fn = httpsCallable<typeof params, { success: boolean }>(
    functions,
    'removePaymentMethod',
  )
  await fn(params)
}
