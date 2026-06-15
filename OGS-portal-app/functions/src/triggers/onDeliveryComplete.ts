/**
 * functions/src/triggers/onDeliveryComplete.ts
 *
 * Trigger: Firestore onDocumentUpdated — runs/{runId}/stops/{stopId}
 * Condition: stop.status transitions to 'delivered' or 'completed'
 *
 * Execution sequence (each step wrapped in try/catch — see below):
 *
 *  1. [Transaction] Update order:     status='delivered', deliveredAt, quantityDelivered
 *  2. [Transaction] Update tank level: recalculate currentLevelPct, lastFilledAt
 *  2b.              Clear any pending low-level alerts if new level > 25%
 *  3.               Generate invoice:  line items, tier upcharge, rental, delivery fee
 *  4.               Handle autopay:    Stripe PaymentIntent (off-session) OR invoice email
 *  5.               Delivery confirmation email to customer
 *  6.               In-app notification for dispatch
 *  [bonus]          Run completion check: mark run 'completed' if all stops delivered
 *
 * Error strategy:
 *  - Steps 1+2 (transaction): re-throw on failure — function retries are desirable
 *  - Steps 3-6 + run check:   catch + log, continue — delivery is complete regardless
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import Stripe from 'stripe'
import { db, FieldValue } from '../admin'
import { STRIPE_SECRET_KEY, requireSecret } from '../config'
import { sendEmail } from '../mail'
import { createNotification } from '../notifications/createNotification'
import { generateInvoicePdf } from '../pdf/generateInvoicePdf'
import { appendStatusHistory } from '../lib/orderStatus'

// ── Business-rule constants ───────────────────────────────────────────────────
// Adjust these without touching logic.

const DELIVERY_TIER_UPCHARGE: Record<string, number> = {
  standard:  0,
  express:   0.15,
  emergency: 0.30,
}

const TANK_RENTAL_MONTHLY_FEE = 15.00  // USD per month
const FLAT_DELIVERY_FEE       = 12.50  // USD per delivery
const TAX_RATE                = 0.08   // 8 %
const LOW_LEVEL_THRESHOLD_PCT = 25     // clear alerts above this

// ── Trigger ───────────────────────────────────────────────────────────────────

export const onDeliveryComplete = onDocumentUpdated(
  {
    document:      'runs/{runId}/stops/{stopId}',
    secrets:       [STRIPE_SECRET_KEY],
    memory:        '512MiB',
    timeoutSeconds: 300,
  },
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()

    // React only when a stop first enters a delivery-complete state.
    const beforeStatus = before?.status as string | undefined
    const afterStatus = after?.status as string | undefined
    const wasDeliveryComplete = beforeStatus === 'delivered' || beforeStatus === 'completed'
    const isDeliveryComplete = afterStatus === 'delivered' || afterStatus === 'completed'

    if (!after || wasDeliveryComplete || !isDeliveryComplete) {
      return
    }

    // Signed-delivery flow is handled end-to-end by finalizeSignedDelivery callable.
    // Skip here to avoid duplicate invoice emails/notifications.
    if (afterStatus === 'completed' && (after.signedAt || after.signatureUrl)) {
      return
    }

    const { runId, stopId } = event.params
    const orderId           = after.orderId          as string | undefined
    const quantityDelivered = (after.quantityDelivered ?? after.gallonsDelivered ?? after.gallons ?? 0) as number

    if (!orderId) {
      console.error(`onDeliveryComplete [stop=${stopId}]: missing orderId — skipping`)
      return
    }

    console.log(`onDeliveryComplete: run=${runId} stop=${stopId} order=${orderId} qty=${quantityDelivered}`)

    // Shared state accumulated across steps
    let orderData:    Record<string, unknown> | undefined
    let tankId:       string | undefined
    let newLevelPct   = 0
    let customerId:   string | undefined
    let customerData: Record<string, unknown> | null = null

    // ── Steps 1 + 2: Transaction ─────────────────────────────────────────────
    try {
      await db.runTransaction(async (tx) => {
        // ── Read order ────────────────────────────────────────────────────────
        const orderRef  = db.collection('orders').doc(orderId)
        const orderSnap = await tx.get(orderRef)
        if (!orderSnap.exists) {
          throw new Error(`Order ${orderId} not found`)
        }
        orderData  = orderSnap.data() as Record<string, unknown>
        tankId     = orderData.tankId  as string | undefined
        customerId = orderData.customerId as string | undefined

        // ── Step 1: Update order ──────────────────────────────────────────────
        const shouldMarkReadyToInvoice =
          afterStatus === 'completed' && (orderData.deliveryStatus as string | undefined) !== 'signed'
        const nextOrderStatus = shouldMarkReadyToInvoice ? 'ready_to_invoice' : 'delivered'
        tx.update(orderRef, {
          status:             nextOrderStatus,
          deliveredAt:        FieldValue.serverTimestamp(),
          quantityDelivered,
          updatedAt:          FieldValue.serverTimestamp(),
        })

        // ── Step 2: Update tank level ─────────────────────────────────────────
        if (tankId) {
          const tankRef  = db.collection('tanks').doc(tankId)
          const tankSnap = await tx.get(tankRef)

          if (tankSnap.exists) {
            const tank     = tankSnap.data() as Record<string, unknown>
            const capacity = Math.max((tank.capacityGallons as number) || 500, 1)
            const current  = (tank.currentLevelPct  as number) ?? 0
            newLevelPct    = Math.min(100, current + (quantityDelivered / capacity) * 100)

            tx.update(tankRef, {
              currentLevelPct: newLevelPct,
              lastFilledAt:    FieldValue.serverTimestamp(),
              updatedAt:       FieldValue.serverTimestamp(),
            })
          }
        }
      })

      console.log(`onDeliveryComplete [${orderId}]: order + tank updated in transaction`)
    } catch (err) {
      console.error(`onDeliveryComplete [${orderId}]: transaction failed —`, err)
      throw err // re-throw: Functions will retry
    }

    if (afterStatus === 'completed' && (orderData?.deliveryStatus as string | undefined) !== 'signed') {
      await appendStatusHistory(
        db,
        orderId,
        'ready_to_invoice',
        'system:onDeliveryComplete',
        'Delivery Completion Trigger',
        'Stop marked completed and moved to ready_to_invoice.',
      )
    }

    // ── Step 2b: Clear pending low-level alerts ───────────────────────────────
    if (tankId && newLevelPct > LOW_LEVEL_THRESHOLD_PCT) {
      try {
        const alertsSnap = await db
          .collection('notifications')
          .where('entityId', '==', tankId)
          .where('type',     '==', 'low_tank_level')
          .where('read',     '==', false)
          .get()

        if (!alertsSnap.empty) {
          const batch = db.batch()
          alertsSnap.docs.forEach((d) => batch.update(d.ref, { read: true }))
          await batch.commit()
          console.log(`onDeliveryComplete [${orderId}]: cleared ${alertsSnap.size} low-level alert(s)`)
        }
      } catch (err) {
        console.error(`onDeliveryComplete [${orderId}]: failed to clear alerts —`, err)
      }
    }

    // ── Fetch customer record (needed for steps 3-5) ──────────────────────────
    if (customerId) {
      try {
        const snap = await db.collection('customers').doc(customerId).get()
        customerData = snap.exists ? (snap.data() as Record<string, unknown>) : null
      } catch (err) {
        console.error(`onDeliveryComplete [${orderId}]: failed to fetch customer —`, err)
      }
    }

    // ── Step 3: Generate invoice ──────────────────────────────────────────────
    let invoiceId:     string | undefined
    let invoiceNumber: string | undefined
    let totalAmount:   number | undefined

    try {
      // Idempotency guard: don't create duplicate invoices
      const existingSnap = await db
        .collection('invoices')
        .where('orderId', '==', orderId)
        .limit(1)
        .get()

      if (!existingSnap.empty) {
        invoiceId     = existingSnap.docs[0].id
        invoiceNumber = existingSnap.docs[0].data().invoiceNumber as string
        totalAmount   = existingSnap.docs[0].data().totalAmount   as number
        console.log(`onDeliveryComplete [${orderId}]: invoice already exists (${invoiceId})`)
      } else {
        // Determine if this is the first delivery for the tank (for rental note)
        let isFirstDelivery = false
        if (tankId) {
          const prevSnap = await db
            .collection('orders')
            .where('tankId', '==', tankId)
            .where('status', '==', 'delivered')
            .get()
          // size includes the current order (already marked delivered in transaction)
          isFirstDelivery = prevSnap.size <= 1
        }

        const unitPrice    = (orderData!.unitPrice    as number) ?? 0
        const deliveryTier = (orderData!.deliveryTier as string) ?? 'standard'
        const upchargeRate = DELIVERY_TIER_UPCHARGE[deliveryTier] ?? 0

        const productSubtotal = unitPrice * quantityDelivered
        const upchargeAmount  = productSubtotal * upchargeRate
        const subtotal        = productSubtotal + upchargeAmount + TANK_RENTAL_MONTHLY_FEE + FLAT_DELIVERY_FEE
        const taxAmount       = subtotal * TAX_RATE
        totalAmount           = subtotal + taxAmount
        invoiceNumber         = `INV-${Date.now().toString().slice(-8)}`

        const dueAt = new Date()
        dueAt.setDate(dueAt.getDate() + 30)

        const lineItems = [
          {
            description: `Gas delivery — ${quantityDelivered.toFixed(1)} gal @ $${unitPrice.toFixed(2)}/gal`,
            quantity:    quantityDelivered,
            unitPrice,
            total:       productSubtotal,
          },
          ...(upchargeAmount > 0
            ? [{
                description: `${deliveryTier.charAt(0).toUpperCase()}${deliveryTier.slice(1)} delivery upcharge (${(upchargeRate * 100).toFixed(0)}%)`,
                quantity:    1,
                unitPrice:   upchargeAmount,
                total:       upchargeAmount,
              }]
            : []),
          {
            description: `Tank rental${isFirstDelivery ? ' (first month)' : ''}`,
            quantity:    1,
            unitPrice:   TANK_RENTAL_MONTHLY_FEE,
            total:       TANK_RENTAL_MONTHLY_FEE,
          },
          {
            description: 'Flat delivery fee',
            quantity:    1,
            unitPrice:   FLAT_DELIVERY_FEE,
            total:       FLAT_DELIVERY_FEE,
          },
        ]

        const invoiceRef = db.collection('invoices').doc()
        await invoiceRef.set({
          orderId,
          customerId:   customerId ?? null,
          tankId:       tankId     ?? null,
          invoiceNumber,
          status:       'pending',
          lineItems,
          subtotal,
          taxRate:      TAX_RATE,
          taxAmount,
          totalAmount,
          deliveryTier,
          issuedAt:     FieldValue.serverTimestamp(),
          dueAt,
          createdAt:    FieldValue.serverTimestamp(),
          updatedAt:    FieldValue.serverTimestamp(),
        })

        invoiceId = invoiceRef.id
        console.log(`onDeliveryComplete [${orderId}]: invoice ${invoiceId} (${invoiceNumber}) created — $${totalAmount.toFixed(2)}`)
      }
    } catch (err) {
      console.error(`onDeliveryComplete [${orderId}]: invoice generation failed —`, err)
    }

    // ── Step 3b: Generate PDF ───────────────────────────────────────────────────
    if (invoiceId) {
      try {
        await generateInvoicePdf(invoiceId)
        console.log(`onDeliveryComplete [${orderId}]: PDF generated for invoice ${invoiceId}`)
      } catch (err) {
        console.error(`onDeliveryComplete [${orderId}]: PDF generation failed —`, err)
      }
    }

    // ── Step 4: Autopay or invoice email ──────────────────────────────────────
    if (invoiceId && invoiceNumber && totalAmount !== undefined && customerData) {
      try {
        const hasAutopay =
          customerData.autopayEnabled === true &&
          typeof customerData.stripeCustomerId === 'string' &&
          customerData.stripeCustomerId !== ''

        if (hasAutopay) {
          // ── Autopay: confirm PaymentIntent off-session ──────────────────────
          const stripeKey   = requireSecret(STRIPE_SECRET_KEY.value(), 'STRIPE_SECRET_KEY')
          const stripe      = new Stripe(stripeKey)
          const amountCents = Math.round(totalAmount * 100)

          const pi = await stripe.paymentIntents.create({
            amount:         amountCents,
            currency:       'usd',
            customer:       customerData.stripeCustomerId as string,
            payment_method: customerData.stripeDefaultPaymentMethodId as string | undefined,
            confirm:        true,
            off_session:    true,
            description:    `Autopay — Invoice ${invoiceNumber}`,
            metadata: {
              invoiceId,
              customerId:    customerId  ?? '',
              invoiceNumber,
              orderId,
            },
          })

          if (pi.status === 'succeeded') {
            const batch = db.batch()
            batch.update(db.collection('invoices').doc(invoiceId), {
              status:    'paid',
              paidAt:    FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            })
            batch.set(db.collection('payments').doc(), {
              invoiceId,
              customerId: customerId ?? null,
              orderId,
              amount:                totalAmount,
              currency:              'USD',
              stripePaymentIntentId: pi.id,
              method:                'autopay',
              status:                'succeeded',
              createdAt:             FieldValue.serverTimestamp(),
            })
            await batch.commit()
            console.log(`onDeliveryComplete [${orderId}]: autopay succeeded (${pi.id})`)
          } else {
            console.warn(`onDeliveryComplete [${orderId}]: autopay PI ${pi.id} status=${pi.status}`)
          }

        } else if (customerData.email) {
          // ── No autopay: send invoice email with pay link ──────────────────
          const dueDateStr = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()
          await sendEmail({
            to:      customerData.email as string,
            subject: `Invoice #${invoiceNumber} — OGS Portal`,
            html: `
              <h2>Invoice Ready — OGS Portal</h2>
              <p>Hi ${customerData.name as string},</p>
              <p>Your delivery has been completed. Invoice
              <strong>#${invoiceNumber}</strong> for
              <strong>$${totalAmount.toFixed(2)}</strong> is now ready.</p>
              <p><strong>Due:</strong> ${dueDateStr}</p>
              <p style="margin-top:24px">
                <a href="https://app.ohiogassupply.com/portal/invoices"
                   style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">
                  Pay Now →
                </a>
              </p>
              <p style="margin-top:24px;color:#666;font-size:12px">— The OGS Portal Team</p>
            `,
          })
          console.log(`onDeliveryComplete [${orderId}]: invoice email sent to ${customerData.email as string}`)
        }
      } catch (err) {
        console.error(`onDeliveryComplete [${orderId}]: autopay/invoice email failed —`, err)
      }
    }

    // ── Step 5: Delivery confirmation email ───────────────────────────────────
    if (customerData?.email) {
      try {
        const tankLine = tankId && newLevelPct > 0
          ? `<p>Your tank is now at approximately <strong>${Math.round(newLevelPct)}%</strong> capacity.</p>`
          : ''

        await sendEmail({
          to:      customerData.email as string,
          subject: 'Delivery Complete — OGS Portal',
          html: `
            <h2>Your Delivery is Complete</h2>
            <p>Hi ${customerData.name as string},</p>
            <p>Your gas delivery of <strong>${quantityDelivered.toFixed(1)} gallons</strong>
            has been completed successfully.</p>
            ${tankLine}
            <p>Thank you for choosing OGS Portal.</p>
            <p style="color:#666;font-size:12px">— The OGS Portal Team</p>
          `,
        })
        console.log(`onDeliveryComplete [${orderId}]: confirmation email sent`)
      } catch (err) {
        console.error(`onDeliveryComplete [${orderId}]: confirmation email failed —`, err)
      }
    }

    // ── Step 6: In-app notification for dispatch ──────────────────────────────
    const orderNum = (orderData!.orderNumber as string | undefined) ?? orderId
    await createNotification({
      userId:   null,
      role:     'dispatch',
      type:     'delivery_complete',
      title:    'Delivery Complete',
      body:     `Order ${orderNum} delivered — ${quantityDelivered.toFixed(1)} gal.`,
      entityId: orderId,
    })
    console.log(`onDeliveryComplete [${orderId}]: dispatch notification created`)

    // ── Run completion check ──────────────────────────────────────────────────
    // Mark run complete when every stop is in a terminal state.
    try {
      const stopsSnap   = await db.collection(`runs/${runId}/stops`).get()
      const terminalStates = new Set(['delivered', 'completed', 'skipped', 'failed'])
      const allTerminal = stopsSnap.docs.every((d) =>
        terminalStates.has(d.data().status as string),
      )

      if (allTerminal) {
        await db.collection('runs').doc(runId).update({
          status:      'completed',
          completedAt: FieldValue.serverTimestamp(),
          updatedAt:   FieldValue.serverTimestamp(),
        })
        console.log(`onDeliveryComplete [${orderId}]: run ${runId} marked complete`)
      }
    } catch (err) {
      console.error(`onDeliveryComplete [${orderId}]: run completion check failed —`, err)
    }

    console.log(`onDeliveryComplete [${orderId}]: all steps complete`)
  },
)
