/**
 * functions/src/scheduled/certExpiryCheck.ts
 *
 * Schedule: every Monday 07:00 America/New_York
 *
 * Queries files/documents (in Firestore `files` collection) where
 * `expiresAt` is within the next 30 days.
 *
 * For each expiring cert or license:
 *  1. Skip if a notification was already created this week for the same file.
 *  2. Create a Firestore staff notification (dispatch role).
 *  3. Send a staff alert email for certs expiring within 7 days (urgent window).
 *
 * Also queries tanks for upcoming inspections (nextInspectionDate within 30 days)
 * which are managed separately from the files collection.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { db, FieldValue, Timestamp } from '../admin'
import { SENDGRID_API_KEY, requireSecret } from '../config'
import { sendEmail } from '../mail'
import { createNotification } from '../notifications/createNotification'

const WARN_DAYS   = 30
const URGENT_DAYS = 7

export const certExpiryCheck = onSchedule(
  {
    schedule:       '0 7 * * 1', // every Monday at 07:00
    timeZone:       'America/New_York',
    secrets:        [SENDGRID_API_KEY],
    memory:         '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY')

    const now    = new Date()
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() + WARN_DAYS)

    // De-dup window: don't re-alert on the same file within the past 7 days
    const dedupCutoff = new Date(now)
    dedupCutoff.setDate(dedupCutoff.getDate() - 7)

    const stats = { files: 0, tanks: 0, notifs: 0, emails: 0 }

    // ── 1. Expiring files/certs ───────────────────────────────────────────────
    let filesSnap
    try {
      filesSnap = await db
        .collection('files')
        .where('expiresAt', '>=', now)
        .where('expiresAt', '<=', cutoff)
        .get()
    } catch (err) {
      console.error('certExpiryCheck: files query failed —', err)
      filesSnap = null
    }

    if (filesSnap && !filesSnap.empty) {
      console.log(`certExpiryCheck: ${filesSnap.size} expiring file(s) found.`)
      stats.files = filesSnap.size

      await Promise.allSettled(
        filesSnap.docs.map(async (fileDoc) => {
          const file      = fileDoc.data() as Record<string, unknown>
          const fileId    = fileDoc.id
          const fileName  = (file.name ?? file.originalName ?? fileId) as string
          const fileType  = (file.fileType ?? file.type ?? 'document') as string

          const expiresAt = file.expiresAt instanceof Timestamp
            ? file.expiresAt.toDate()
            : new Date(file.expiresAt as string)

          const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000)

          // De-dup: skip if notification already sent this week
          const recentNotif = await db
            .collection('notifications')
            .where('entityId',  '==', fileId)
            .where('type',      '==', 'cert_expiry')
            .where('createdAt', '>=', dedupCutoff)
            .limit(1)
            .get()

          if (!recentNotif.empty) return

          const isUrgent  = daysLeft <= URGENT_DAYS
          const expiryStr = expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

          // Firestore notification for dispatch
          await createNotification({
            userId:   null,
            role:     'dispatch',
            type:     'cert_expiry',
            title:    isUrgent ? '⚠️ Cert Expiring in Days' : 'Cert Expiry Notice',
            body:     `${fileType} "${fileName}" expires ${expiryStr} (${daysLeft} day${daysLeft !== 1 ? 's' : ''}).`,
            entityId: fileId,
            priority: isUrgent ? 'urgent' : 'normal',
          })
          stats.notifs++

          // Email for urgent certs (≤ 7 days)
          if (isUrgent) {
            try {
              // Find dispatch users who have emails registered
              const dispatchUsersSnap = await db
                .collection('users')
                .where('role',   '==',  'dispatch')
                .where('active', '==',  true)
                .get()

              await Promise.allSettled(
                dispatchUsersSnap.docs
                  .filter((d) => d.data().email)
                  .map((d) => {
                    const u = d.data() as Record<string, unknown>
                    return sendEmail({
                      to:      u.email as string,
                      subject: `URGENT: ${fileType} "${fileName}" Expires in ${daysLeft} Days`,
                      html: `
                        <h2 style="color:#dc2626">Certificate Expiring Soon</h2>
                        <p>Hi ${u.name as string},</p>
                        <p>The following certificate requires attention:</p>
                        <table style="border-collapse:collapse;margin:16px 0">
                          <tr><td style="padding:4px 16px 4px 0;color:#555">File</td><td><strong>${fileName}</strong></td></tr>
                          <tr><td style="padding:4px 16px 4px 0;color:#555">Type</td><td>${fileType}</td></tr>
                          <tr><td style="padding:4px 16px 4px 0;color:#555">Expires</td><td><strong>${expiryStr}</strong></td></tr>
                          <tr><td style="padding:4px 16px 4px 0;color:#555">Days Remaining</td><td><strong style="color:#dc2626">${daysLeft}</strong></td></tr>
                        </table>
                        <p style="margin-top:24px">
                          <a href="https://app.ogsportal.com/ops/compliance"
                             style="background:#dc2626;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600">
                            View Compliance →
                          </a>
                        </p>
                        <p style="color:#666;font-size:12px;margin-top:16px">— OGS Portal Automated Alert</p>
                      `,
                    })
                  }),
              )
              stats.emails++
            } catch (err) {
              console.error(`certExpiryCheck [file=${fileId}]: urgent email failed —`, err)
            }
          }
        }),
      )
    } else {
      console.log('certExpiryCheck: no expiring files found.')
    }

    // ── 2. Tank inspections due ───────────────────────────────────────────────
    let tanksSnap
    try {
      tanksSnap = await db
        .collection('tanks')
        .where('nextInspectionDate', '>=', now)
        .where('nextInspectionDate', '<=', cutoff)
        .get()
    } catch (err) {
      console.error('certExpiryCheck: tanks query failed —', err)
      tanksSnap = null
    }

    if (tanksSnap && !tanksSnap.empty) {
      console.log(`certExpiryCheck: ${tanksSnap.size} tank inspection(s) due.`)
      stats.tanks = tanksSnap.size

      const batch = db.batch()

      await Promise.allSettled(
        tanksSnap.docs.map(async (tankDoc) => {
          const tank   = tankDoc.data() as Record<string, unknown>
          const tankId = tankDoc.id

          const inspectionDate = tank.nextInspectionDate instanceof Timestamp
            ? tank.nextInspectionDate.toDate()
            : new Date(tank.nextInspectionDate as string)

          const daysLeft  = Math.ceil((inspectionDate.getTime() - now.getTime()) / 86_400_000)
          const isUrgent  = daysLeft <= URGENT_DAYS
          const dateStr   = inspectionDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

          // De-dup
          const recentNotif = await db
            .collection('notifications')
            .where('entityId',  '==', tankId)
            .where('type',      '==', 'tank_inspection_due')
            .where('createdAt', '>=', dedupCutoff)
            .limit(1)
            .get()

          if (!recentNotif.empty) return

          batch.set(db.collection('notifications').doc(), {
            userId:    null,
            role:      'dispatch',
            type:      'tank_inspection_due',
            title:     isUrgent ? '⚠️ Tank Inspection Overdue Soon' : 'Tank Inspection Due',
            body:      `Tank ${tank.serialNumber as string} inspection due ${dateStr} (${daysLeft} day${daysLeft !== 1 ? 's' : ''}).`,
            entityId:  tankId,
            priority:  isUrgent ? 'urgent' : 'normal',
            read:      false,
            createdAt: FieldValue.serverTimestamp(),
          })
          stats.notifs++
        }),
      )

      await batch.commit()
    } else {
      console.log('certExpiryCheck: no upcoming tank inspections found.')
    }

    console.log(
      `certExpiryCheck complete — files=${stats.files} tanks=${stats.tanks}`,
      `notifs=${stats.notifs} emails=${stats.emails}`,
    )
  },
)
