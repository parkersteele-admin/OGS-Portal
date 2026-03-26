/**
 * functions/src/scheduled/lowLevelAlertCheck.ts
 *
 * Schedule: daily 08:00 America/New_York
 *
 * Queries all deployed tanks where currentLevelPct < 25.
 *
 * For each low tank:
 *  1. De-duplicate: skip if an alert was already sent in the last 7 days.
 *  2. Send customer refill email with CTA link.
 *  3. Create draft order if customer has autopay + no pending/scheduled order.
 *  4. Send staff (dispatch) notification.
 *  5. Log alert to Firestore notifications collection.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { db, FieldValue } from '../admin'
import { SENDGRID_API_KEY, requireSecret } from '../config'
import { sendEmail } from '../mail'

const LOW_LEVEL_PCT = 25       // alert threshold (%)
const DEDUP_DAYS    = 7        // suppress repeat alerts within this window
const PORTAL_URL    = 'https://app.ohiogassupply.com'

export const lowLevelAlertCheck = onSchedule(
  {
    schedule:       '0 8 * * *',
    timeZone:       'America/New_York',
    secrets:        [SENDGRID_API_KEY],
    memory:         '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY')

    // ── Query low tanks ───────────────────────────────────────────────────────
    const tanksSnap = await db
      .collection('tanks')
      .where('status',          '==',  'deployed')
      .where('currentLevelPct', '<=',  LOW_LEVEL_PCT)
      .get()

    if (tanksSnap.empty) {
      console.log('lowLevelAlertCheck: no low tanks found.')
      return
    }

    console.log(`lowLevelAlertCheck: ${tanksSnap.size} low tank(s) found.`)

    const dedupCutoff = new Date()
    dedupCutoff.setDate(dedupCutoff.getDate() - DEDUP_DAYS)

    let alerted = 0
    let deduped = 0

    await Promise.allSettled(
      tanksSnap.docs.map(async (tankDoc) => {
        const tank      = tankDoc.data() as Record<string, unknown>
        const tankId    = tankDoc.id
        const levelPct  = tank.currentLevelPct as number
        const serial    = tank.serialNumber    as string
        const cid       = tank.customerId      as string | undefined

        // ── 1. De-duplicate check ─────────────────────────────────────────────
        const recentAlert = await db
          .collection('notifications')
          .where('entityId',  '==',  tankId)
          .where('type',      '==',  'low_tank_level')
          .where('createdAt', '>=',  dedupCutoff)
          .limit(1)
          .get()

        if (!recentAlert.empty) {
          deduped++
          return
        }

        // ── Fetch customer ────────────────────────────────────────────────────
        let customer: Record<string, unknown> | null = null
        if (cid) {
          const snap = await db.collection('customers').doc(cid).get()
          customer  = snap.exists ? (snap.data() as Record<string, unknown>) : null
        }

        // ── 2. Customer refill email ──────────────────────────────────────────
        if (customer?.email) {
          try {
            await sendEmail({
              to:      customer.email as string,
              subject: `Action Required: Tank ${serial} is at ${Math.round(levelPct)}%`,
              html: `
                <h2>Your Tank Level is Low</h2>
                <p>Hi ${customer.name as string},</p>
                <p>Tank <strong>${serial}</strong> is currently at
                <strong>${Math.round(levelPct)}%</strong> capacity.</p>
                <p>We recommend scheduling a refill soon to avoid running out.</p>
                <p style="margin-top:24px">
                  <a href="${PORTAL_URL}/portal/order"
                     style="background:#2563eb;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600">
                    Schedule a Refill →
                  </a>
                </p>
                <p style="margin-top:24px;color:#666;font-size:12px">
                  You are receiving this because your tank level has dropped below ${LOW_LEVEL_PCT}%.<br>
                  — The OGS Portal Team
                </p>
              `,
            })
          } catch (err) {
            console.error(`lowLevelAlertCheck [tank=${tankId}]: email failed —`, err)
          }
        }

        // ── 3. Create draft order for autopay customers ───────────────────────
        if (cid && customer?.autopayEnabled) {
          try {
            const hasPendingOrder = !(await db
              .collection('orders')
              .where('customerId', '==', cid)
              .where('tankId',     '==', tankId)
              .where('status',     'in', ['pending', 'scheduled'])
              .limit(1)
              .get()).empty

            if (!hasPendingOrder) {
              const orderNumber = `ORD-AUTO-${Date.now().toString().slice(-8)}`
              await db.collection('orders').add({
                customerId:   cid,
                tankId,
                orderNumber,
                status:       'pending',
                source:       'auto_low_level',
                deliveryTier: 'standard',
                requestedAt:  FieldValue.serverTimestamp(),
                createdAt:    FieldValue.serverTimestamp(),
                updatedAt:    FieldValue.serverTimestamp(),
              })
              console.log(`lowLevelAlertCheck [tank=${tankId}]: draft order ${orderNumber} created for autopay customer ${cid}`)
            }
          } catch (err) {
            console.error(`lowLevelAlertCheck [tank=${tankId}]: draft order creation failed —`, err)
          }
        }

        // ── 4 + 5. Staff notification + Firestore log ─────────────────────────
        try {
          const batch = db.batch()

          // Staff (dispatch) notification
          batch.set(db.collection('notifications').doc(), {
            userId:    null,
            role:      'dispatch',
            type:      'low_tank_level_staff',
            title:     'Low Tank Level',
            body:      `Tank ${serial} (customer: ${(customer?.name as string) ?? cid ?? 'unknown'}) is at ${Math.round(levelPct)}%.`,
            entityId:  tankId,
            priority:  levelPct <= 10 ? 'high' : 'normal',
            read:      false,
            createdAt: FieldValue.serverTimestamp(),
          })

          // Customer-facing notification log
          batch.set(db.collection('notifications').doc(), {
            userId:    cid ?? null,
            type:      'low_tank_level',
            title:     'Low Tank Level',
            body:      `Tank ${serial} is at ${Math.round(levelPct)}% capacity. Please schedule a refill.`,
            entityId:  tankId,
            read:      false,
            createdAt: FieldValue.serverTimestamp(),
          })

          await batch.commit()
          alerted++
        } catch (err) {
          console.error(`lowLevelAlertCheck [tank=${tankId}]: notification write failed —`, err)
        }
      }),
    )

    console.log(`lowLevelAlertCheck: complete — alerted=${alerted}, deduped=${deduped}`)
  },
)
