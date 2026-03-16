/**
 * src/utils/stripe-test-helpers.ts
 *
 * Development-only utilities for testing the Stripe payment flow manually
 * in a browser console or a dev script.
 *
 * NEVER import this module in production code.  It is guarded at runtime and
 * intentionally excluded from production bundles via the guard below.
 *
 * Usage (browser console, VITE_USE_EMULATORS=true):
 *
 *   const { createTestInvoice, simulateAutopayCharge, simulatePaymentFailure }
 *     = await import('/src/utils/stripe-test-helpers.ts')
 *
 *   const invoice = await createTestInvoice('CUSTOMER_ID', 15000)  // $150.00
 *   await simulateAutopayCharge(invoice.id)     // succeeds → invoice → 'paid'
 *   await simulatePaymentFailure(invoice.id)    // fails   → invoice → 'payment_failed'
 */

// ── Dev-only guard ─────────────────────────────────────────────────────────────
if (!import.meta.env.DEV) {
  throw new Error(
    '[stripe-test-helpers] This module is for development only and must not be imported in production.',
  )
}

import {
  collection,
  addDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { httpsCallable }  from 'firebase/functions'
import { loadStripe }     from '@stripe/stripe-js'
import { db, functions }  from '../lib/firebase'
import { STRIPE_PUBLISHABLE_KEY } from '../lib/env'
import type { Invoice }   from '../types/billing'

// ── Internal helpers ───────────────────────────────────────────────────────────

async function getStripe() {
  const stripe = await loadStripe(STRIPE_PUBLISHABLE_KEY)
  if (!stripe) throw new Error('[stripe-test-helpers] Stripe.js failed to load — check VITE_STRIPE_PUBLISHABLE_KEY')
  return stripe
}

async function getClientSecret(invoiceId: string): Promise<string> {
  const fn = httpsCallable<{ invoiceId: string }, { clientSecret: string }>(
    functions, 'createStripePaymentIntent',
  )
  const { data } = await fn({ invoiceId })
  return data.clientSecret
}

// ── Test card / bank payment method tokens ────────────────────────────────────
// These are Stripe's built-in test payment method IDs.
// They work in test mode only and bypass actual card network processing.

export const TEST_PAYMENT_METHODS = {
  /** Visa — succeeds immediately */
  CARD_SUCCESS:            'pm_card_visa',
  /** Mastercard — insufficient funds → payment_failed */
  CARD_INSUFFICIENT_FUNDS: 'pm_card_mastercard_chargeDeclined',
  /** Visa — card declined generically */
  CARD_DECLINED:           'pm_card_visa_chargeDeclined',
  /** Visa — requires 3D Secure authentication */
  CARD_3DS_REQUIRED:       'pm_card_threeDSecure2Required',
} as const

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Creates a test invoice in Firestore with a single line item.
 * Returns the newly-created Invoice (with its Firestore doc ID assigned).
 *
 * @param customerId  Firestore customer doc ID
 * @param amount      Amount in whole dollars (e.g. 150 = $150.00)
 */
export async function createTestInvoice(
  customerId: string,
  amount: number = 100,
): Promise<Invoice> {
  const now = Timestamp.now()
  const due = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000) // +7 days

  const invoiceNumber = `TEST-${Date.now()}`
  const subtotal = amount
  const tax      = Math.round(amount * 0.08 * 100) / 100
  const total    = subtotal + tax

  const docRef = await addDoc(collection(db, 'invoices'), {
    invoiceNumber,
    customerId,
    status:    'sent',
    lineItems: [
      {
        description: 'Test service — dev helper',
        quantity:    1,
        unitPrice:   subtotal,
        amount:      subtotal,
      },
    ],
    subtotal,
    tax,
    total,
    issuedAt:  now,
    dueAt:     due,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  console.info(`[stripe-test-helpers] Created test invoice ${invoiceNumber} (${docRef.id})`)

  return {
    id:            docRef.id,
    invoiceNumber,
    customerId,
    status:        'sent',
    lineItems:     [{ description: 'Test service — dev helper', quantity: 1, unitPrice: subtotal, amount: subtotal }],
    subtotal,
    tax,
    total,
    issuedAt:  now,
    dueAt:     due,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Calls `createStripePaymentIntent` for the invoice then confirms the payment
 * using the Visa test card (`pm_card_visa`).
 *
 * On success the webhook fires `payment_intent.succeeded`, which marks the
 * Firestore invoice as `'paid'`.
 *
 * Requires the Stripe CLI listener to be forwarding events:
 *   stripe listen --forward-to localhost:5001/ogs-portal/us-central1/stripeWebhook
 */
export async function simulateAutopayCharge(invoiceId: string): Promise<void> {
  console.info(`[stripe-test-helpers] simulateAutopayCharge → invoice ${invoiceId}`)

  const [stripe, clientSecret] = await Promise.all([
    getStripe(),
    getClientSecret(invoiceId),
  ])

  const { error } = await stripe.confirmCardPayment(clientSecret, {
    payment_method: TEST_PAYMENT_METHODS.CARD_SUCCESS,
  })

  if (error) {
    console.error('[stripe-test-helpers] simulateAutopayCharge failed:', error.message)
    throw new Error(error.message)
  }

  console.info(
    '[stripe-test-helpers] Payment confirmed. Waiting for webhook to mark invoice paid…',
    '\n  Watch Firestore: invoices/', invoiceId, ' → status should become "paid"',
  )
}

/**
 * Calls `createStripePaymentIntent` for the invoice then confirms using the
 * "charge declined" test card.
 *
 * On failure the webhook fires `payment_intent.payment_failed`, which marks
 * the Firestore invoice as `'payment_failed'`.
 *
 * Requires the Stripe CLI listener to be forwarding events.
 */
export async function simulatePaymentFailure(invoiceId: string): Promise<void> {
  console.info(`[stripe-test-helpers] simulatePaymentFailure → invoice ${invoiceId}`)

  await getStripe()
  const clientSecret = await getClientSecret(invoiceId)

  // Stripe rejects the confirmation client-side; the failure is also surfaced
  // server-side via the payment_intent.payment_failed webhook.
  console.warn(
    '[stripe-test-helpers] Confirming with CARD_INSUFFICIENT_FUNDS test card.',
    '\n  Expected outcome: payment_intent.payment_failed webhook → invoice "payment_failed"',
    '\n  clientSecret:', clientSecret,
    '\n  Use this card in the UI: 4000 0000 0000 9995  exp: any future  cvc: any',
  )

  // The insufficient-funds card will fail client-side (no confirmCardPayment
  // call needed to trigger the server-side webhook when using Stripe CLI triggers).
  // You can alternatively run:
  //   stripe trigger payment_intent.payment_failed
  console.info(
    '[stripe-test-helpers] Tip — to trigger via CLI:\n',
    '  stripe trigger payment_intent.payment_failed',
  )
}
