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
    const contactName  = (data.billingContactName as string | null) ?? companyName
    const email        = (data.billingEmail as string | null) ?? ''
    const phone        = (data.phone as string | null) ?? ''
    const now = FieldValue.serverTimestamp()

    // Write a Lead-shaped doc so new signups flow directly into /crm/leads.
    // status='pending_setup' renders in its own Kanban column.
    // isWebSignup=true shows the "Website" badge on the card.
    await db.collection('leads').doc(companyId).set({
      name:           contactName,
      email,
      phone,
      company:        companyName,
      status:         'pending_setup',
      source:         'Website',
      isWebSignup:    true,
      companyId,
      assignedTo:     null,
      estimatedValue: null,
      notes:          '',
      createdAt:      now,
      updatedAt:      now,
    })

    // Notify sales inbox
    try {
      await sendEmail({
        to: SALES_INBOX,
        subject: `New website signup: ${companyName}`,
        html: `
          <p>A new customer has signed up via the OGS Portal and is in <strong>Pending Setup</strong>.</p>
          <ul>
            <li><strong>Company:</strong> ${companyName}</li>
            <li><strong>Contact:</strong> ${contactName}</li>
            <li><strong>Email:</strong> ${email || '—'}</li>
            <li><strong>Phone:</strong> ${phone || '—'}</li>
          </ul>
          <p><a href="https://app.ohiogassupply.com/crm/leads">View in CRM Leads →</a></p>
        `,
      })
    } catch (err) {
      console.error('onCustomerCreated: failed to send signup notification', err)
    }
  },
)
