/**
 * functions/src/scheduled/sendFollowUpReminders.ts
 *
 * Daily 7am ET — emails each rep their list of follow-ups due today.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { Timestamp } from 'firebase-admin/firestore'
import { db } from '../admin'
import { sendEmail } from '../email/sendEmail'

export const sendFollowUpReminders = onSchedule(
  {
    schedule:       '0 7 * * *',
    timeZone:       'America/New_York',
    secrets:        [],
    memory:         '256MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date()
    todayEnd.setHours(23, 59, 59, 999)

    const snap = await db.collection('leads')
      .where('nextFollowUpAt', '>=', Timestamp.fromDate(todayStart))
      .where('nextFollowUpAt', '<=', Timestamp.fromDate(todayEnd))
      .where('stage', 'not-in', ['won', 'lost'])
      .get()

    if (snap.empty) {
      console.log('sendFollowUpReminders: no follow-ups scheduled today')
      return
    }

    // Group by assignedTo
    const byRep: Record<string, Array<{ companyName: string; stage: string }>> = {}
    for (const doc of snap.docs) {
      const lead = doc.data()
      const uid  = (lead.assignedTo as string | null) ?? 'unassigned'
      if (!byRep[uid]) byRep[uid] = []
      byRep[uid].push({ companyName: lead.companyName as string, stage: lead.stage as string })
    }

    const STAGE_LABELS: Record<string, string> = {
      new_signup:      'New Signup',
      pending_setup:   'Pending Setup',
      quote_requested: 'Quote Requested',
      quote_sent:      'Quote Sent',
      negotiating:     'Negotiating',
      stalled:         'Stalled',
    }

    await Promise.allSettled(
      Object.entries(byRep).map(async ([uid, leads]) => {
        if (uid === 'unassigned') return  // skip unassigned
        try {
          const repSnap = await db.collection('users').doc(uid).get()
          const repData = repSnap.data()
          if (!repData?.email) return

          const rows = leads
            .map((l) => `<li><strong>${l.companyName}</strong> — ${STAGE_LABELS[l.stage] ?? l.stage}</li>`)
            .join('\n')

          await sendEmail({
            to: repData.email as string,
            subject: `Today's follow-ups (${leads.length})`,
            html: `
              <p>You have <strong>${leads.length} follow-up${leads.length !== 1 ? 's' : ''}</strong> scheduled for today:</p>
              <ul>${rows}</ul>
              <p><a href="https://app.ohiogassupply.com/ops/sales/dashboard">View in Pipeline →</a></p>
            `,
          })
        } catch (err) {
          console.error(`sendFollowUpReminders: failed for rep ${uid}`, err)
        }
      }),
    )

    console.log(`sendFollowUpReminders: processed ${snap.size} follow-ups`)
  },
)
