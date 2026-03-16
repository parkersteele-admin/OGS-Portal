/**
 * functions/src/orders.ts
 *
 * onOrderComplete    — Firestore trigger: fires when an order status → 'completed'
 * onDeliveryComplete — Firestore trigger: fires when a RunStop status → 'completed'
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { db, FieldValue } from './admin'
import { SENDGRID_API_KEY } from './config'
import { sendTemplateEmail } from './email/sendEmail'
import { TEMPLATE_ORDER_CONFIRMATION } from './email/templates'

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

    await sendTemplateEmail(customer.email as string, TEMPLATE_ORDER_CONFIRMATION, {
      customerName:  customer.name    as string,
      orderNumber:   after.orderNumber as string,
      product:       'Gas delivery',
      quantity:      after.gallons    as number,
      deliveryTier:  after.deliveryTier as string ?? 'standard',
      estimatedDate: after.scheduledAt
        ? new Date((after.scheduledAt as { toDate(): Date }).toDate()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : 'TBD',
      total: `$${((after.gallons as number) * (after.unitPrice as number) * 1.08).toFixed(2)}`,
    })
  },
)

// onDeliveryComplete has been promoted to functions/src/triggers/onDeliveryComplete.ts
// with the full business-logic implementation (tank level, invoice, autopay, emails, notifications).
