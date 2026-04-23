/**
 * functions/src/triggers/onCreditApplicationSubmitted.ts
 *
 * Firestore onCreate trigger for creditApplications/{companyId}.
 * Emails the OGS admin team when a new credit application is submitted.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { db } from '../admin'
import { sendEmail } from '../email/sendEmail'

const OGS_ADMIN_EMAIL = 'admin@ohiogassupply.com'

export const onCreditApplicationSubmitted = onDocumentCreated(
  { document: 'creditApplications/{companyId}' },
  async (event) => {
    const data      = event.data?.data()
    const companyId = event.params.companyId

    if (!data) return

    // Fetch company name for the email
    const compSnap = await db.collection('customers').doc(companyId).get()
    const companyName = compSnap.data()?.companyName ?? companyId

    const applicantName  = (data.legalEntityName as string | undefined) ?? companyName
    const submittedEmail = (data.contactEmail    as string | undefined) ?? ''

    await sendEmail({
      to:      OGS_ADMIN_EMAIL,
      subject: `New Net-30 Credit Application — ${companyName}`,
      html: `
        <h2 style="color:#E87722;">New Credit Application</h2>
        <p><strong>Company:</strong> ${companyName}</p>
        <p><strong>Legal Entity:</strong> ${applicantName}</p>
        ${submittedEmail ? `<p><strong>Contact Email:</strong> ${submittedEmail}</p>` : ''}
        <p><strong>Company ID:</strong> ${companyId}</p>
        <p style="margin-top:16px;">
          <a href="https://portal.ohiogassupply.com/ops/customers/${companyId}"
             style="background:#E87722;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">
            Review Application
          </a>
        </p>
        <p style="margin-top:24px;color:#888;">Ohio Gas Supply Portal</p>
      `,
    })
  },
)
