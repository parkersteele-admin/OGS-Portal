/**
 * functions/src/scheduled/processAutopay.ts
 *
 * Schedule: daily 06:00 America/New_York
 *
 * Queries invoices where status = 'pending' and dueAt <= today belonging to
 * customers with autopay enabled.
 *
 * For each:
 *  1. Fetch customer + Stripe payment method.
 *  2. Create and immediately confirm a Stripe PaymentIntent (off-session).
 *  3. On success: mark invoice 'paid', record payment, send receipt email.
 *     Invoice status is also updated by the stripeWebhook for redundancy.
 *  4. On Stripe failure: update invoice to 'payment_failed', flag customer,
 *     send failure email, create staff notification.
 *  5. Log processing totals at the end of each run.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import Stripe from 'stripe'
import { db, FieldValue } from '../admin'
import { STRIPE_SECRET_KEY, SENDGRID_API_KEY, requireSecret } from '../config'
import { sendEmail } from '../mail'
import { createNotification } from '../notifications/createNotification'

export const processAutopay = onSchedule(
  {
    schedule:       '0 6 * * *',
    timeZone:       'America/New_York',
    secrets:        [STRIPE_SECRET_KEY, SENDGRID_API_KEY],
    memory:         '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const stripeKey = requireSecret(STRIPE_SECRET_KEY.value(), 'STRIPE_SECRET_KEY')
    requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY')
    const stripe = new Stripe(stripeKey)

    const now = new Date()

    // ── Query pending invoices due today or earlier ───────────────────────────
    const invoicesSnap = await db
      .collection('invoices')
      .where('status', '==', 'pending')
      .where('dueAt',  '<=', now)
      .get()

    if (invoicesSnap.empty) {
      console.log('processAutopay: no pending invoices due today.')
      return
    }

    console.log(`processAutopay: ${invoicesSnap.size} invoice(s) to process.`)

    const stats = { charged: 0, skipped: 0, failed: 0 }

    await Promise.allSettled(
      invoicesSnap.docs.map(async (invoiceDoc) => {
        const invoice    = invoiceDoc.data() as Record<string, unknown>
        const invoiceId  = invoiceDoc.id
        const customerId = invoice.customerId as string | undefined

        if (!customerId) {
          console.warn(`processAutopay [${invoiceId}]: no customerId — skip`)
          stats.skipped++
          return
        }

        // ── Fetch customer ──────────────────────────────────────────────────
        const customerSnap = await db.collection('customers').doc(customerId).get()
        if (!customerSnap.exists) {
          console.warn(`processAutopay [${invoiceId}]: customer ${customerId} not found — skip`)
          stats.skipped++
          return
        }
        const customer = customerSnap.data() as Record<string, unknown>

        if (!customer.autopayEnabled) {
          stats.skipped++
          return
        }

        if (!customer.stripeCustomerId || !customer.stripeDefaultPaymentMethodId) {
          console.warn(`processAutopay [${invoiceId}]: customer ${customerId} has no Stripe PM — skip`)
          stats.skipped++
          return
        }

        const amountCents    = Math.round((invoice.totalAmount as number) * 100)
        const invoiceNumber  = invoice.invoiceNumber as string
        const stripeCustomer = customer.stripeCustomerId as string
        const stripePM       = customer.stripeDefaultPaymentMethodId as string

        // ── Verify PM is valid before charging ──────────────────────────────
        let paymentMethod: Stripe.PaymentMethod
        try {
          paymentMethod = await stripe.paymentMethods.retrieve(stripePM)
          if (paymentMethod.customer !== stripeCustomer) {
            throw new Error(`PM ${stripePM} does not belong to customer ${stripeCustomer}`)
          }
        } catch (err) {
          console.error(`processAutopay [${invoiceId}]: PM validation failed —`, err)
          stats.skipped++
          return
        }

        // ── Create + confirm PaymentIntent ───────────────────────────────────
        let pi: Stripe.PaymentIntent
        try {
          pi = await stripe.paymentIntents.create({
            amount:         amountCents,
            currency:       'usd',
            customer:       stripeCustomer,
            payment_method: stripePM,
            confirm:        true,
            off_session:    true,
            description:    `Autopay — Invoice ${invoiceNumber}`,
            metadata: {
              invoiceId,
              customerId,
              invoiceNumber,
              source: 'processAutopay_scheduled',
            },
          })
        } catch (err) {
          // Stripe threw synchronously (e.g. card_error, authentication_required)
          const message = err instanceof Stripe.errors.StripeError
            ? err.message
            : String(err)

          console.error(`processAutopay [${invoiceId}]: Stripe charge failed — ${message}`)
          await handleAutopayFailure(invoiceDoc.ref, invoiceId, invoiceNumber, customer, customerId, message)
          stats.failed++
          return
        }

        if (pi.status === 'succeeded') {
          // ── Success: mark invoice paid + record payment ──────────────────
          const batch      = db.batch()
          const paymentRef = db.collection('payments').doc()

          batch.update(invoiceDoc.ref, {
            status:                'paid',
            paidAt:                FieldValue.serverTimestamp(),
            stripePaymentIntentId: pi.id,
            updatedAt:             FieldValue.serverTimestamp(),
          })
          batch.set(paymentRef, {
            invoiceId,
            customerId,
            invoiceNumber,
            amount:                invoice.totalAmount,
            currency:              'USD',
            stripePaymentIntentId: pi.id,
            method:                'autopay',
            status:                'succeeded',
            createdAt:             FieldValue.serverTimestamp(),
          })
          await batch.commit()

          // Receipt email (best-effort)
          if (customer.email) {
            try {
              await sendEmail({
                to:      customer.email as string,
                subject: `Autopay Receipt — Invoice #${invoiceNumber}`,
                html: `
                  <h2>Autopay Receipt — OGS Portal</h2>
                  <p>Hi ${customer.name as string},</p>
                  <p>A payment of <strong>$${(invoice.totalAmount as number).toFixed(2)}</strong>
                  was automatically collected for invoice <strong>#${invoiceNumber}</strong>.</p>
                  <p>Thank you for using autopay.</p>
                  <p style="margin-top:24px">
                    <a href="https://app.ohiogassupply.com/portal/invoices"
                       style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">
                      View Invoices →
                    </a>
                  </p>
                  <p style="color:#666;font-size:12px;margin-top:24px">— The OGS Portal Team</p>
                `,
              })
            } catch (err) {
              console.error(`processAutopay [${invoiceId}]: receipt email failed —`, err)
            }
          }

          console.log(`processAutopay [${invoiceId}]: charged $${(amountCents / 100).toFixed(2)} (${pi.id})`)
          stats.charged++
        } else {
          // requires_action, processing, etc.
          console.warn(`processAutopay [${invoiceId}]: PI ${pi.id} status=${pi.status} — manual review needed`)
          await handleAutopayFailure(invoiceDoc.ref, invoiceId, invoiceNumber, customer, customerId,
            `PaymentIntent status: ${pi.status}`)
          stats.failed++
        }
      }),
    )

    console.log(
      `processAutopay complete — charged=${stats.charged}, skipped=${stats.skipped}, failed=${stats.failed}`,
    )
  },
)

// ── Helper ────────────────────────────────────────────────────────────────────

async function handleAutopayFailure(
  invoiceRef:    FirebaseFirestore.DocumentReference,
  invoiceId:     string,
  invoiceNumber: string,
  customer:      Record<string, unknown>,
  customerId:    string,
  reason:        string,
): Promise<void> {
  await Promise.allSettled([
    // Update invoice
    invoiceRef.update({
      status:            'payment_failed',
      lastFailureReason: reason,
      lastFailedAt:      FieldValue.serverTimestamp(),
      updatedAt:         FieldValue.serverTimestamp(),
    }),

    // Flag customer for follow-up
    db.collection('customers').doc(customerId).update({
      autopayFailedAt:     FieldValue.serverTimestamp(),
      autopayFollowUpFlag: true,
      updatedAt:           FieldValue.serverTimestamp(),
    }),

    // Staff notification
    createNotification({
      userId:   null,
      role:     'dispatch',
      type:     'autopay_failed',
      title:    'Autopay Failed',
      body:     `Invoice #${invoiceNumber} autopay failed: ${reason}`,
      entityId: invoiceId,
      priority: 'high',
    }),

    // Customer email
    customer.email
      ? sendEmail({
          to:      customer.email as string,
          subject: `Autopay Failed — Invoice #${invoiceNumber}`,
          html: `
            <h2>Autopay Payment Failed — OGS Portal</h2>
            <p>Hi ${customer.name as string},</p>
            <p>We were unable to process your autopay payment for invoice
            <strong>#${invoiceNumber}</strong>.</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>Please update your payment method to avoid service interruption.</p>
            <p style="margin-top:24px">
              <a href="https://app.ohiogassupply.com/portal/invoices"
                 style="background:#dc2626;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">
                Resolve Now →
              </a>
            </p>
            <p style="color:#666;font-size:12px;margin-top:24px">— The OGS Portal Team</p>
          `,
        })
      : Promise.resolve(),
  ])
}
