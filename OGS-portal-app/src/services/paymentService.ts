/**
 * paymentService.ts
 *
 * Payments are write-only via Firebase Cloud Functions (Stripe webhooks + admin SDK).
 * This service is intentionally read-only from the client.
 */
import {
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { paymentsCol, paymentMethodsCol } from '../lib/firestore'
import type { Payment, PaymentMethod } from '../types/billing'
import { serviceCall, fromSnap } from './base'

// ── Payments ──────────────────────────────────────────────────────────────────

export async function getPayment(id: string): Promise<Payment> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'payments', id))
    return fromSnap<Payment>(snap, 'payments')
  })
}

export async function getPaymentsForInvoice(invoiceId: string): Promise<Payment[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(paymentsCol, where('invoiceId', '==', invoiceId), orderBy('processedAt', 'desc')),
    )
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Payment)
  })
}

export async function getPaymentsForCustomer(customerId: string): Promise<Payment[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(paymentsCol, where('customerId', '==', customerId), orderBy('processedAt', 'desc')),
    )
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Payment)
  })
}

export function subscribeToCustomerPayments(
  customerId: string,
  callback: (payments: Payment[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(paymentsCol, where('customerId', '==', customerId), orderBy('processedAt', 'desc')),
    (snap) => {
      callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Payment))
    },
  )
}

// ── Payment methods (Stripe via Functions) ────────────────────────────────────

export async function getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
  return serviceCall(async () => {
    const snap = await getDocs(paymentMethodsCol(customerId))
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as PaymentMethod)
  })
}

export function subscribeToPaymentMethods(
  customerId: string,
  callback: (methods: PaymentMethod[]) => void,
): Unsubscribe {
  return onSnapshot(paymentMethodsCol(customerId), (snap) => {
    callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as PaymentMethod))
  })
}

/**
 * Initiates a payment via the Cloud Function that calls Stripe.
 * Returns the Stripe PaymentIntent client secret for 3DS confirmation.
 */
export async function initiatePayment(invoiceId: string, paymentMethodId: string): Promise<string> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions } = await import('../lib/firebase')
    const fn = httpsCallable<
      { invoiceId: string; paymentMethodId: string },
      { clientSecret: string }
    >(functions, 'initiatePayment')
    const result = await fn({ invoiceId, paymentMethodId })
    return result.data.clientSecret
  })
}

/**
 * Attaches a new Stripe payment method to the customer via Function.
 * The Function saves the method to Firestore after confirmation.
 */
export async function attachPaymentMethod(
  customerId: string,
  stripePaymentMethodId: string,
): Promise<void> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions } = await import('../lib/firebase')
    const fn = httpsCallable<{ customerId: string; stripePaymentMethodId: string }, void>(
      functions,
      'attachPaymentMethod',
    )
    await fn({ customerId, stripePaymentMethodId })
  })
}

export async function detachPaymentMethod(
  customerId: string,
  paymentMethodId: string,
): Promise<void> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions } = await import('../lib/firebase')
    const fn = httpsCallable<{ customerId: string; paymentMethodId: string }, void>(
      functions,
      'detachPaymentMethod',
    )
    await fn({ customerId, paymentMethodId })
  })
}
