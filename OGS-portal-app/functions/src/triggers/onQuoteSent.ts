/**
 * functions/src/triggers/onQuoteSent.ts
 *
 * Firestore onDocumentWritten trigger for quotes/{quoteId}.
 *
 * When a quote's status transitions to 'sent' or 'accepted' for the first time
 * (from any previous status):
 *   1. Set pricingUnlocked = true on the customer document.
 *
 * NOTE: The quote email with the public acceptance link is sent by the
 * generateQuotePdf callable — NOT here. Sending it here would produce a second
 * plain email that points to the login-required portal instead of the public
 * token URL. Do not add email sending to this trigger.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { db, FieldValue } from '../admin'

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

    await db.collection('customers').doc(customerId).update({
      pricingUnlocked: true,
      updatedAt: FieldValue.serverTimestamp(),
    })
  },
)
