/**
 * functions/src/scheduled.ts
 *
 * processAutopay    — Daily 02:00 ET: charge overdue autopay invoices via Stripe
 * lowLevelAlertCheck — Daily 06:00 ET: notify customers/dispatch of low tank levels
 * certExpiryCheck   — Weekly Mon 07:00 ET: alert on tanks due for inspection
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import Stripe from 'stripe'
import { db, FieldValue } from './admin'
import {
  STRIPE_SECRET_KEY,
  SENDGRID_API_KEY,
  requireSecret,
} from './config'
import { sendEmail, lowLevelAlertHtml, autopayReceiptHtml } from './mail'

// ── processAutopay ────────────────────────────────────────────────────────────

/**
 * Runs daily at 02:00 America/New_York.
 *
 * Finds invoices that are:
 *   - status = 'overdue'
 *   - dueAt  < now
 *   - linked customer has autopayEnabled = true + a stripeCustomerId
 *
 * For each, creates and immediately confirms a Stripe PaymentIntent using the
 * customer's default payment method.  On success, marks the invoice 'paid' and
 * records a payment document.  On failure, logs the error for manual follow-up.
 */
export const processAutopay = onSchedule(
  {
    schedule:  '0 2 * * *',   // daily at 02:00
    timeZone:  'America/New_York',
    secrets:   [STRIPE_SECRET_KEY, SENDGRID_API_KEY],
    memory:    '512MiB',
  },
  async (_event) => {
    const stripeKey = requireSecret(STRIPE_SECRET_KEY.value(), 'STRIPE_SECRET_KEY')
    const stripe    = new Stripe(stripeKey)

    const now     = new Date()
    const overdue = await db
      .collection('invoices')
      .where('status', '==', 'overdue')
      .where('dueAt',  '<=', now)
      .get()

    if (overdue.empty) {
      console.log('processAutopay: no overdue invoices found.')
      return
    }

    const results = await Promise.allSettled(
      overdue.docs.map(async (invoiceDoc) => {
        const invoice = invoiceDoc.data()

        // Load the customer
        const customerSnap = await db
          .collection('customers')
          .doc(invoice.customerId as string)
          .get()

        if (!customerSnap.exists) return
        const customer = customerSnap.data()!

        if (!customer.autopayEnabled || !customer.stripeCustomerId) return

        const amountCents = Math.round((invoice.totalAmount as number) * 100)

        // Create and immediately confirm using the customer's default PM
        const pi = await stripe.paymentIntents.create({
          amount:              amountCents,
          currency:            'usd',
          customer:            customer.stripeCustomerId as string,
          payment_method:      customer.stripeDefaultPaymentMethodId as string | undefined,
          confirm:             true,
          off_session:         true,
          description:         `Autopay — Invoice ${invoice.invoiceNumber as string}`,
          metadata: {
            invoiceId:     invoiceDoc.id,
            customerId:    invoice.customerId  as string,
            invoiceNumber: invoice.invoiceNumber as string,
          },
        })

        if (pi.status === 'succeeded') {
          const batch = db.batch()
          batch.update(invoiceDoc.ref, {
            status:    'paid',
            paidAt:    FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })
          const paymentRef = db.collection('payments').doc()
          batch.set(paymentRef, {
            invoiceId:             invoiceDoc.id,
            customerId:            invoice.customerId,
            amount:                invoice.totalAmount,
            currency:              'USD',
            stripePaymentIntentId: pi.id,
            method:                'autopay',
            status:                'succeeded',
            createdAt:             FieldValue.serverTimestamp(),
          })
          await batch.commit()

          if (customer.email) {
            await sendEmail({
              to:      customer.email as string,
              subject: `Autopay Receipt — Invoice ${invoice.invoiceNumber as string}`,
              html:    autopayReceiptHtml({
                customerName:  customer.name  as string,
                invoiceNumber: invoice.invoiceNumber as string,
                amount:        `$${(invoice.totalAmount as number).toFixed(2)}`,
              }),
            })
          }

          console.log(`processAutopay: charged ${invoiceDoc.id} (${pi.id})`)
        } else {
          console.warn(`processAutopay: PaymentIntent ${pi.id} status = ${pi.status}`)
        }
      }),
    )

    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      console.error(`processAutopay: ${failed.length} charge(s) failed`, failed)
    }
  },
)

// ── lowLevelAlertCheck ────────────────────────────────────────────────────────

/**
 * Runs daily at 06:00 America/New_York.
 *
 * Finds deployed tanks where currentLevelPct <= 15.
 * For each, creates a Firestore notification document (if one hasn't been
 * created in the past 24 h) and sends an email to the associated customer.
 *
 * Threshold: 15% — configurable here.
 */
export const lowLevelAlertCheck = onSchedule(
  {
    schedule: '0 6 * * *',
    timeZone: 'America/New_York',
    secrets:  [SENDGRID_API_KEY],
    memory:   '512MiB',
  },
  async (_event) => {
    const LOW_LEVEL_PCT = 15

    const tanksSnap = await db
      .collection('tanks')
      .where('status', '==', 'deployed')
      .where('currentLevelPct', '<=', LOW_LEVEL_PCT)
      .get()

    if (tanksSnap.empty) {
      console.log('lowLevelAlertCheck: no low tanks found.')
      return
    }

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    await Promise.allSettled(
      tanksSnap.docs.map(async (tankDoc) => {
        const tank = tankDoc.data()

        // De-duplicate: skip if we already sent an alert within the last 24 h
        const recentAlert = await db
          .collection('notifications')
          .where('entityId', '==', tankDoc.id)
          .where('type',     '==', 'low_tank_level')
          .where('createdAt', '>=', yesterday)
          .limit(1)
          .get()

        if (!recentAlert.empty) return

        // Create in-app notification
        await db.collection('notifications').add({
          userId:    tank.customerId ?? null,
          type:      'low_tank_level',
          title:     'Low Tank Level',
          body:      `Tank ${tank.serialNumber as string} is at ${tank.currentLevelPct as number}% capacity.`,
          entityId:  tankDoc.id,
          read:      false,
          createdAt: FieldValue.serverTimestamp(),
        })

        // Email the customer
        if (!tank.customerId) return
        const customerSnap = await db.collection('customers').doc(tank.customerId as string).get()
        if (!customerSnap.exists) return
        const customer = customerSnap.data()!
        if (!customer.email) return

        await sendEmail({
          to:      customer.email as string,
          subject: `Low Tank Level Alert — ${tank.serialNumber as string}`,
          html:    lowLevelAlertHtml({
            customerName: customer.name       as string,
            tankSerial:   tank.serialNumber   as string,
            levelPct:     tank.currentLevelPct as number,
          }),
        })

        console.log(`lowLevelAlertCheck: alerted for tank ${tankDoc.id}`)
      }),
    )
  },
)

// ── certExpiryCheck ───────────────────────────────────────────────────────────

/**
 * Runs weekly every Monday at 07:00 America/New_York.
 *
 * Finds tanks whose nextInspectionDate is within the next 30 days.
 * Creates a Firestore notification for dispatch so they can schedule the
 * inspection before it lapses.
 */
export const certExpiryCheck = onSchedule(
  {
    schedule: '0 7 * * 1', // every Monday at 07:00
    timeZone: 'America/New_York',
    memory:   '256MiB',
  },
  async (_event) => {
    const WARN_DAYS = 30

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + WARN_DAYS)

    const now = new Date()

    const tanksSnap = await db
      .collection('tanks')
      .where('nextInspectionDate', '<=', cutoff)
      .where('nextInspectionDate', '>=', now)
      .get()

    if (tanksSnap.empty) {
      console.log('certExpiryCheck: no upcoming inspections found.')
      return
    }

    // Create one notification per expiring tank (for dispatch)
    const batch = db.batch()

    tanksSnap.docs.forEach((tankDoc) => {
      const tank          = tankDoc.data()
      const inspectionDate = (tank.nextInspectionDate as { toDate(): Date }).toDate()

      const notifRef = db.collection('notifications').doc()
      batch.set(notifRef, {
        userId:    null, // dispatched to all dispatch users via role filtering
        role:      'dispatch',
        type:      'cert_expiry',
        title:     'Inspection Due Soon',
        body:      `Tank ${tank.serialNumber as string} inspection due ${inspectionDate.toLocaleDateString()}.`,
        entityId:  tankDoc.id,
        read:      false,
        createdAt: FieldValue.serverTimestamp(),
      })
    })

    await batch.commit()

    console.log(`certExpiryCheck: created ${tanksSnap.size} inspection alert(s).`)
  },
)
