import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { Timestamp } from 'firebase-admin/firestore'
import { db, FieldValue } from '../admin'
import { appendStatusHistory, type OrderStatus } from '../lib/orderStatus'

interface UpdateOrderBillingStatusInput {
  orderId: string
  newStatus: 'invoice_sent' | 'paid'
  qbInvoiceNumber?: string
  invoiceAmount?: number
  paidAmount?: number
  /** ISO date string (YYYY-MM-DD or full ISO). */
  paidAt?: string
}

const ALLOWED_PREDECESSOR: Record<UpdateOrderBillingStatusInput['newStatus'], OrderStatus> = {
  invoice_sent: 'invoice_sent_pending',
  paid: 'invoice_sent',
}

export const updateOrderBillingStatus = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.')
  }

  const role = request.auth.token.role as string | undefined
  if (role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can update billing status.')
  }

  const data = request.data as Partial<UpdateOrderBillingStatusInput>
  if (!data.orderId || !data.newStatus) {
    throw new HttpsError('invalid-argument', 'orderId and newStatus are required.')
  }
  if (data.newStatus !== 'invoice_sent' && data.newStatus !== 'paid') {
    throw new HttpsError('invalid-argument', 'newStatus must be invoice_sent or paid.')
  }

  // Validate billing fields per status
  if (data.newStatus === 'invoice_sent') {
    if (!data.qbInvoiceNumber || data.qbInvoiceNumber.trim() === '') {
      throw new HttpsError('invalid-argument', 'qbInvoiceNumber is required when marking invoice sent.')
    }
  }

  if (data.newStatus === 'paid') {
    if (typeof data.paidAmount !== 'number' || data.paidAmount <= 0) {
      throw new HttpsError('invalid-argument', 'paidAmount must be a positive number when marking as paid.')
    }
  }

  const orderRef = db.collection('orders').doc(data.orderId)
  const [orderSnap, userSnap] = await Promise.all([
    orderRef.get(),
    db.collection('users').doc(request.auth.uid).get(),
  ])

  if (!orderSnap.exists) {
    throw new HttpsError('not-found', 'Order not found.')
  }

  const order = orderSnap.data() as Record<string, unknown>
  const currentStatus = (order.status as OrderStatus | undefined) ?? 'pending'
  const expectedCurrent = ALLOWED_PREDECESSOR[data.newStatus]
  if (currentStatus !== expectedCurrent) {
    throw new HttpsError(
      'failed-precondition',
      `Cannot transition from ${currentStatus} to ${data.newStatus}. Expected ${expectedCurrent}.`,
    )
  }

  const changedByName =
    (userSnap.data()?.name as string | undefined)
    || (request.auth.token.name as string | undefined)
    || 'Admin User'

  await orderRef.update({
    status: data.newStatus,
    updatedAt: FieldValue.serverTimestamp(),
    ...(data.newStatus === 'invoice_sent' && {
      qbInvoiceNumber: data.qbInvoiceNumber?.trim() ?? null,
      ...(typeof data.invoiceAmount === 'number' && data.invoiceAmount > 0
        ? { invoiceAmount: data.invoiceAmount }
        : {}),
      invoiceSentAt: FieldValue.serverTimestamp(),
    }),
    ...(data.newStatus === 'paid' && {
      paidAmount: data.paidAmount,
      paidAt: data.paidAt
        ? Timestamp.fromDate(new Date(data.paidAt))
        : FieldValue.serverTimestamp(),
    }),
  })

  await appendStatusHistory(
    db,
    data.orderId,
    data.newStatus,
    request.auth.uid,
    changedByName,
    `Billing status updated to ${data.newStatus}.`,
  )

  await db.collection('emailLogs').add({
    source: 'updateOrderBillingStatus',
    orderId: data.orderId,
    status: 'sent',
    subject: `Billing status updated: ${data.newStatus}`,
    to: 'internal-admin-log',
    createdAt: FieldValue.serverTimestamp(),
    sentAt: FieldValue.serverTimestamp(),
  })

  return {
    success: true,
    newStatus: data.newStatus,
  }
})
