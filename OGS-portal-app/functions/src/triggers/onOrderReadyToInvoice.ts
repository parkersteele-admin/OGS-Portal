import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { db, FieldValue } from '../admin'
import { sendEmail } from '../email/sendEmail'

export const onOrderReadyToInvoice = onDocumentUpdated(
  {
    document: 'orders/{orderId}',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    const before = event.data?.before.data()
    const after = event.data?.after.data()
    if (!after) return

    const beforeStatus = before?.status as string | undefined
    const afterStatus = after.status as string | undefined
    if (beforeStatus === 'ready_to_invoice' || afterStatus !== 'ready_to_invoice') {
      return
    }

    const orderId = event.params.orderId
    const order = after as Record<string, unknown>
    const customerId = order.customerId as string | undefined

    const [customerSnap, adminsSnap] = await Promise.all([
      customerId ? db.collection('customers').doc(customerId).get() : Promise.resolve(null),
      db.collection('users').where('role', '==', 'admin').where('active', '==', true).get(),
    ])

    const customer = customerSnap?.exists ? (customerSnap.data() as Record<string, unknown>) : null
    const adminRecipients = adminsSnap.docs
      .map((d) => d.data().email as string | undefined)
      .filter((email): email is string => typeof email === 'string' && email.length > 0)

    if (adminRecipients.length === 0) {
      await db.collection('emailLogs').add({
        source: 'onOrderReadyToInvoice',
        orderId,
        status: 'failed',
        to: 'admin-role-group',
        subject: '[OGS] Invoice Ready — no active admins found',
        error: 'No active admin recipients',
        createdAt: FieldValue.serverTimestamp(),
      })
      return
    }

    const deliveredAtDate = toDate(order.deliveredAt) ?? new Date()
    const deliveredAtDisplay = deliveredAtDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

    const customerName =
      (customer?.name as string | undefined)
      || (order.customerName as string | undefined)
      || 'Customer'
    const subject = `[OGS] Invoice Ready — ${customerName} — ${deliveredAtDisplay}`

    const orderLineItems = normalizeLineItems(order)
    const productMap = await loadProductNames(orderLineItems.map((item) => item.productId))

    const linesHtml = orderLineItems
      .map((item) => {
        const unitPrice = item.unitPrice
        const amount = Number((item.qty * unitPrice).toFixed(2))
        return `<tr>
          <td style="padding:8px;border-bottom:1px solid #e5e5e5">${escapeHtml(productMap.get(item.productId) || item.productId)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e5e5;text-align:right">${item.qty}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e5e5;text-align:right">$${unitPrice.toFixed(2)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e5e5;text-align:right">$${amount.toFixed(2)}</td>
        </tr>`
      })
      .join('')

    const subtotal = toNumber(order.subtotal)
    const deliveryFee = toNumber(order.deliveryFee)
    const salesTax = toNumber(order.salesTaxAmount, order.taxAmount)
    const total = toNumber(order.total)

    const addressLine = customer
      ? `${String(customer.address ?? '')}, ${String(customer.city ?? '')}, ${String(customer.state ?? '')} ${String(customer.zip ?? '')}`.replace(/\s+,/g, ',').trim()
      : 'Not provided'
    const contactName = (order.deliveryContactName as string | undefined) || (customer?.name as string | undefined) || '—'
    const contactPhone = (order.deliveryContactPhone as string | undefined) || (customer?.phone as string | undefined) || '—'
    const contactEmail = (order.deliveryContactEmail as string | undefined) || (customer?.email as string | undefined) || '—'
    const quoteNumber = (order.quoteNumber as string | undefined) || '—'
    const salesRepName = (order.salesRepName as string | undefined) || '—'

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:860px;margin:auto;color:#1f2937;line-height:1.45">
        <div style="background:#111827;color:#ffffff;padding:20px 24px;border-top:4px solid #E87722">
          <div style="font-size:14px;letter-spacing:0.4px;text-transform:uppercase;opacity:0.9">Ohio Gas Supply</div>
          <h1 style="margin:8px 0 0;font-size:22px">Invoice Ready for Creation</h1>
        </div>

        <div style="padding:20px 24px;border:1px solid #e5e7eb;border-top:none;background:#ffffff">
          <h2 style="margin:0 0 10px;font-size:16px;color:#111827">Section 1 — Customer</h2>
          <p style="margin:0 0 4px"><strong>Name:</strong> ${escapeHtml(customerName)}</p>
          <p style="margin:0 0 4px"><strong>Delivery Address:</strong> ${escapeHtml(addressLine || 'Not provided')}</p>
          <p style="margin:0 0 4px"><strong>Contact Name:</strong> ${escapeHtml(contactName)}</p>
          <p style="margin:0 0 4px"><strong>Phone:</strong> ${escapeHtml(contactPhone)}</p>
          <p style="margin:0"><strong>Email:</strong> ${escapeHtml(contactEmail)}</p>

          <h2 style="margin:20px 0 10px;font-size:16px;color:#111827">Section 2 — Order Summary</h2>
          <p style="margin:0 0 4px"><strong>Order ID:</strong> ${escapeHtml(orderId)}</p>
          <p style="margin:0 0 4px"><strong>Quote Number:</strong> ${escapeHtml(quoteNumber)}</p>
          <p style="margin:0 0 10px"><strong>Sales Rep:</strong> ${escapeHtml(salesRepName)}</p>

          <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb">
            <thead style="background:#f9fafb">
              <tr>
                <th style="padding:8px;text-align:left">Product</th>
                <th style="padding:8px;text-align:right">Qty Delivered</th>
                <th style="padding:8px;text-align:right">Unit Price</th>
                <th style="padding:8px;text-align:right">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${linesHtml}
            </tbody>
          </table>

          <div style="margin-top:12px;text-align:right">
            <p style="margin:2px 0"><strong>Subtotal:</strong> $${subtotal.toFixed(2)}</p>
            <p style="margin:2px 0"><strong>Delivery Fee:</strong> $${deliveryFee.toFixed(2)}</p>
            <p style="margin:2px 0"><strong>Sales Tax:</strong> $${salesTax.toFixed(2)}</p>
            <p style="margin:6px 0 0;font-size:18px"><strong>TOTAL:</strong> $${total.toFixed(2)}</p>
          </div>

          <h2 style="margin:20px 0 10px;font-size:16px;color:#111827">Section 3 — Action Required</h2>
          <p style="margin:0 0 8px">Please create an invoice in QuickBooks for the above order and update the order status to Invoice Sent in the OGS Portal.</p>
          <p style="margin:0 0 16px"><a href="https://app.ohiogassupply.com/orders/${encodeURIComponent(orderId)}" style="color:#005eb8;text-decoration:underline">https://app.ohiogassupply.com/orders/${escapeHtml(orderId)}</a></p>

          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0" />
          <p style="margin:0;color:#6b7280;font-size:12px">Sent ${new Date().toLocaleString('en-US')}</p>
          <p style="margin:4px 0 0;color:#6b7280;font-size:12px">Do not reply to this email.</p>
        </div>
      </div>
    `

    let sentCount = 0
    for (const email of adminRecipients) {
      try {
        await sendEmail({
          to: email,
          from: 'noreply@ohiogassupply.com',
          subject,
          html,
        })
        sentCount += 1
      } catch (err) {
        console.error(`onOrderReadyToInvoice: failed to send to ${email} —`, err)
      }
    }

    await db.collection('emailLogs').add({
      source: 'onOrderReadyToInvoice',
      orderId,
      to: 'admin-role-group',
      recipients: adminRecipients,
      sentCount,
      status: sentCount > 0 ? 'sent' : 'failed',
      subject,
      createdAt: FieldValue.serverTimestamp(),
      sentAt: FieldValue.serverTimestamp(),
    })
  },
)

function toNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function toDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null
  const maybeTs = value as { toDate?: () => Date }
  if (typeof maybeTs.toDate === 'function') {
    return maybeTs.toDate()
  }
  return null
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeLineItems(order: Record<string, unknown>) {
  const quotedByProduct = new Map<string, number>()
  const quoted = Array.isArray(order.quotedLineItems)
    ? (order.quotedLineItems as Array<Record<string, unknown>>)
    : []
  for (const item of quoted) {
    const productId = item.productId as string | undefined
    const unitPrice = toNumber(item.unitPrice)
    if (productId && unitPrice > 0) quotedByProduct.set(productId, unitPrice)
  }

  const addOns = Array.isArray(order.addOns)
    ? (order.addOns as Array<Record<string, unknown>>)
    : []
  for (const item of addOns) {
    const productId = item.productId as string | undefined
    const unitPrice = toNumber(item.unitPrice)
    if (productId && unitPrice > 0) quotedByProduct.set(productId, unitPrice)
  }

  const primaryUnitPrice = toNumber(order.unitPrice)
  const primaryItems = Array.isArray(order.deliveredLineItems)
    ? (order.deliveredLineItems as Array<Record<string, unknown>>)
    : []
  const normalizedPrimary = primaryItems.map((item) => ({
    productId: String(item.productId ?? ''),
    qty: toNumber(item.qty),
    unitPrice: toNumber(quotedByProduct.get(String(item.productId ?? '')), primaryUnitPrice),
  }))

  const addOnItems = Array.isArray(order.deliveredAddOns)
    ? (order.deliveredAddOns as Array<Record<string, unknown>>)
    : []
  const normalizedAddOns = addOnItems.map((item) => ({
    productId: String(item.productId ?? ''),
    qty: toNumber(item.qty),
    unitPrice: toNumber(quotedByProduct.get(String(item.productId ?? '')), primaryUnitPrice),
  }))

  const all = [...normalizedPrimary, ...normalizedAddOns].filter((item) => item.productId && item.qty >= 0)
  if (all.length > 0) return all

  const fallbackProductId = order.productId as string | undefined
  if (!fallbackProductId) return []
  return [{
    productId: fallbackProductId,
    qty: toNumber(order.quantity),
    unitPrice: primaryUnitPrice,
  }]
}

async function loadProductNames(productIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(productIds)].filter(Boolean)
  const docs = await Promise.all(unique.map(async (productId) => {
    const snap = await db.collection('products').doc(productId).get()
    const data = snap.data() as Record<string, unknown> | undefined
    return [productId, (data?.name as string | undefined) || productId] as const
  }))
  return new Map(docs)
}
