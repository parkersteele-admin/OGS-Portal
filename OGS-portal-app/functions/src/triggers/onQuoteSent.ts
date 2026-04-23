/**
 * functions/src/triggers/onQuoteSent.ts
 *
 * Firestore onDocumentWritten trigger for quotes/{quoteId}.
 *
 * When a quote's status transitions to 'sent' or 'accepted' for the first time
 * (from any previous status), set pricingUnlocked = true on the associated
 * customers/{customerId} document. This gates customer-facing product pricing
 * and ordering behind receiving a real quote from OGS.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { db, FieldValue } from '../admin'
import { sendEmail } from '../email/sendEmail'

const PORTAL_URL = 'https://app.ohiogassupply.com'

export const onQuoteSent = onDocumentWritten(
  { document: 'quotes/{quoteId}' },
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!after) return

    const beforeStatus = before?.status as string | undefined
    const afterStatus  = after.status  as string

    // Only act when status first transitions to 'sent' or 'accepted'
    const isUnlockingStatus = afterStatus === 'sent' || afterStatus === 'accepted'
    const wasAlreadyUnlocking = beforeStatus === 'sent' || beforeStatus === 'accepted'
    if (!isUnlockingStatus || wasAlreadyUnlocking) return

    const customerId = after.customerId as string | undefined
    if (!customerId) return

    const customerSnap = await db.collection('customers').doc(customerId).get()
    const customerData = customerSnap.data() ?? {}

    const recipientEmail =
      ((customerData.billingEmail as string | undefined)
        || (customerData.email as string | undefined)
        || '')
        .trim()

    const recipientName =
      (customerData.billingContactName as string | undefined)
      || (customerData.name as string | undefined)
      || (customerData.companyName as string | undefined)
      || 'Customer'

    const quoteNumber = (after.quoteNumber as string | undefined) || event.params.quoteId

    await db.collection('customers').doc(customerId).update({
      pricingUnlocked: true,
      updatedAt: FieldValue.serverTimestamp(),
    })

    if (!recipientEmail) return

    await sendEmail({
      to: recipientEmail,
      subject: `Quote #${quoteNumber} is ready in OGS Portal`,
      html: `
        <p>Hi ${recipientName},</p>
        <p>Your quote is now available and your pricing has been unlocked in the OGS Portal.</p>
        <p>
          <a href="${PORTAL_URL}/portal/quotes" style="display:inline-block;padding:10px 16px;background:#E87722;color:#fff;text-decoration:none;border-radius:6px;">
            View Quote
          </a>
        </p>
        <p style="margin-top:20px;color:#777;">Ohio Gas Supply Portal</p>
      `,
    })
  },
)
