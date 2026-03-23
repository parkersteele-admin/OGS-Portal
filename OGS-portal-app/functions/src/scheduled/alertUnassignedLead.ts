/**
 * functions/src/scheduled/alertUnassignedLead.ts
 *
 * Hourly — finds new online signups that have been unassigned for >4 hours
 * and sends an alert to the admin/sales inbox.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../admin'
import { SENDGRID_API_KEY, requireSecret } from '../config'
import { sendEmail } from '../email/sendEmail'

const ALERT_AFTER_HOURS = 4
const SALES_INBOX = 'sales@ohiogassupply.com'

export const alertUnassignedLead = onSchedule(
  {
    schedule:       '0 * * * *',   // every hour
    timeZone:       'America/New_York',
    secrets:        [SENDGRID_API_KEY],
    memory:         '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY')

    const cutoff = new Date()
    cutoff.setHours(cutoff.getHours() - ALERT_AFTER_HOURS)

    const snap = await db.collection('leads')
      .where('source', '==', 'online_signup')
      .where('assignedTo', '==', null)
      .where('stage', 'not-in', ['won', 'lost'])
      .where('createdAt', '<=', Timestamp.fromDate(cutoff))
      .get()

    if (snap.empty) return

    const names = snap.docs.map((d) => d.data().companyName as string)
    const rows  = names.map((n) => `<li>${n}</li>`).join('\n')

    try {
      await sendEmail({
        to: SALES_INBOX,
        subject: `${snap.size} unassigned lead${snap.size !== 1 ? 's' : ''} — needs assignment`,
        html: `
          <p>The following leads have been unassigned for more than ${ALERT_AFTER_HOURS} hours:</p>
          <ul>${rows}</ul>
          <p><a href="https://app.ohiogassupply.com/ops/sales/dashboard">Assign in Pipeline →</a></p>
        `,
      })
    } catch (err) {
      console.error('alertUnassignedLead: email failed', err)
    }
  },
)
