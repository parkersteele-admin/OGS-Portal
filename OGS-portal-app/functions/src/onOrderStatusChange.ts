/**
 * functions/src/onOrderStatusChange.ts
 *
 * Firestore trigger — fires on any update to orders/{orderId}.
 * Handles status-based side effects.
 *
 * Delivery receipt: when status → 'delivered', sends an order summary email to
 * the customer (and admins). Skips if deliveryConfirmationEmailSentAt is already
 * set, which means adminFinalizeDelivery or finalizeSignedDelivery already sent it.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'
import { db, FieldValue } from './admin'
import { sendEmail } from './email/sendEmail'

export const onOrderStatusChange = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data?.before.data()
  const after  = event.data?.after.data()

  if (!before || !after) return
  if (before.status === after.status) return

  const orderId = event.params.orderId

  logger.info('onOrderStatusChange', {
    orderId,
    from: before.status,
    to: after.status,
    orderType: after.orderType,
  })

  // ── Delivery receipt ────────────────────────────────────────────────────────
  if (after.status === 'delivered' && !after.deliveryConfirmationEmailSentAt) {
    try {
      await sendDeliveryReceipt(orderId, after)
    } catch (err) {
      logger.error('onOrderStatusChange: delivery receipt failed', { orderId, err })
    }
  }
})

async function sendDeliveryReceipt(
  orderId: string,
  order: Record<string, unknown>,
): Promise<void> {
  const customerId = order.customerId as string | undefined
  if (!customerId) return

  const customerSnap = await db.collection('customers').doc(customerId).get()
  if (!customerSnap.exists) return
  const customer = customerSnap.data() as Record<string, unknown>

  const customerEmail = customer.email as string | undefined
  if (!customerEmail) return

  const deliveredAt = new Date()
  const deliveryDate = deliveredAt.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  const lineItemsHtml = buildBomHtml(order)

  const subtotal   = formatCurrency(order.subtotal as number | undefined)
  const delivFee   = formatCurrency(order.deliveryFee as number | undefined)
  const taxAmount  = formatCurrency((order.salesTaxAmount ?? order.taxAmount) as number | undefined)
  const total      = formatCurrency(order.total as number | undefined)
  const showTax    = ((order.salesTaxAmount ?? order.taxAmount) as number | undefined ?? 0) > 0

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#222">
      <div style="background:#111;padding:22px 28px;border-top:4px solid #E87722">
        <h1 style="margin:0;color:#fff;font-size:22px">Delivery Confirmed</h1>
        <p style="margin:8px 0 0;color:#d4d4d4;font-size:13px">
          ${customer.name as string} &middot; ${deliveryDate}
        </p>
      </div>
      <div style="padding:24px 28px;border:1px solid #e5e5e5;border-top:none">
        <p style="margin:0 0 16px">Your order has been delivered. Below is a summary for your records.</p>
        ${lineItemsHtml}
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr>
            <td style="padding:6px 0;color:#555">Subtotal</td>
            <td style="padding:6px 0;text-align:right">${subtotal}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#555">Delivery fee</td>
            <td style="padding:6px 0;text-align:right">${delivFee}</td>
          </tr>
          ${showTax ? `<tr>
            <td style="padding:6px 0;color:#555">Sales tax</td>
            <td style="padding:6px 0;text-align:right">${taxAmount}</td>
          </tr>` : ''}
          <tr style="border-top:2px solid #222;font-weight:700">
            <td style="padding:10px 0 6px">Total</td>
            <td style="padding:10px 0 6px;text-align:right">${total}</td>
          </tr>
        </table>
        <p style="margin:18px 0 0;color:#666;font-size:12px">Ohio Gas Supply</p>
      </div>
    </div>
  `

  await sendEmail({
    to:      customerEmail,
    subject: `Delivery Confirmed — ${deliveryDate}`,
    html,
  })

  await db.collection('orders').doc(orderId).update({
    deliveryConfirmationEmailSentAt: FieldValue.serverTimestamp(),
    deliveryConfirmationRecipients: [customerEmail],
  })

  logger.info('onOrderStatusChange: delivery receipt sent', { orderId, to: customerEmail })
}

function buildBomHtml(order: Record<string, unknown>): string {
  type LineItem = { description?: string; productId?: string; quantity?: number; qty?: number; unitPrice?: number; amount?: number }
  const items = (order.quotedLineItems as LineItem[] | undefined) ?? []

  if (items.length === 0) {
    const qty = (order.quantity as number | undefined) ?? 0
    const price = (order.unitPrice as number | undefined) ?? 0
    const productId = (order.productId as string | undefined) ?? 'Product'
    return `
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#faf5ef">
            <th style="padding:8px 10px;text-align:left;color:#555">Item</th>
            <th style="padding:8px 10px;text-align:right;color:#555">Qty</th>
            <th style="padding:8px 10px;text-align:right;color:#555">Unit Price</th>
            <th style="padding:8px 10px;text-align:right;color:#555">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #eee">${productId}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${qty}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(price)}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(qty * price)}</td>
          </tr>
        </tbody>
      </table>`
  }

  const rows = items.map((item) => {
    const qty    = item.quantity ?? item.qty ?? 0
    const price  = item.unitPrice ?? 0
    const amount = item.amount ?? qty * price
    return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee">${item.description ?? item.productId ?? ''}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${qty}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(price)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(amount)}</td>
      </tr>`
  }).join('')

  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead>
        <tr style="background:#faf5ef">
          <th style="padding:8px 10px;text-align:left;color:#555">Item</th>
          <th style="padding:8px 10px;text-align:right;color:#555">Qty</th>
          <th style="padding:8px 10px;text-align:right;color:#555">Unit Price</th>
          <th style="padding:8px 10px;text-align:right;color:#555">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`
}

function formatCurrency(value: number | undefined): string {
  return `$${(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
