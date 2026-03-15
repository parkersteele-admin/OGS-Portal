/**
 * functions/src/orders.ts
 *
 * onOrderComplete    — Firestore trigger: fires when an order status → 'completed'
 * onDeliveryComplete — Firestore trigger: fires when a RunStop status → 'completed'
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { db, FieldValue } from './admin'
import { SENDGRID_API_KEY } from './config'
import { sendEmail, orderConfirmationHtml } from './mail'

// ── onOrderComplete ───────────────────────────────────────────────────────────

/**
 * Triggered when an order document transitions to status = 'completed'.
 *
 * Actions:
 *  1. Create a draft invoice for the order.
 *  2. Send an order-completion confirmation email to the customer.
 */
export const onOrderComplete = onDocumentUpdated(
  { document: 'orders/{orderId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()

    // Only react to the specific transition to 'completed'
    if (!after || before?.status === 'completed' || after.status !== 'completed') {
      return
    }

    const orderId = event.params.orderId

    // ── 1. Generate draft invoice ───────────────────────────────────────────
    // Check that an invoice doesn't already exist for this order
    const existingInvoice = await db
      .collection('invoices')
      .where('orderId', '==', orderId)
      .limit(1)
      .get()

    if (existingInvoice.empty) {
      const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`
      const subtotal      = (after.gallons as number) * (after.unitPrice as number)
      const taxRate       = 0.08
      const taxAmount     = subtotal * taxRate
      const totalAmount   = subtotal + taxAmount

      // dueAt = 30 days from now
      const dueAt = new Date()
      dueAt.setDate(dueAt.getDate() + 30)

      await db.collection('invoices').add({
        orderId,
        customerId:    after.customerId,
        invoiceNumber,
        status:        'draft',
        lineItems:     [
          {
            description: `Gas delivery — ${after.gallons as number} gal`,
            quantity:    after.gallons,
            unitPrice:   after.unitPrice,
            total:       subtotal,
          },
        ],
        subtotal,
        taxRate,
        taxAmount,
        totalAmount,
        issuedAt:      FieldValue.serverTimestamp(),
        dueAt,
        createdAt:     FieldValue.serverTimestamp(),
        updatedAt:     FieldValue.serverTimestamp(),
      })
    }

    // ── 2. Send confirmation email ──────────────────────────────────────────
    if (!after.customerId) return

    const customerSnap = await db.collection('customers').doc(after.customerId as string).get()
    if (!customerSnap.exists) return

    const customer = customerSnap.data()!
    if (!customer.email) return

    await sendEmail({
      to:      customer.email as string,
      subject: `Order Confirmed – ${after.orderNumber as string}`,
      html:    orderConfirmationHtml({
        customerName: customer.name  as string,
        orderNumber:  after.orderNumber as string,
        gallons:      after.gallons   as number,
        scheduledAt:  after.scheduledAt
          ? new Date((after.scheduledAt as { toDate(): Date }).toDate()).toLocaleDateString()
          : 'TBD',
      }),
    })
  },
)

// ── onDeliveryComplete ────────────────────────────────────────────────────────

/**
 * Triggered when a RunStop document transitions to status = 'completed'.
 *
 * Actions:
 *  1. Mark the linked order as 'completed'.
 *  2. If all stops in the run are now complete, mark the run 'completed'.
 */
export const onDeliveryComplete = onDocumentUpdated(
  'runs/{runId}/stops/{stopId}',
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()

    if (!after || before?.status === 'completed' || after.status !== 'completed') {
      return
    }

    const { runId } = event.params

    // ── 1. Complete the linked order ────────────────────────────────────────
    if (after.orderId) {
      await db.collection('orders').doc(after.orderId as string).update({
        status:      'completed',
        completedAt: FieldValue.serverTimestamp(),
        updatedAt:   FieldValue.serverTimestamp(),
      })
    }

    // ── 2. Check if all run stops are now complete ──────────────────────────
    const stopsSnap = await db.collection(`runs/${runId}/stops`).get()
    const allDone   = stopsSnap.docs.every((d) => d.data().status === 'completed')

    if (allDone) {
      await db.collection('runs').doc(runId).update({
        status:      'completed',
        completedAt: FieldValue.serverTimestamp(),
        updatedAt:   FieldValue.serverTimestamp(),
      })
    }
  },
)
