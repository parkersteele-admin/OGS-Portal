/**
 * functions/src/stripe.ts
 *
 * createStripePaymentIntent — Callable: creates a PaymentIntent for an invoice
 *
 * The Stripe webhook handler lives in functions/src/webhooks/stripeWebhook.ts
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import Stripe from 'stripe'
import { db } from './admin'
import { STRIPE_SECRET_KEY, requireSecret } from './config'

// ── createStripePaymentIntent ─────────────────────────────────────────────────

/**
 * Creates a Stripe PaymentIntent for a specific invoice and returns the
 * `clientSecret` needed by the front-end to confirm the payment.
 *
 * Input:  { invoiceId: string }
 * Output: { clientSecret: string }
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

    const amountCents = Math.round((invoice.totalAmount as number) * 100)

    const paymentIntent = await stripe.paymentIntents.create({
      amount:      amountCents,
      currency:    'usd',
      description: `Invoice ${invoice.invoiceNumber as string} — OGS Portal`,
      metadata: {
        invoiceId:     data.invoiceId,
        customerId:    invoice.customerId  as string,
        invoiceNumber: invoice.invoiceNumber as string,
      },
    })

    return { clientSecret: paymentIntent.client_secret }
  },
)
