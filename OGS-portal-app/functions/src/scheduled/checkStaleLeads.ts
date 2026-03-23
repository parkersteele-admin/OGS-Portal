/**
 * functions/src/scheduled/checkStaleLeads.ts
 *
 * Daily 8am ET — finds leads at 'quote_sent' with no activity for 14+ days,
 * sets stage to 'stalled', and emails the assigned rep.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { db, FieldValue } from '../admin'
import { SENDGRID_API_KEY, requireSecret } from '../config'
import { sendEmail } from '../email/sendEmail'
import { v4 as uuid } from 'uuid'

const STALE_THRESHOLD_DAYS = 14

export const checkStaleLeads = onSchedule(
  {
    schedule:  '0 8 * * *',
    timeZone:  'America/New_York',
    secrets:   [SENDGRID_API_KEY],
    memory:    '256MiB',
    timeoutSeconds: 300,
  },
  async () => {
    requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY')

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - STALE_THRESHOLD_DAYS)

    const staleSnap = await db.collection('leads')
      .where('stage', '==', 'quote_sent')
      .where('updatedAt', '<=', cutoff)
      .get()

    if (staleSnap.empty) {
      console.log('checkStaleLeads: no stale leads found')
      return
    }

    const now = FieldValue.serverTimestamp()
    const nowDate = new Date()

    const results = await Promise.allSettled(
      staleSnap.docs.map(async (leadDoc) => {
        const lead = leadDoc.data()

        // Build updated stageHistory
        const history = Array.isArray(lead.stageHistory) ? [...lead.stageHistory] : []
        const updated = history.map((e: Record<string, unknown>) =>
          e.exitedAt === null ? { ...e, exitedAt: nowDate } : e,
        )
        updated.push({
          stage: 'stalled',
          enteredAt: nowDate,
          exitedAt: null,
          actor: 'system',
          note: `Auto-stalled: no activity for ${STALE_THRESHOLD_DAYS} days`,
        })

        const activityEntry = {
          id: uuid(),
          type: 'system',
          body: `Lead auto-stalled: no activity for ${STALE_THRESHOLD_DAYS} days at Quote Sent stage`,
          createdBy: 'system',
          createdAt: nowDate,
        }

        await leadDoc.ref.update({
          stage:        'stalled',
          stageHistory: updated,
          notes:        FieldValue.arrayUnion(activityEntry),
          updatedAt:    now,
        })

        // Notify assigned rep
        if (lead.assignedTo) {
          try {
            const repSnap = await db.collection('users').doc(lead.assignedTo as string).get()
            const repEmail = repSnap.data()?.email as string | undefined
            if (repEmail) {
              await sendEmail({
                to: repEmail,
                subject: `Stalled lead: ${lead.companyName} — needs follow-up`,
                html: `
                  <p><strong>${lead.companyName}</strong> has been at Quote Sent for
                  ${STALE_THRESHOLD_DAYS} days with no activity.</p>
                  <p>The lead has been moved to <strong>Stalled</strong>.</p>
                  <p><a href="https://app.ohiogassupply.com/ops/sales/dashboard">View in Pipeline →</a></p>
                `,
              })
            }
          } catch (err) {
            console.error(`checkStaleLeads: failed to email rep for ${leadDoc.id}`, err)
          }
        }
      }),
    )

    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      console.error(`checkStaleLeads: ${failed.length} leads failed to update`, failed)
    }

    console.log(`checkStaleLeads: stalled ${staleSnap.size} leads`)
  },
)
