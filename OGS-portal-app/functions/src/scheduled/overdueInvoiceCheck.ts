/**
 * functions/src/scheduled/overdueInvoiceCheck.ts
 *
 * Schedule: daily 09:00 America/New_York
 *
 * Queries invoices where status = 'pending' and dueAt < today.
 *
 * Buckets by days overdue and takes escalating action:
 *
 *  1–6 days  — no action (grace period)
 *  7 days    — first overdue reminder email to customer
 *  30 days   — second reminder + staff notification
 *  60 days   — final warning email + elevated staff notification
 *  90+ days  — flag account for credit-hold review + urgent staff alert
 *
 * De-duplication: each reminder type is only sent once per invoice.
 * The invoice document tracks which reminders have been sent via
 * reminders: { sent7d, sent30d, sent60d, sent90d } boolean fields.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { db, FieldValue, Timestamp } from '../admin'
import { sendEmail } from '../mail'
import { createNotification } from '../notifications/createNotification'

// Thresholds (days overdue)
const THRESHOLD_7D  = 7
const THRESHOLD_30D = 30
const THRESHOLD_60D = 60
const THRESHOLD_90D = 90

const PORTAL_URL = 'https://app.ohiogassupply.com'

export const overdueInvoiceCheck = onSchedule(
  {
    schedule:       '0 9 * * *',
    timeZone:       'America/New_York',
    secrets:        [],
    memory:         '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const now = new Date()

    // Invoices that are pending and past due
    const invoicesSnap = await db
      .collection('invoices')
      .where('status', '==', 'pending')
      .where('dueAt',  '<',  now)
      .get()

    if (invoicesSnap.empty) {
      console.log('overdueInvoiceCheck: no overdue invoices.')
      return
    }

    // ── Stats buckets ─────────────────────────────────────────────────────────
    const stats = {
      total: invoicesSnap.size,
      '1-30d': 0, '31-60d': 0, '61-90d': 0, '90+d': 0,
      emailsSent: 0, notifsSent: 0,
    }

    await Promise.allSettled(
      invoicesSnap.docs.map(async (invoiceDoc) => {
        const invoice       = invoiceDoc.data() as Record<string, unknown>
        const invoiceId     = invoiceDoc.id
        const customerId    = invoice.customerId    as string | undefined
        const invoiceNumber = invoice.invoiceNumber as string
        const totalAmount   = invoice.totalAmount   as number

        // Calculate days overdue
        const dueAt = invoice.dueAt instanceof Timestamp
          ? invoice.dueAt.toDate()
          : new Date(invoice.dueAt as string)

        const daysOverdue = Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000)

        // Track reminder state (stored on invoice doc to survive across runs)
        const reminders = (invoice.reminders as Record<string, boolean>) ?? {}

        // Update overdue status on the invoice (marks it clearly for queries)
        if (invoice.status !== 'overdue') {
          await invoiceDoc.ref.update({
            status:    'overdue',
            overdueAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }).catch((err) =>
            console.error(`overdueInvoiceCheck [${invoiceId}]: status update failed —`, err)
          )
        }

        // Bucket for stats
        if      (daysOverdue <= 30) stats['1-30d']++
        else if (daysOverdue <= 60) stats['31-60d']++
        else if (daysOverdue <= 90) stats['61-90d']++
        else                        stats['90+d']++

        // Fetch customer (needed for all actions)
        let customer: Record<string, unknown> | null = null
        if (customerId) {
          const snap = await db.collection('customers').doc(customerId).get()
          customer  = snap.exists ? (snap.data() as Record<string, unknown>) : null
        }

        // ── 7-day reminder ────────────────────────────────────────────────────
        if (daysOverdue >= THRESHOLD_7D && !reminders.sent7d) {
          await sendReminderEmail(customer, invoiceNumber, totalAmount, daysOverdue, '7-day')
          await sendReminderNotification(customerId, invoiceId, invoiceNumber, daysOverdue, false)
          await invoiceDoc.ref.update({
            'reminders.sent7d': true,
            updatedAt:          FieldValue.serverTimestamp(),
          })
          stats.emailsSent++
          stats.notifsSent++
        }

        // ── 30-day reminder + staff alert ──────────────────────────────────────
        if (daysOverdue >= THRESHOLD_30D && !reminders.sent30d) {
          await sendReminderEmail(customer, invoiceNumber, totalAmount, daysOverdue, '30-day')
          await sendReminderNotification(customerId, invoiceId, invoiceNumber, daysOverdue, false)
          // Staff notification: accounts > 30 days need follow-up
          await createNotification({
            userId:   null,
            role:     'dispatch',
            type:     'invoice_overdue_30d',
            title:    '30-Day Overdue Invoice',
            body:     `Invoice #${invoiceNumber} ($${totalAmount.toFixed(2)}) is ${daysOverdue} days overdue. Customer follow-up required.`,
            entityId: invoiceId,
          })
          await invoiceDoc.ref.update({
            'reminders.sent30d': true,
            updatedAt:           FieldValue.serverTimestamp(),
          })
          stats.emailsSent++
          stats.notifsSent += 2
        }

        // ── 60-day final warning ───────────────────────────────────────────────
        if (daysOverdue >= THRESHOLD_60D && !reminders.sent60d) {
          await sendReminderEmail(customer, invoiceNumber, totalAmount, daysOverdue, '60-day')
          await sendReminderNotification(customerId, invoiceId, invoiceNumber, daysOverdue, false)
          await createNotification({
            userId:   null,
            role:     'dispatch',
            type:     'invoice_overdue_60d',
            title:    '60-Day Overdue Invoice — Final Warning Sent',
            body:     `Invoice #${invoiceNumber} ($${totalAmount.toFixed(2)}) is ${daysOverdue} days overdue. Final warning sent to customer.`,
            entityId: invoiceId,
            priority: 'high',
          })
          await invoiceDoc.ref.update({
            'reminders.sent60d': true,
            updatedAt:           FieldValue.serverTimestamp(),
          })
          stats.emailsSent++
          stats.notifsSent += 2
        }

        // ── 90-day credit hold ─────────────────────────────────────────────────
        if (daysOverdue >= THRESHOLD_90D && !reminders.sent90d) {
          // Flag customer for credit-hold review
          if (customerId) {
            await db.collection('customers').doc(customerId).update({
              creditHoldFlag:    true,
              creditHoldFlagAt:  FieldValue.serverTimestamp(),
              updatedAt:         FieldValue.serverTimestamp(),
            }).catch((err) =>
              console.error(`overdueInvoiceCheck [${invoiceId}]: credit hold flag failed —`, err)
            )
          }

          // Urgent staff alert
          await createNotification({
            userId:   null,
            role:     'dispatch',
            type:     'invoice_overdue_90d',
            title:    'Credit Hold Review Required',
            body:     `Invoice #${invoiceNumber} ($${totalAmount.toFixed(2)}) is ${daysOverdue} days overdue. Account flagged for credit hold review.`,
            entityId: invoiceId,
            priority: 'urgent',
          })

          await invoiceDoc.ref.update({
            'reminders.sent90d': true,
            updatedAt:           FieldValue.serverTimestamp(),
          })
          stats.notifsSent++
        }
      }),
    )

    console.log(
      `overdueInvoiceCheck complete — total=${stats.total}`,
      `1-30d=${stats['1-30d']} 31-60d=${stats['31-60d']} 61-90d=${stats['61-90d']} 90+d=${stats['90+d']}`,
      `emailsSent=${stats.emailsSent} notifsSent=${stats.notifsSent}`,
    )
  },
)

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendReminderEmail(
  customer:      Record<string, unknown> | null,
  invoiceNumber: string,
  totalAmount:   number,
  daysOverdue:   number,
  stage:         '7-day' | '30-day' | '60-day',
): Promise<void> {
  if (!customer?.email) return

  const subjectMap = {
    '7-day':  `Reminder: Invoice #${invoiceNumber} is Overdue`,
    '30-day': `30-Day Notice: Invoice #${invoiceNumber} Requires Payment`,
    '60-day': `Final Notice: Invoice #${invoiceNumber} — Immediate Action Required`,
  }

  const ctaStyleMap = {
    '7-day':  'background:#2563eb',
    '30-day': 'background:#d97706',
    '60-day': 'background:#dc2626',
  }

  const bodyMap = {
    '7-day':  'This is a friendly reminder that your invoice is now overdue.',
    '30-day': 'Your invoice is 30 days past due. Please arrange payment to avoid service interruption.',
    '60-day': 'Your invoice is 60 days past due. This is your final notice before your account is referred for collection.',
  }

  await sendEmail({
    to:      customer.email as string,
    subject: subjectMap[stage],
    html: `
      <h2>${subjectMap[stage]}</h2>
      <p>Hi ${customer.name as string},</p>
      <p>${bodyMap[stage]}</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 16px 4px 0;color:#555">Invoice</td><td><strong>#${invoiceNumber}</strong></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#555">Amount Due</td><td><strong>$${totalAmount.toFixed(2)}</strong></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#555">Days Overdue</td><td><strong>${daysOverdue}</strong></td></tr>
      </table>
      <p style="margin-top:24px">
        <a href="${PORTAL_URL}/portal/invoices"
           style="${ctaStyleMap[stage]};color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600">
          Pay Now →
        </a>
      </p>
      <p style="color:#666;font-size:12px;margin-top:24px">
        If you believe this is an error, please contact support immediately.<br>
        — The OGS Portal Team
      </p>
    `,
  }).catch((err) =>
    console.error(`overdueInvoiceCheck [${invoiceNumber}]: ${stage} email failed —`, err)
  )
}

async function sendReminderNotification(
  customerId:    string | undefined,
  invoiceId:     string,
  invoiceNumber: string,
  daysOverdue:   number,
  urgent:        boolean,
): Promise<void> {
  if (!customerId) return

  await createNotification({
    userId:   customerId,
    type:     'invoice_overdue',
    title:    'Invoice Overdue',
    body:     `Invoice #${invoiceNumber} is ${daysOverdue} days past due. Please pay to avoid service interruption.`,
    entityId: invoiceId,
    link:     `/portal/invoices/${invoiceId}`,
    priority: urgent ? 'high' : 'normal',
  })
}
