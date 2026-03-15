/**
 * functions/src/stripe.ts
 *
 * createStripePaymentIntent — Callable: creates a PaymentIntent for an invoice
 *
 * The Stripe webhook handler lives in functions/src/webhooks/stripeWebhook.ts
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import Stripe from 'stripe'
import { db, FieldValue } from './admin'
import { STRIPE_SECRET_KEY, requireSecret } from './config'

// ── createStripePaymentIntent ─────────────────────────────────────────────────

/**
 * Creates (or reuses) a Stripe PaymentIntent for a specific invoice.
 * Idempotent: if the invoice already has an open PaymentIntent it is reused.
 *
 * Input:  { invoiceId: string }
 * Output: { clientSecret: string, paymentIntentId: string }
 */
export const createStripePaymentIntent = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.')
    }

    const data = request.data as Record<string, unknown>
    if (typeof data.invoiceId !== 'string' || !data.invoiceId) {
      throw new HttpsError('invalid-argument', 'invoiceId must be a non-empty string.')
    }

    const invoiceSnap = await db.collection('invoices').doc(data.invoiceId).get()
    if (!invoiceSnap.exists) {
      throw new HttpsError('not-found', `Invoice ${data.invoiceId} not found.`)
    }

    const invoice    = invoiceSnap.data()!
    const callerRole = request.auth.token.role as string
    const isOwner    = request.auth.token.customerId === invoice.customerId

    if (!isOwner && !['admin', 'dispatch'].includes(callerRole)) {
      throw new HttpsError('permission-denied', 'You are not authorised to pay this invoice.')
    }
    if (invoice.status === 'paid') {
      throw new HttpsError('failed-precondition', 'Invoice is already paid.')
    }
    if (invoice.status === 'void') {
      throw new HttpsError('failed-precondition', 'Void invoices cannot be paid.')
    }

    const stripeKey = requireSecret(STRIPE_SECRET_KEY.value(), 'STRIPE_SECRET_KEY')
    const stripe    = new Stripe(stripeKey)

    // ── Idempotency: reuse open PaymentIntent ────────────────────────────────
    const existingPiId = invoice.stripePaymentIntentId as string | undefined
    if (existingPiId) {
      try {
        const existing = await stripe.paymentIntents.retrieve(existingPiId)
        if (!['succeeded', 'canceled'].includes(existing.status)) {
          return { clientSecret: existing.client_secret!, paymentIntentId: existing.id }
        }
      } catch { /* fall through to create new */ }
    }

    // ── Resolve Stripe Customer ID ───────────────────────────────────────────
    const customerSnap = await db.collection('customers').doc(invoice.customerId as string).get()
    const stripeCustomerId = customerSnap.data()?.stripeCustomerId as string | undefined

    const amountCents = Math.round((invoice.total as number) * 100)

    const piParams: Stripe.PaymentIntentCreateParams = {
      amount:               amountCents,
      currency:             'usd',
      payment_method_types: ['card', 'us_bank_account'],
      description:          `Invoice ${invoice.invoiceNumber as string} — Ohio Gas Supply Co.`,
      metadata: {
        invoiceId:     data.invoiceId as string,
        customerId:    invoice.customerId as string,
        invoiceNumber: invoice.invoiceNumber as string,
        ohioGasHub:    'true',
      },
    }
    if (stripeCustomerId) piParams.customer = stripeCustomerId

    const paymentIntent = await stripe.paymentIntents.create(piParams)

    // Persist so future calls reuse this PI
    await db.collection('invoices').doc(data.invoiceId as string).update({
      stripePaymentIntentId: paymentIntent.id,
      stripeClientSecret:    paymentIntent.client_secret,
      updatedAt:             FieldValue.serverTimestamp(),
    })

    return { clientSecret: paymentIntent.client_secret!, paymentIntentId: paymentIntent.id }
  },
)
