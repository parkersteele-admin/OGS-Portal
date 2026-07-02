import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, FieldValue, storage, Timestamp } from '../admin'
import { sendEmail, type MailAttachment } from '../email/sendEmail'
import { generateInvoicePdf } from '../pdf/generateInvoicePdf'
import { generateBillOfLadingPdf } from '../pdf/generateBillOfLadingPdf'
import { getCompanySettings } from '../pdf/companySettings'
import { registerGeneratedFile } from '../files/registerGeneratedFile'
import { appendStatusHistory } from '../lib/orderStatus'

interface AdminFinalizeDeliveryInput {
  runId: string
  stopId: string
  qtyDelivered: number
  receivedByName: string
  signatureDataUrl: string
  deliveryNotes?: string
  deliveredLineItems: Array<{ productId: string; qty: number }>
  deliveredAddOns?: Array<{ productId: string; qty: number }>
}

interface ProductSnapshot {
  id: string
  name: string
  unit: string
  basePrice?: number
  pricePerUnit?: number
}

interface InvoiceRecord {
  id: string
  pdfUrl?: string
  invoiceNumber?: string
}

const DEFAULT_SALES_TAX_RATE = 0.08

export const adminFinalizeDelivery = onCall(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.')
    }

    const role = request.auth.token.role as string | undefined
    if (role !== 'admin' && role !== 'dispatch') {
      throw new HttpsError('permission-denied', 'Only admin or dispatch users can finalize deliveries.')
    }

    const data = request.data as Partial<AdminFinalizeDeliveryInput>
    if (!data.runId || !data.stopId || typeof data.qtyDelivered !== 'number' || !data.signatureDataUrl || !data.receivedByName?.trim()) {
      throw new HttpsError('invalid-argument', 'runId, stopId, qtyDelivered, receivedByName, and signatureDataUrl are required.')
    }
    if (!Array.isArray(data.deliveredLineItems) || data.deliveredLineItems.length === 0) {
      throw new HttpsError('invalid-argument', 'At least one delivered line item is required.')
    }

    const runRef = db.collection('runs').doc(data.runId)
    const stopRef = runRef.collection('stops').doc(data.stopId)
    const [runSnap, stopSnap, userSnap] = await Promise.all([
      runRef.get(),
      stopRef.get(),
      db.collection('users').doc(request.auth.uid).get(),
    ])

    if (!runSnap.exists || !stopSnap.exists) {
      throw new HttpsError('not-found', 'Run stop not found.')
    }

    const stop = stopSnap.data() as Record<string, unknown>

    const orderId = stop.orderId as string | undefined
    const customerId = stop.customerId as string | undefined
    if (!orderId || !customerId) {
      throw new HttpsError('failed-precondition', 'Stop is missing order or customer information.')
    }

    const [orderSnap, customerSnap] = await Promise.all([
      db.collection('orders').doc(orderId).get(),
      db.collection('customers').doc(customerId).get(),
    ])

    if (!orderSnap.exists || !customerSnap.exists) {
      throw new HttpsError('not-found', 'Related order or customer record not found.')
    }

    const order = orderSnap.data() as Record<string, unknown>
    const customer = customerSnap.data() as Record<string, unknown>
    const actorName = (userSnap.data()?.name as string | undefined) || (request.auth.token.name as string | undefined) || 'Operations User'
    const receivedByName = data.receivedByName.trim()
    const deliveryDate = new Date()

    const productIds = new Set<string>()
    for (const item of data.deliveredLineItems) productIds.add(item.productId)
    for (const item of data.deliveredAddOns ?? []) productIds.add(item.productId)

    const productDocs = await Promise.all([...productIds].map(async (productId) => {
      const snap = await db.collection('products').doc(productId).get()
      const docData = snap.data() as Record<string, unknown> | undefined
      return [
        productId,
        {
          id: productId,
          name: (docData?.name as string | undefined) || productId,
          unit: (docData?.unit as string | undefined) || 'unit',
          basePrice: docData?.basePrice as number | undefined,
          pricePerUnit: docData?.pricePerUnit as number | undefined,
        } satisfies ProductSnapshot,
      ] as const
    }))
    const productMap = new Map(productDocs)

    const signature = parseDataUrl(data.signatureDataUrl)
    if (!signature) {
      throw new HttpsError('invalid-argument', 'Signature payload is not a valid PNG data URL.')
    }

    const signatureUpload = await uploadOrderAsset({
      orderId,
      fileName: `signature-${data.stopId}.png`,
      contentType: signature.contentType,
      buffer: signature.buffer,
      folder: 'signature',
    })

    await registerGeneratedFile({
      targets: [
        { entityType: 'order', entityId: orderId },
        { entityType: 'customer', entityId: customerId },
      ],
      fileType: 'signature',
      url: signatureUpload.url,
      storagePath: signatureUpload.storagePath,
      fileName: `signature-${data.stopId}.png`,
      mimeType: signature.contentType,
      sizeBytes: signature.buffer.length,
      metadata: {
        linkedEntityType: 'order',
        linkedEntityId: orderId,
        runId: data.runId,
        stopId: data.stopId,
        receivedByName,
      },
    })

    let invoice = await findInvoiceForOrder(orderId)
    if (!invoice) {
      invoice = await createInvoiceForDelivery({
        orderId,
        customerId,
        deliveryDate,
        primaryItems: data.deliveredLineItems,
        addOnItems: data.deliveredAddOns ?? [],
        order,
        productMap,
      })
    }

    const invoicePdfUrl = invoice.pdfUrl || await generateInvoicePdf(invoice.id)

    const bolItems = [
      ...data.deliveredLineItems.map((item) => {
        const product = productMap.get(item.productId)
        return {
          description: product?.name || item.productId,
          quantity: item.qty,
          unit: product?.unit || 'unit',
        }
      }),
      ...(data.deliveredAddOns ?? []).map((item) => {
        const product = productMap.get(item.productId)
        return {
          description: product?.name || item.productId,
          quantity: item.qty,
          unit: product?.unit || 'unit',
        }
      }),
    ]

    const billOfLading = typeof order.billOfLadingUrl === 'string' && order.billOfLadingUrl
      ? {
          url: order.billOfLadingUrl as string,
          fileName: `Bill-of-Lading-${deliveryDate.toISOString().slice(0, 10)}.pdf`,
          storagePath: `ogs-portal/customers/${customerId}/documents/bill-of-lading/${deliveryDate.toISOString().slice(0, 10)}.pdf`,
          buffer: await downloadBuffer(order.billOfLadingUrl as string),
        }
      : await generateBillOfLadingPdf({
          orderId,
          customerId,
          customerName: (customer.name as string | undefined) || 'Customer',
          customerAddress: [
            customer.address as string,
            [customer.city, customer.state, customer.zip].filter(Boolean).join(', '),
          ],
          driverName: actorName,
          date: deliveryDate,
          items: bolItems,
        })

    if (billOfLading.storagePath) {
      await registerGeneratedFile({
        targets: [
          { entityType: 'order', entityId: orderId },
          { entityType: 'customer', entityId: customerId },
        ],
        fileType: 'receipt',
        url: billOfLading.url,
        storagePath: billOfLading.storagePath,
        fileName: billOfLading.fileName,
        mimeType: 'application/pdf',
        sizeBytes: billOfLading.buffer.length,
        metadata: {
          linkedEntityType: 'order',
          linkedEntityId: orderId,
          invoiceId: invoice.id,
          documentKind: 'delivery-receipt',
        },
      })
    }

    const signedAt = FieldValue.serverTimestamp()
    const deliveryNotes = data.deliveryNotes?.trim()

    const deliveryDocumentRef = orderSnap.ref.collection('documents').doc()
    await deliveryDocumentRef.set({
      type: 'delivery_acceptance',
      customerId,
      customerName: (customer.name as string | undefined) || 'Customer',
      orderId,
      orderNumber: (order.groupId as string | undefined) || orderId.slice(0, 8).toUpperCase(),
      runId: data.runId,
      stopId: data.stopId,
      deliveryDate: Timestamp.fromDate(deliveryDate),
      receivedByName,
      signatureUrl: signatureUpload.url,
      invoiceId: invoice.id,
      invoicePdfUrl,
      billOfLadingUrl: billOfLading.url,
      deliveryNotes: deliveryNotes || null,
      createdByUid: request.auth.uid,
      createdByName: actorName,
      createdAt: FieldValue.serverTimestamp(),
    })

    await stopRef.update({
      status: 'completed',
      gallonsDelivered: data.qtyDelivered,
      completedAt: signedAt,
      signedAt,
      signedByName: receivedByName,
      signatureUrl: signatureUpload.url,
      billOfLadingUrl: billOfLading.url,
      invoicePdfUrl,
      ...(deliveryNotes ? { notes: deliveryNotes } : {}),
    })

    await orderSnap.ref.update({
      status: 'ready_to_invoice',
      deliveryStatus: 'signed',
      deliveredAt: signedAt,
      signedAt,
      signedByUid: request.auth.uid,
      signedByName: receivedByName,
      receivedByName,
      signatureUrl: signatureUpload.url,
      billOfLadingUrl: billOfLading.url,
      invoicePdfUrl,
      deliveredLineItems: data.deliveredLineItems,
      deliveredAddOns: data.deliveredAddOns ?? [],
      ...(deliveryNotes ? { deliveryNotes } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })

    await appendStatusHistory(
      db,
      orderId,
      'delivered',
      request.auth.uid,
      actorName,
      'Delivery marked delivered by admin/dispatch.',
    )

    await appendStatusHistory(
      db,
      orderId,
      'ready_to_invoice',
      request.auth.uid,
      actorName,
      'Delivery complete and ready for invoicing.',
    )

    await maybeCompleteRun(data.runId)

    const recipients = await resolveDeliveryRecipients(customerId, customer)
    const orderSummaryHtml = buildOrderSummaryHtml(bolItems, data.qtyDelivered, deliveryNotes)
    const subjectDate = deliveryDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    const subject = `Delivery Confirmed — ${(customer.name as string | undefined) || 'Customer'} — ${subjectDate}`
    const attachments: MailAttachment[] = []

    if (billOfLading.buffer.length > 0) {
      attachments.push({
        content: billOfLading.buffer.toString('base64'),
        filename: billOfLading.fileName,
        type: 'application/pdf',
      })
    }

    const invoiceBuffer = await downloadBuffer(invoicePdfUrl)
    attachments.push({
      content: invoiceBuffer.toString('base64'),
      filename: `Invoice-${invoice.invoiceNumber || invoice.id}.pdf`,
      type: 'application/pdf',
    })

    const company = await getCompanySettings()
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#222">
        <div style="background:#111;padding:22px 28px;border-top:4px solid #E87722">
          <h1 style="margin:0;color:#fff;font-size:22px">Delivery Confirmed</h1>
          <p style="margin:8px 0 0;color:#d4d4d4;font-size:13px">
            ${(customer.name as string | undefined) || 'Customer'} · ${subjectDate}
          </p>
        </div>
        <div style="padding:24px 28px;border:1px solid #e5e5e5;border-top:none">
          <p style="margin:0 0 14px">A signed delivery has been completed by ${actorName}.</p>
          ${orderSummaryHtml}
          <p style="margin:18px 0 0">
            The Bill of Lading and Invoice PDFs are attached for your records.
          </p>
          <p style="margin:18px 0 0;color:#666;font-size:12px">
            ${company.name || 'OGS Gas Services'}
          </p>
        </div>
      </div>
    `

    let deliveredEmailCount = 0
    for (const email of recipients) {
      try {
        await sendEmail({ to: email, subject, html, attachments })
        deliveredEmailCount += 1
      } catch (err) {
        console.error(`adminFinalizeDelivery: failed to send email to ${email} —`, err)
      }
    }

    if (deliveredEmailCount > 0) {
      await db.collection('invoices').doc(invoice.id).update({
        status: 'sent',
        sentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    await orderSnap.ref.update({
      deliveryConfirmationRecipients: recipients,
      deliveryConfirmationEmailSentAt: FieldValue.serverTimestamp(),
    })

    await db.collection('emailLogs').add({
      orderId,
      runId: data.runId,
      stopId: data.stopId,
      recipients,
      sentCount: deliveredEmailCount,
      status: deliveredEmailCount > 0 ? 'sent' : 'failed',
      createdAt: FieldValue.serverTimestamp(),
      source: 'adminFinalizeDelivery',
    })

    return {
      signatureUrl: signatureUpload.url,
      billOfLadingUrl: billOfLading.url,
      invoicePdfUrl,
      invoiceId: invoice.id,
    }
  },
)

function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } | null {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/)
  if (!match) return null
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  }
}

async function uploadOrderAsset(args: {
  orderId: string
  fileName: string
  contentType: string
  buffer: Buffer
  folder: string
}): Promise<{ url: string; storagePath: string }> {
  const storagePath = `ogs-portal/orders/${args.orderId}/${args.folder}/${args.fileName}`
  const fileRef = storage.bucket().file(storagePath)
  const downloadToken = crypto.randomUUID()

  await fileRef.save(args.buffer, {
    contentType: args.contentType,
    metadata: {
      cacheControl: 'private, max-age=0',
      metadata: {
        orderId: args.orderId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  })

  const bucket = storage.bucket().name
  const encodedPath = encodeURIComponent(storagePath)
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${downloadToken}`
  return { url, storagePath }
}

async function findInvoiceForOrder(orderId: string): Promise<InvoiceRecord | null> {
  const snap = await db.collection('invoices').where('orderId', '==', orderId).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  const data = doc.data() as Record<string, unknown>
  return {
    id: doc.id,
    pdfUrl: data.pdfUrl as string | undefined,
    invoiceNumber: data.invoiceNumber as string | undefined,
  }
}

async function createInvoiceForDelivery(args: {
  orderId: string
  customerId: string
  deliveryDate: Date
  primaryItems: Array<{ productId: string; qty: number }>
  addOnItems: Array<{ productId: string; qty: number }>
  order: Record<string, unknown>
  productMap: Map<string, ProductSnapshot>
}): Promise<InvoiceRecord> {
  const lineItems = buildInvoiceLineItemsForOrder({
    primaryItems: args.primaryItems,
    addOnItems: args.addOnItems,
    order: args.order,
    productMap: args.productMap,
  })

  const deliveryFee = toNumber(args.order.deliveryFee, 0)

  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0)
  const orderTaxRate = toNumber(args.order.salesTaxRate, args.order.taxRate, DEFAULT_SALES_TAX_RATE)
  const applySalesTax = typeof args.order.applySalesTax === 'boolean'
    ? args.order.applySalesTax
    : orderTaxRate > 0
  const taxRate = applySalesTax ? orderTaxRate : 0
  const taxAmount = Number((subtotal * taxRate).toFixed(2))
  const totalAmount = Number((subtotal + taxAmount).toFixed(2))

  // ── GUARD: Verify delivery fee is included in total if order has one ──
  if (deliveryFee > 0) {
    const hasDeliveryFeeLine = lineItems.some((item) => /delivery\s*fee/i.test(item.description))
    if (!hasDeliveryFeeLine) {
      console.error(`[INVOICE ERROR] Order ${args.orderId} has deliveryFee $${deliveryFee.toFixed(2)} but no delivery fee line item in invoice!`)
      throw new Error(`Order ${args.orderId} has delivery fee but invoice does not include it. This is a critical bug.`)
    }
    const deliveryFeeLineTotal = lineItems.find((item) => /delivery\s*fee/i.test(item.description))?.total ?? 0
    if (deliveryFeeLineTotal !== deliveryFee) {
      console.error(`[INVOICE ERROR] Order ${args.orderId} delivery fee mismatch: order has $${deliveryFee.toFixed(2)}, invoice line has $${deliveryFeeLineTotal.toFixed(2)}`)
      throw new Error(`Delivery fee mismatch in invoice for order ${args.orderId}`)
    }
  }

  const invoiceRef = db.collection('invoices').doc()
  const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`
  const dueAt = Timestamp.fromDate(new Date(args.deliveryDate.getTime() + 30 * 24 * 60 * 60 * 1000))

  await invoiceRef.set({
    invoiceNumber,
    customerId: args.customerId,
    orderId: args.orderId,
    quoteId: args.order.quoteId ?? null,
    quoteNumber: args.order.quoteNumber ?? null,
    salesRepId: args.order.salesRepId ?? null,
    salesRepName: args.order.salesRepName ?? null,
    salesRepEmail: args.order.salesRepEmail ?? null,
    salesRepPhone: args.order.salesRepPhone ?? null,
    status: 'pending',
    lineItems,
    applySalesTax,
    salesTaxRate: taxRate,
    salesTaxAmount: taxAmount,
    subtotal,
    tax: taxAmount,
    total: totalAmount,
    taxRate,
    taxAmount,
    totalAmount,
    issuedAt: FieldValue.serverTimestamp(),
    dueAt,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { id: invoiceRef.id, invoiceNumber }
}

function buildInvoiceLineItemsForOrder(args: {
  primaryItems: Array<{ productId: string; qty: number }>
  addOnItems: Array<{ productId: string; qty: number }>
  order: Record<string, unknown>
  productMap: Map<string, ProductSnapshot>
}) {
  const quotedUnitPrices = getQuotedUnitPrices(args.order)
  const primaryFallbackPrice = toNumber(args.order.unitPrice, 0)

  const lineItems = [
    ...args.primaryItems.map((item) => {
      const quotedPrice = quotedUnitPrices.get(item.productId)
      return buildInvoiceLine(item, args.productMap.get(item.productId), quotedPrice ?? primaryFallbackPrice)
    }),
    ...args.addOnItems.map((item) => {
      const quotedPrice = quotedUnitPrices.get(item.productId)
      return buildInvoiceLine(item, args.productMap.get(item.productId), quotedPrice)
    }),
  ]

  const deliveryFee = toNumber(args.order.deliveryFee, 0)
  if (deliveryFee > 0) {
    lineItems.push({
      description: 'Delivery fee',
      quantity: 1,
      unitPrice: deliveryFee,
      amount: deliveryFee,
      total: deliveryFee,
    })
  }

  return lineItems
}

function getQuotedUnitPrices(order: Record<string, unknown>): Map<string, number> {
  const prices = new Map<string, number>()

  const quotedLineItems = Array.isArray(order.quotedLineItems)
    ? (order.quotedLineItems as Array<Record<string, unknown>>)
    : []
  for (const item of quotedLineItems) {
    const productId = item.productId as string | undefined
    const unitPrice = toNumber(item.unitPrice, 0)
    if (productId && unitPrice > 0) {
      prices.set(productId, unitPrice)
    }
  }

  const addOns = Array.isArray(order.addOns)
    ? (order.addOns as Array<Record<string, unknown>>)
    : []
  for (const item of addOns) {
    const productId = item.productId as string | undefined
    const unitPrice = toNumber(item.unitPrice, 0)
    if (productId && unitPrice > 0) {
      prices.set(productId, unitPrice)
    }
  }

  return prices
}

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

function buildInvoiceLine(
  item: { productId: string; qty: number },
  product?: ProductSnapshot,
  fallbackUnitPrice?: number,
) {
  const unitPrice = fallbackUnitPrice
    ?? product?.basePrice
    ?? product?.pricePerUnit
    ?? 0
  const total = Number((item.qty * unitPrice).toFixed(2))

  return {
    description: product?.name || item.productId,
    quantity: item.qty,
    unitPrice,
    amount: total,
    total,
  }
}

async function maybeCompleteRun(runId: string): Promise<void> {
  const stopsSnap = await db.collection('runs').doc(runId).collection('stops').get()
  const allDone = stopsSnap.docs.every((doc) => {
    const status = doc.data().status as string | undefined
    return status === 'completed' || status === 'skipped'
  })

  if (allDone) {
    await db.collection('runs').doc(runId).update({
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}

async function resolveDeliveryRecipients(
  customerId: string,
  customer: Record<string, unknown>,
): Promise<string[]> {
  const recipients = new Set<string>()
  const customerEmail = customer.email as string | undefined
  if (customerEmail) recipients.add(customerEmail)

  const adminUsers = await db.collection('users').where('role', '==', 'admin').where('active', '==', true).get()
  adminUsers.docs.forEach((doc) => {
    const email = doc.data().email as string | undefined
    if (email) recipients.add(email)
  })

  const company = await getCompanySettings()
  if (company.email) recipients.add(company.email)

  // Best effort fallback for accounts that route through company-scoped admins later.
  if (recipients.size === 0 && customerId) {
    const companyUsers = await db.collection('users').where('customerId', '==', customerId).limit(5).get()
    companyUsers.docs.forEach((doc) => {
      const email = doc.data().email as string | undefined
      if (email) recipients.add(email)
    })
  }

  return [...recipients]
}

function buildOrderSummaryHtml(
  items: Array<{ description: string; quantity: number; unit: string }>,
  qtyDelivered: number,
  deliveryNotes?: string,
): string {
  const rows = items.map((item) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${item.description}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${item.quantity}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${item.unit}</td>
    </tr>
  `).join('')

  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead>
        <tr style="background:#faf5ef">
          <th style="padding:8px 10px;text-align:left;color:#555">Item</th>
          <th style="padding:8px 10px;text-align:right;color:#555">Qty</th>
          <th style="padding:8px 10px;text-align:right;color:#555">Unit</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:0 0 10px"><strong>Total delivered:</strong> ${qtyDelivered}</p>
    ${deliveryNotes ? `<p style="margin:0"><strong>Delivery notes:</strong> ${deliveryNotes}</p>` : ''}
  `
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
