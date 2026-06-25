import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, FieldValue } from '../admin'
import { appendStatusHistory } from '../lib/orderStatus'
import { createNotification } from '../notifications/createNotification'
import { sendEmail } from '../email/sendEmail'

interface MarkOrderReadyForInvoiceInput {
  orderId: string
}

export const markOrderReadyForInvoice = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.')
  }

  const role = request.auth.token.role as string | undefined
  if (role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can mark an order ready for invoice.')
  }

  const data = request.data as Partial<MarkOrderReadyForInvoiceInput>
  if (!data.orderId) {
    throw new HttpsError('invalid-argument', 'orderId is required.')
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
  const currentStatus = (order.status as string | undefined) ?? 'pending'
  if (currentStatus !== 'delivered') {
    throw new HttpsError('failed-precondition', `Only delivered orders can be marked ready for invoice (current: ${currentStatus}).`)
  }

  const changedByName =
    (userSnap.data()?.name as string | undefined)
    || (request.auth.token.name as string | undefined)
    || 'Admin User'

  await orderRef.update({
    status: 'invoice_sent_pending',
    readyForInvoiceAt: FieldValue.serverTimestamp(),
    qbInvoiceNumber: order.qbInvoiceNumber ?? null,
    invoiceSentAt: order.invoiceSentAt ?? null,
    paidAt: order.paidAt ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  })

  await appendStatusHistory(
    db,
    data.orderId,
    'invoice_sent_pending',
    request.auth.uid,
    changedByName,
    'Order marked ready for invoice.',
  )

  const adminsSnap = await db
    .collection('users')
    .where('role', '==', 'admin')
    .where('active', '==', true)
    .get()

  const recipients = adminsSnap.docs
    .map((docSnap) => docSnap.data().email as string | undefined)
    .filter((email): email is string => typeof email === 'string' && email.trim().length > 0)

  await createNotification({
    userId: null,
    role: 'admin',
    type: 'invoice_ready',
    title: 'Order Ready for Invoice',
    body: `Order ${data.orderId.slice(0, 8).toUpperCase()} is ready for QuickBooks invoicing.`,
    link: '/admin/ops/orders',
    entityId: data.orderId,
    priority: 'high',
  })

  const subject = `[OGS] Order Ready for Invoice — ${data.orderId.slice(0, 8).toUpperCase()}`
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1f2937;line-height:1.45">
      <div style="background:#111827;color:#ffffff;padding:20px 24px;border-top:4px solid #E87722">
        <h1 style="margin:0;font-size:22px">Order Ready for Invoice</h1>
      </div>
      <div style="padding:20px 24px;border:1px solid #e5e7eb;border-top:none;background:#ffffff">
        <p style="margin:0 0 10px">A delivered order was marked ready for QuickBooks invoicing.</p>
        <p style="margin:0 0 8px"><strong>Order:</strong> ${data.orderId}</p>
        <p style="margin:0 0 16px"><strong>Updated by:</strong> ${changedByName}</p>
        <p style="margin:0"><a href="https://app.ohiogassupply.com/admin/ops/orders" style="color:#005eb8">Open Orders</a></p>
      </div>
    </div>
  `

  let sentCount = 0
  for (const email of recipients) {
    try {
      await sendEmail({
        to: email,
        subject,
        html,
      })
      sentCount += 1
    } catch (err) {
      console.error(`markOrderReadyForInvoice: failed to send to ${email} —`, err)
    }
  }

  await db.collection('emailLogs').add({
    source: 'markOrderReadyForInvoice',
    orderId: data.orderId,
    to: 'admin-role-group',
    recipients,
    sentCount,
    status: sentCount > 0 ? 'sent' : 'failed',
    subject,
    createdAt: FieldValue.serverTimestamp(),
    sentAt: FieldValue.serverTimestamp(),
  })

  return {
    success: true,
    newStatus: 'invoice_sent_pending' as const,
  }
})
