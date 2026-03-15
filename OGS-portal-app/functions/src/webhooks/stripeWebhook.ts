/**
 * functions/src/webhooks/stripeWebhook.ts
 *
 * HTTPS endpoint: POST /stripeWebhook
 *
 * Registers as a signed Stripe webhook receiver.  Register this URL in the
 * Stripe Dashboard → Developers → Webhooks:
 *   https://us-central1-ogs-portal.cloudfunctions.net/stripeWebhook
 *
 * Enabled events (set in the Stripe Dashboard):
 *   payment_intent.succeeded
 *   payment_intent.payment_failed
 *   customer.subscription.deleted
 *
 * Design decisions:
 *  - Signature verification happens before any business logic; 400 on failure.
 *  - Idempotency: processed event IDs stored in stripeEvents/{eventId}.
 *    Duplicate deliveries return 200 immediately.
 *  - Per-event handlers are isolated in try/catch.
 *    Business-logic failures → log + 200 (Stripe should NOT retry).
 *    Unrecoverable errors   → log + 500 (Stripe will retry).
 *  - Raw body (Buffer) is used for signature verification; never re-parse.
 */

import { onRequest, type Request } from 'firebase-functions/v2/https'
import Stripe from 'stripe'
import { db, FieldValue } from '../admin'
import { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, requireSecret } from '../config'
import { sendEmail } from '../mail'

// Firebase Functions injects req.rawBody as a Buffer — typed here for clarity.
type RawRequest = Request & { rawBody: Buffer }

export const stripeWebhook = onRequest(
  {
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
    // Explicitly allow raw body access; Firebase Functions provides this by default
    // on Gen 2 HTTPS triggers.
  },
  async (req, res) => {

    // ── Method guard ──────────────────────────────────────────────────────────
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed')
      return
    }

    const stripeKey     = requireSecret(STRIPE_SECRET_KEY.value(),     'STRIPE_SECRET_KEY')
    const webhookSecret = requireSecret(STRIPE_WEBHOOK_SECRET.value(), 'STRIPE_WEBHOOK_SECRET')
    const stripe        = new Stripe(stripeKey)

    // ── Signature verification ────────────────────────────────────────────────
    // Must use raw body — never the parsed JSON body — for HMAC verification.
    const sig     = req.headers['stripe-signature']
    const rawBody = (req as RawRequest).rawBody

    if (!sig || !rawBody) {
      console.error('stripeWebhook: missing stripe-signature header or raw body')
      res.status(400).json({ error: 'Missing signature or body' })
      return
    }

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
    } catch (err) {
      console.error('stripeWebhook: signature verification failed —', (err as Error).message)
      res.status(400).json({ error: 'Webhook signature verification failed' })
      return
    }

    // ── Idempotency check ─────────────────────────────────────────────────────
    // Stripe may deliver the same event more than once.  Store processed event
    // IDs in stripeEvents/{eventId} so we can skip duplicates.
    const eventRef = db.collection('stripeEvents').doc(event.id)
    const eventSnap = await eventRef.get().catch(() => null)

    if (eventSnap?.exists) {
      console.log(`stripeWebhook: duplicate event ${event.id} — skipping`)
      res.json({ received: true, duplicate: true })
      return
    }

    // Mark the event as in-progress before handling (prevents races on retry)
    await eventRef.set({
      eventId:     event.id,
      type:        event.type,
      processedAt: FieldValue.serverTimestamp(),
      status:      'processing',
    }).catch((err) => {
      // Non-fatal: continue even if we couldn't write the idempotency record
      console.warn('stripeWebhook: failed to write idempotency record —', err)
    })

    // ── Route to event handler ────────────────────────────────────────────────
    let success = true
    let handlerError: unknown

    try {
      switch (event.type) {

        case 'payment_intent.succeeded':
          await handlePaymentIntentSucceeded(
            event.data.object as Stripe.PaymentIntent,
          )
          break

        case 'payment_intent.payment_failed':
          await handlePaymentIntentFailed(
            event.data.object as Stripe.PaymentIntent,
          )
          break

        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(
            event.data.object as Stripe.Subscription,
          )
          break

        default:
          console.log(`stripeWebhook: unhandled event type "${event.type}" — acknowledged`)
      }
    } catch (err) {
      success = false
      handlerError = err
      console.error(`stripeWebhook: unrecoverable error handling "${event.type}" —`, err)
    }

    // Update idempotency record with final status
    await eventRef.update({
      status:     success ? 'processed' : 'failed',
      error:      success ? null : String(handlerError),
      finishedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined) // best-effort

    if (!success) {
      // 500 tells Stripe to retry the delivery
      res.status(500).json({ error: 'Internal processing error' })
      return
    }

    res.json({ received: true })
  },
)

// ── payment_intent.succeeded ──────────────────────────────────────────────────

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent): Promise<void> {
  const { invoiceId, customerId, invoiceNumber } = pi.metadata ?? {}

  if (!invoiceId) {
    console.warn(`payment_intent.succeeded [${pi.id}]: no invoiceId in metadata — ignoring`)
    return
  }

  // ── Load invoice ─────────────────────────────────────────────────────────
  const invoiceRef  = db.collection('invoices').doc(invoiceId)
  const invoiceSnap = await invoiceRef.get()

  if (!invoiceSnap.exists) {
    console.warn(`payment_intent.succeeded [${pi.id}]: invoice ${invoiceId} not found`)
    return
  }

  const invoice    = invoiceSnap.data()!
  const resolvedCustomerId = customerId ?? (invoice.customerId as string | undefined)
  const amount     = pi.amount / 100 // Stripe stores cents

  // Already paid — idempotent; do not double-record
  if (invoice.status === 'paid') {
    console.log(`payment_intent.succeeded [${pi.id}]: invoice ${invoiceId} already paid — skip`)
    return
  }

  // ── Atomic write: invoice + payment record ────────────────────────────────
  const batch      = db.batch()
  const paymentRef = db.collection('payments').doc()

  batch.update(invoiceRef, {
    status:                'paid',
    paidAt:                FieldValue.serverTimestamp(),
    stripePaymentIntentId: pi.id,
    updatedAt:             FieldValue.serverTimestamp(),
  })

  batch.set(paymentRef, {
    invoiceId,
    customerId:            resolvedCustomerId ?? null,
    orderId:               invoice.orderId    ?? null,
    invoiceNumber:         invoiceNumber      ?? invoice.invoiceNumber ?? null,
    amount,
    currency:              pi.currency.toUpperCase(),
    stripePaymentIntentId: pi.id,
    method:                pi.payment_method_types?.[0] ?? 'card',
    status:                'succeeded',
    createdAt:             FieldValue.serverTimestamp(),
  })

  await batch.commit()

  console.log(`payment_intent.succeeded [${pi.id}]: invoice ${invoiceId} marked paid — $${amount.toFixed(2)}`)

  // ── Notifications + email (best-effort — don't re-throw) ─────────────────

  let customerData: Record<string, unknown> | null = null
  if (resolvedCustomerId) {
    try {
      const snap = await db.collection('customers').doc(resolvedCustomerId).get()
      customerData = snap.exists ? (snap.data() as Record<string, unknown>) : null
    } catch (err) {
      console.error(`payment_intent.succeeded [${pi.id}]: failed to fetch customer —`, err)
    }
  }

  // In-app notification: customer
  if (resolvedCustomerId) {
    try {
      await db.collection('notifications').add({
        userId:    resolvedCustomerId,
        type:      'payment_received',
        title:     'Payment Received',
        body:      `Your payment of $${amount.toFixed(2)} for invoice #${invoiceNumber ?? invoiceId} was successful.`,
        entityId:  invoiceId,
        read:      false,
        createdAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error(`payment_intent.succeeded [${pi.id}]: customer notification failed —`, err)
    }
  }

  // In-app notification: dispatch
  try {
    await db.collection('notifications').add({
      userId:    null,
      role:      'dispatch',
      type:      'payment_received',
      title:     'Payment Received',
      body:      `Invoice #${invoiceNumber ?? invoiceId} paid — $${amount.toFixed(2)}.`,
      entityId:  invoiceId,
      read:      false,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.error(`payment_intent.succeeded [${pi.id}]: dispatch notification failed —`, err)
  }

  // Receipt email
  if (customerData?.email) {
    try {
      await sendEmail({
        to:      customerData.email as string,
        subject: `Payment Receipt — Invoice #${invoiceNumber ?? invoiceId}`,
        html: `
          <h2>Payment Received — OGS Portal</h2>
          <p>Hi ${customerData.name as string},</p>
          <p>We received your payment of <strong>$${amount.toFixed(2)}</strong>
          for invoice <strong>#${invoiceNumber ?? invoiceId}</strong>.</p>
          <p>Thank you — your account is up to date.</p>
          <p style="margin-top:24px">
            <a href="https://app.ogsportal.com/portal/invoices"
               style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">
              View Invoices →
            </a>
          </p>
          <p style="margin-top:24px;color:#666;font-size:12px">— The OGS Portal Team</p>
        `,
      })
    } catch (err) {
      console.error(`payment_intent.succeeded [${pi.id}]: receipt email failed —`, err)
    }
  }
}

// ── payment_intent.payment_failed ────────────────────────────────────────────

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent): Promise<void> {
  const { invoiceId, customerId, invoiceNumber } = pi.metadata ?? {}
  const failReason = pi.last_payment_error?.message ?? 'Unknown reason'

  console.warn(
    `payment_intent.payment_failed [${pi.id}]:`,
    invoiceId ? `invoice=${invoiceId}` : '(no invoiceId)',
    `reason="${failReason}"`,
  )

  if (!invoiceId) return

  // ── Update invoice status ─────────────────────────────────────────────────
  // Use 'payment_failed' so dispatch can distinguish from general overdue.
  try {
    await db.collection('invoices').doc(invoiceId).update({
      status:            'payment_failed',
      lastFailureReason: failReason,
      lastFailedAt:      FieldValue.serverTimestamp(),
      updatedAt:         FieldValue.serverTimestamp(),
    })
  } catch (err) {
    // This is recoverable-ish — log and continue so emails still fire
    console.error(`payment_intent.payment_failed [${pi.id}]: invoice update failed —`, err)
  }

  const resolvedCustomerId = customerId
  let customerData: Record<string, unknown> | null = null

  if (resolvedCustomerId) {
    try {
      const snap = await db.collection('customers').doc(resolvedCustomerId).get()
      customerData = snap.exists ? (snap.data() as Record<string, unknown>) : null
    } catch (err) {
      console.error(`payment_intent.payment_failed [${pi.id}]: could not fetch customer —`, err)
    }
  }

  // ── If autopay: flag account for manual follow-up ─────────────────────────
  if (resolvedCustomerId && customerData?.autopayEnabled) {
    try {
      await db.collection('customers').doc(resolvedCustomerId).update({
        autopayFailedAt:     FieldValue.serverTimestamp(),
        autopayFollowUpFlag: true,
        updatedAt:           FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error(`payment_intent.payment_failed [${pi.id}]: customer flag failed —`, err)
    }
  }

  // ── Staff alert notification ──────────────────────────────────────────────
  try {
    await db.collection('notifications').add({
      userId:    null,
      role:      'dispatch',
      type:      'payment_failed',
      title:     'Payment Failed',
      body:      `Invoice #${invoiceNumber ?? invoiceId} payment failed: ${failReason}`,
      entityId:  invoiceId,
      priority:  'high',
      read:      false,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.error(`payment_intent.payment_failed [${pi.id}]: staff alert failed —`, err)
  }

  // ── Customer failure email ────────────────────────────────────────────────
  if (customerData?.email) {
    try {
      await sendEmail({
        to:      customerData.email as string,
        subject: `Payment Failed — Invoice #${invoiceNumber ?? invoiceId}`,
        html: `
          <h2>Payment Issue — OGS Portal</h2>
          <p>Hi ${customerData.name as string},</p>
          <p>Unfortunately, your payment of
          <strong>$${(pi.amount / 100).toFixed(2)}</strong>
          for invoice <strong>#${invoiceNumber ?? invoiceId}</strong> could not be processed.</p>
          <p><strong>Reason:</strong> ${failReason}</p>
          <p>Please update your payment method or contact us to resolve this.</p>
          <p style="margin-top:24px">
            <a href="https://app.ogsportal.com/portal/invoices"
               style="background:#dc2626;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">
              Resolve Payment →
            </a>
          </p>
          <p style="margin-top:24px;color:#666;font-size:12px">
            If you need help, reply to this email or call our support line.<br>
            — The OGS Portal Team
          </p>
        `,
      })
    } catch (err) {
      console.error(`payment_intent.payment_failed [${pi.id}]: failure email failed —`, err)
    }
  }
}

// ── customer.subscription.deleted ────────────────────────────────────────────

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  // Placeholder — tank rental subscriptions will be handled here.
  //
  // When implemented, this should:
  //  1. Find the customer by sub.metadata.customerId or sub.customer (Stripe customer ID)
  //  2. Set customer.activeSubscriptionId = null
  //  3. Find any tanks whose rentalSubscriptionId === sub.id and mark rentals ended
  //  4. Notify dispatch that the rental has lapsed
  //
  // For now, just log the event so we can monitor volume and build against real data.

  const customerId = (sub.metadata as Record<string, string>).customerId
  console.log(
    `customer.subscription.deleted: sub=${sub.id}`,
    customerId ? `customer=${customerId}` : '(no customerId in metadata)',
    `status=${sub.status}`,
    `cancel_at_period_end=${sub.cancel_at_period_end}`,
  )

  // Disable autopay as a safety measure when a subscription is removed
  if (customerId) {
    try {
      await db.collection('customers').doc(customerId).update({
        autopayEnabled: false,
        updatedAt:      FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error(`customer.subscription.deleted: failed to disable autopay for ${customerId} —`, err)
    }
  }
}
