import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, FieldValue, storage, Timestamp } from '../admin'
import { sendEmail, type MailAttachment } from '../email/sendEmail'
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

interface ResolvedDeliveryLineItem {
  productId: string
  qty: number
  unitPrice: number
  amount: number
  description: string
}

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

    const normalizedDeliveredLineItems = normalizeDeliveredItems(data.deliveredLineItems)
    const normalizedDeliveredAddOns = normalizeDeliveredItems(data.deliveredAddOns ?? [])
    const resolvedLineItems = resolveDeliveryLineItems({
      order,
      primaryItems: normalizedDeliveredLineItems,
      addOnItems: normalizedDeliveredAddOns,
      productMap,
    })
    const primaryResolved = resolvedLineItems.slice(0, normalizedDeliveredLineItems.length)
    const addOnResolved = resolvedLineItems.slice(normalizedDeliveredLineItems.length)

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

    const bolItems = [
      ...primaryResolved.map((item) => {
        const product = productMap.get(item.productId)
        return {
          description: product?.name || item.description,
          quantity: item.qty,
          unit: product?.unit || 'unit',
        }
      }),
      ...addOnResolved.map((item) => {
        const product = productMap.get(item.productId)
        return {
          description: product?.name || item.description,
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
      billOfLadingUrl: billOfLading.url,
      deliveryNotes: deliveryNotes || null,
      createdByUid: request.auth.uid,
      createdByName: actorName,
      createdAt: FieldValue.serverTimestamp(),
    })

    const subtotal = Number(resolvedLineItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2))
    const deliveryFee = toNumber(order.deliveryFee, 0)
    const hazmatFee = toNumber(order.hazmatFee, 0)
    const applySalesTax = typeof order.applySalesTax === 'boolean'
      ? order.applySalesTax
      : toNumber(order.salesTaxRate, order.taxRate, 0) > 0
    const salesTaxRate = applySalesTax ? toNumber(order.salesTaxRate, order.taxRate, 0) : 0
    const salesTaxAmount = applySalesTax ? Number((subtotal * salesTaxRate).toFixed(2)) : 0
    const total = Number((subtotal + deliveryFee + hazmatFee + salesTaxAmount).toFixed(2))
    const totalQtyDelivered = Number(
      (primaryResolved.reduce((sum, item) => sum + item.qty, 0) + addOnResolved.reduce((sum, item) => sum + item.qty, 0)).toFixed(2),
    )
    const shouldAutoReadyForInvoice =
      Boolean(order.fromRecurringRunTemplate)
      || order.orderType === 'route'
      || order.orderType === 'offRoute'
    const nextStatus = shouldAutoReadyForInvoice ? 'ready_to_invoice' : 'delivered'

    await stopRef.update({
      status: 'completed',
      gallonsDelivered: totalQtyDelivered || data.qtyDelivered,
      completedAt: signedAt,
      signedAt,
      signedByName: receivedByName,
      signatureUrl: signatureUpload.url,
      billOfLadingUrl: billOfLading.url,
      ...(deliveryNotes ? { notes: deliveryNotes } : {}),
    })

    await orderSnap.ref.update({
      status: nextStatus,
      deliveryStatus: 'signed',
      deliveredAt: signedAt,
      signedAt,
      signedByUid: request.auth.uid,
      signedByName: receivedByName,
      receivedByName,
      signatureUrl: signatureUpload.url,
      billOfLadingUrl: billOfLading.url,
      productId: primaryResolved[0]?.productId ?? (order.productId as string | undefined),
      quantity: primaryResolved[0]?.qty ?? toNumber(order.quantity),
      unitPrice: primaryResolved[0]?.unitPrice ?? toNumber(order.unitPrice),
      subtotal,
      salesTaxRate,
      salesTaxAmount,
      taxRate: salesTaxRate,
      taxAmount: salesTaxAmount,
      total,
      deliveredLineItems: primaryResolved.map((item) => ({ productId: item.productId, qty: item.qty })),
      deliveredAddOns: addOnResolved.map((item) => ({ productId: item.productId, qty: item.qty })),
      quotedLineItems: resolvedLineItems.map((item) => ({
        productId: item.productId,
        description: item.description,
        quantity: item.qty,
        unitPrice: item.unitPrice,
        amount: item.amount,
      })),
      ...(deliveryNotes ? { deliveryNotes } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })

    await appendStatusHistory(
      db,
      orderId,
      nextStatus,
      request.auth.uid,
      actorName,
      shouldAutoReadyForInvoice
        ? 'Delivery finalized by admin/dispatch and moved to ready_to_invoice.'
        : 'Delivery marked delivered by admin/dispatch.',
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
            The Bill of Lading PDF is attached for your records.
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

function normalizeDeliveredItems(
  items: Array<{ productId: string; qty: number }> | undefined,
): Array<{ productId: string; qty: number }> {
  if (!Array.isArray(items)) return []

  const quantities = new Map<string, number>()
  for (const item of items) {
    const productId = String(item.productId ?? '').trim()
    if (!productId) continue
    const qty = Math.max(0, toNumber(item.qty))
    if (qty <= 0) continue
    quantities.set(productId, Number(((quantities.get(productId) ?? 0) + qty).toFixed(2)))
  }

  return [...quantities.entries()].map(([productId, qty]) => ({ productId, qty }))
}

function resolveDeliveryLineItems(args: {
  order: Record<string, unknown>
  primaryItems: Array<{ productId: string; qty: number }>
  addOnItems: Array<{ productId: string; qty: number }>
  productMap: Map<string, ProductSnapshot>
}): ResolvedDeliveryLineItem[] {
  const quotedUnitPrice = new Map<string, number>()

  const quoted = Array.isArray(args.order.quotedLineItems)
    ? (args.order.quotedLineItems as Array<Record<string, unknown>>)
    : []
  for (const item of quoted) {
    const productId = String(item.productId ?? '').trim()
    const unitPrice = toNumber(item.unitPrice)
    if (productId && unitPrice > 0) quotedUnitPrice.set(productId, unitPrice)
  }

  const addOns = Array.isArray(args.order.addOns)
    ? (args.order.addOns as Array<Record<string, unknown>>)
    : []
  for (const item of addOns) {
    const productId = String(item.productId ?? '').trim()
    const unitPrice = toNumber(item.unitPrice)
    if (productId && unitPrice > 0) quotedUnitPrice.set(productId, unitPrice)
  }

  const fallbackUnitPrice = toNumber(args.order.unitPrice, 0)
  const all = [...args.primaryItems, ...args.addOnItems]
  return all.map((item) => {
    const product = args.productMap.get(item.productId)
    const unitPrice = toNumber(
      quotedUnitPrice.get(item.productId),
      product?.pricePerUnit,
      product?.basePrice,
      fallbackUnitPrice,
      0,
    )
    const amount = Number((item.qty * unitPrice).toFixed(2))
    return {
      productId: item.productId,
      qty: item.qty,
      unitPrice,
      amount,
      description: product?.name ?? item.productId,
    }
  })
}
