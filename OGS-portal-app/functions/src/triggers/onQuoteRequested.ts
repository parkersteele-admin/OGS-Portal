/**
 * functions/src/triggers/onQuoteRequested.ts
 *
 * Firestore onUpdate trigger for quoteRequests/{quoteId}.
 * When status transitions to 'pending_quote', notifies dispatch and the customer.
 * When status transitions to 'quoted', emails the customer with the quote.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { db } from '../admin'
import { SENDGRID_API_KEY } from '../config'
import { sendEmail } from '../email/sendEmail'

const OGS_DISPATCH_EMAIL = 'dispatch@ohiogassupply.com'

export const onQuoteRequested = onDocumentWritten(
  { document: 'quoteRequests/{quoteId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const before = event.data?.before.data()
    const after  = event.data?.after.data()
    if (!after) return

    const quoteId  = event.params.quoteId
    const beforeStatus = before?.status as string | undefined
    const afterStatus  = after.status  as string

    // ── New quote request submitted ──────────────────────────────────────────
    if (!before && afterStatus === 'pending_quote') {
      const companyId = after.companyId as string
      const compSnap  = await db.collection('customers').doc(companyId).get()
      const companyName = compSnap.data()?.companyName ?? companyId

      await sendEmail({
        to:      OGS_DISPATCH_EMAIL,
        subject: `New Quote Request — ${companyName}`,
        html: `
          <h2 style="color:#E87722;">New Quote Request</h2>
          <p>A customer has completed onboarding and is requesting a quote.</p>
          <p><strong>Company:</strong> ${companyName}</p>
          <p><strong>Quote ID:</strong> ${quoteId}</p>
          <p style="margin-top:16px;">
            <a href="https://portal.ohiogassupply.com/ops/customers/${companyId}"
               style="background:#E87722;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">
              View Customer
            </a>
          </p>
          <p style="margin-top:24px;color:#888;">Ohio Gas Supply Portal</p>
        `,
      })
      return
    }

    // ── Quote status changed from non-quoted to quoted ───────────────────────
    if (beforeStatus !== 'quoted' && afterStatus === 'quoted') {
      const companyId    = after.companyId    as string
      const contactEmail = after.contactEmail as string | undefined
      const quoteUrl     = after.pdfUrl       as string | undefined

      if (!contactEmail) return

      const compSnap    = await db.collection('customers').doc(companyId).get()
      const companyName = compSnap.data()?.companyName ?? 'your company'

      await sendEmail({
        to:      contactEmail,
        subject: `Your OGS Quote is Ready — ${companyName}`,
        html: `
          <h2 style="color:#E87722;">Your Quote is Ready</h2>
          <p>Hi,</p>
          <p>Ohio Gas Supply has prepared a quote for <strong>${companyName}</strong>.</p>
          ${quoteUrl
            ? `<p><a href="${quoteUrl}"
                    style="background:#E87722;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">
                    View Quote PDF
                  </a></p>`
            : ''}
          <p>Please log in to your portal to review and accept the quote.</p>
          <p style="margin-top:24px;color:#888;">Ohio Gas Supply Portal</p>
        `,
      })
    }
  },
)
