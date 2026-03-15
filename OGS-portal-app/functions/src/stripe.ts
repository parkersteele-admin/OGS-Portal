/**
 * functions/src/stripe.ts
 *
 * stripeWebhook           — HTTPS trigger: receives events from Stripe
 * createStripePaymentIntent — Callable: creates a PaymentIntent for an invoice
 */

import { onRequest } from 'firebase-functions/v2/https'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import Stripe from 'stripe'
import { db, FieldValue } from './admin'
import {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  requireSecret,
} from './config'

// ── Stripe webhook ────────────────────────────────────────────────────────────

/**
 * HTTPS trigger that receives signed Stripe events.
 *
 * Register this URL in the Stripe dashboard under Developers → Webhooks:
 *   https://us-central1-ogs-portal.cloudfunctions.net/stripeWebhook
 *
 * Required events to enable:
 *   payment_intent.succeeded
 *   payment_intent.payment_failed
 *   customer.subscription.deleted
 *
 * Firebase Functions provides `req.rawBody` (Buffer) for signature verification.
 */
export const stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed')
      return
    }

    const stripeKey     = requireSecret(STRIPE_SECRET_KEY.value(),     'STRIPE_SECRET_KEY')
    const webhookSecret = requireSecret(STRIPE_WEBHOOK_SECRET.value(), 'STRIPE_WEBHOOK_SECRET')
    const stripe        = new Stripe(stripeKey)

    const sig = req.headers['stripe-signature']
    // Firebase Functions runtime populates req.rawBody with the unmodified
    // request body as a Buffer — required for webhook signature verification.
    const rawBody = (req as typeof req & { rawBody: Buffer }).rawBody

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig as string, webhookSecret)
    } catch (err) {
      console.error('Stripe signature verification failed:', err)
      res.status(400).json({ error: 'Webhook signature verification failed' })
      return
    }

    try {
      switch (event.type) {

        case 'payment_intent.succeeded': {
          const pi = event.data.object as Stripe.PaymentIntent
          if (!pi.metadata?.invoiceId) break

          const batch = db.batch()

          // Mark invoice paid
          batch.update(db.collection('invoices').doc(pi.metadata.invoiceId), {
            status: 'paid',
            paidAt: FieldValue.serverTimestamp(),
          })

          // Record the payment
          const paymentRef = db.collection('payments').doc()
          batch.set(paymentRef, {
            invoiceId:             pi.metadata.invoiceId,
            customerId:            pi.metadata.customerId ?? null,
            amount:                pi.amount / 100, // Stripe stores cents
            currency:              pi.currency.toUpperCase(),
            stripePaymentIntentId: pi.id,
            method:                'card',
            status:                'succeeded',
            createdAt:             FieldValue.serverTimestamp(),
          })

          await batch.commit()
          break
        }

        case 'payment_intent.payment_failed': {
          const pi = event.data.object as Stripe.PaymentIntent
          if (!pi.metadata?.invoiceId) break

          // Revert to overdue so dispatch can follow up
          await db.collection('invoices').doc(pi.metadata.invoiceId).update({
            status: 'overdue',
          })

          console.warn(
            `PaymentIntent ${pi.id} failed for invoice ${pi.metadata.invoiceId}:`,
            pi.last_payment_error?.message,
          )
          break
        }

        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription
          const customerId = (sub.metadata as Record<string, string>).customerId
          if (!customerId) break

          await db.collection('customers').doc(customerId).update({
            autopayEnabled: false,
            updatedAt:      FieldValue.serverTimestamp(),
          })
          break
        }

        default:
          // Log but don't error — Stripe sends many event types
          console.log(`Unhandled Stripe event: ${event.type}`)
      }
    } catch (err) {
      console.error(`Error processing Stripe event ${event.type}:`, err)
      // Return 500 so Stripe retries the delivery
      res.status(500).json({ error: 'Internal processing error' })
      return
    }

    res.json({ received: true })
  },
)

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
