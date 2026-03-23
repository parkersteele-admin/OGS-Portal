/**
 * functions/src/triggers/onCustomerCreated.ts
 *
 * Firestore onCreate trigger: customers/{companyId}
 * Auto-creates a matching leads/{companyId} doc at stage 'new_signup'
 * and notifies the team of the new signup.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { db, FieldValue } from '../admin'
import { SENDGRID_API_KEY } from '../config'
import { sendEmail } from '../email/sendEmail'

const SALES_INBOX = 'sales@ohiogassupply.com'

export const onCustomerCreated = onDocumentCreated(
  { document: 'customers/{companyId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const data = event.data?.data()
    if (!data) return

    const { companyId } = event.params
    const companyName  = (data.companyName  as string) ?? 'Unknown'
    const businessType = (data.businessType as string | null) ?? null
    const now = FieldValue.serverTimestamp()

    // Create the pipeline lead doc
    await db.collection('leads').doc(companyId).set({
      companyId,
      companyName,
      businessType,
      stage: 'new_signup',
      assignedTo: null,
      assignedAt: null,
      priority: 'normal',
      estimatedMonthlyValue: 0,
      source: 'online_signup',
      notes: [],
      stageHistory: [
        { stage: 'new_signup', enteredAt: now, exitedAt: null, actor: 'system', note: null },
      ],
      nextFollowUpAt: null,
      tags: [],
      lostReason: null,
      createdAt: now,
      updatedAt: now,
    })

    // Notify sales inbox
    try {
      await sendEmail({
        to: SALES_INBOX,
        subject: `New OGS Portal signup: ${companyName}${businessType ? ` (${businessType})` : ''}`,
        html: `
          <p>A new customer has signed up via the OGS Portal.</p>
          <ul>
            <li><strong>Company:</strong> ${companyName}</li>
            ${businessType ? `<li><strong>Type:</strong> ${businessType}</li>` : ''}
            <li><strong>Email:</strong> ${data.billingEmail ?? '—'}</li>
            <li><strong>Phone:</strong> ${data.phone ?? '—'}</li>
          </ul>
          <p><a href="https://app.ohiogassupply.com/ops/sales/dashboard">View Pipeline →</a></p>
        `,
      })
    } catch (err) {
      console.error('onCustomerCreated: failed to send signup notification', err)
    }
  },
)
