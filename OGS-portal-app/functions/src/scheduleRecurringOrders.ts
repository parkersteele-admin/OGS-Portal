/**
 * functions/src/scheduleRecurringOrders.ts
 *
 * Pub/Sub scheduled function — runs every 24 hours (6 AM ET).
 *
 * For every customer with an active RouteSchedule whose nextDeliveryDate falls
 * within the look-ahead window, this function:
 *   1. Creates one pending order doc per line item (all sharing a groupId).
 *   2. Advances nextDeliveryDate on the schedule by the appropriate interval.
 *   3. Writes a dispatch notification.
 *
 * Duplicate-safety: orders are tagged with a deterministic groupId derived
 * from customerId + delivery date, and we check for existing orders before
 * creating new ones.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger }      from 'firebase-functions/v2'
import { db, FieldValue, Timestamp } from './admin'

/** How many days ahead to look for upcoming deliveries. */
const LOOKAHEAD_DAYS = 3

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Advance a Date by the schedule cadence. */
function advanceDate(
  current: Date,
  cadence: string,
  customIntervalDays?: number,
): Date {
  const next = new Date(current)
  switch (cadence) {
    case 'weekly':   next.setDate(next.getDate() + 7);  break
    case 'biweekly': next.setDate(next.getDate() + 14); break
    case 'monthly':  next.setMonth(next.getMonth() + 1); break
    case 'custom':   next.setDate(next.getDate() + (customIntervalDays ?? 7)); break
    default:         next.setDate(next.getDate() + 7)
  }
  return next
}

// ─── scheduled function ───────────────────────────────────────────────────────

export const scheduleRecurringOrders = onSchedule(
  {
    schedule:  '0 6 * * *',
    timeZone:  'America/New_York',
    memory:    '256MiB',
  },
  async () => {
    const now     = new Date()
    const cutoff  = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000)
    const cutoffTs = Timestamp.fromDate(cutoff)

    logger.info(`scheduleRecurringOrders: running. cutoff=${cutoff.toISOString()}`)

    // Collection-group query across all customers' routeSchedule subcollections.
    // Each customer stores exactly one doc at: customers/{id}/routeSchedule/current
    const snap = await db
      .collectionGroup('routeSchedule')
      .where('isActive', '==', true)
      .where('nextDeliveryDate', '<=', cutoffTs)
      .get()

    logger.info(`scheduleRecurringOrders: ${snap.size} active schedule(s) due`)

    let created = 0
    let skipped = 0
    let errors  = 0

    for (const schedDoc of snap.docs) {
      const customerId = schedDoc.ref.parent.parent?.id
      if (!customerId) {
        logger.warn('scheduleRecurringOrders: could not resolve customerId', { path: schedDoc.ref.path })
        continue
      }

      try {
        const schedule = schedDoc.data() as {
          isActive:           boolean
          cadence:            string
          customIntervalDays?: number
          dayOfWeek?:         number
          nextDeliveryDate:   FirebaseFirestore.Timestamp
          lineItems:          Array<{ productId: string; qty: number; unitPrice: number }>
          notes?:             string
        }

        const deliveryDate     = schedule.nextDeliveryDate.toDate()
        const deliveryDateStr  = deliveryDate.toISOString().slice(0, 10)
        const groupId          = `ROUTE-${customerId.slice(0, 8)}-${deliveryDateStr}`
        const deliveryTs       = Timestamp.fromDate(deliveryDate)

        // ── Duplicate guard ───────────────────────────────────────────────
        const existing = await db
          .collection('orders')
          .where('groupId',   '==', groupId)
          .where('createdBy', '==', 'system')
          .limit(1)
          .get()

        if (!existing.empty) {
          logger.info(`scheduleRecurringOrders: skipping ${customerId} — orders already created for ${deliveryDateStr}`)
          skipped++
          continue
        }

        // ── Fetch customer name for notification ──────────────────────────
        const custSnap    = await db.collection('customers').doc(customerId).get()
        const customerName = (custSnap.data()?.name as string | undefined) ?? customerId

        // ── Create one order doc per line item ────────────────────────────
        const lineItems = schedule.lineItems ?? []
        if (lineItems.length === 0) {
          logger.warn(`scheduleRecurringOrders: ${customerId} has no line items — skipping`)
          skipped++
          continue
        }

        const batch = db.batch()
        let   groupTotal = 0

        for (const li of lineItems) {
          if (!li.productId || li.qty <= 0) continue
          const subtotal = li.qty * li.unitPrice
          groupTotal    += subtotal

          const orderRef = db.collection('orders').doc()
          batch.set(orderRef, {
            customerId,
            productId:       li.productId,
            quantity:        li.qty,
            unitPrice:       li.unitPrice,
            subtotal,
            deliveryFee:     0,
            total:           subtotal,
            deliveryTier:    'standard',
            upchargePercent: 0,
            status:          'pending',
            orderType:       'route',
            groupId,
            notes:           schedule.notes ?? '',
            fromRouteSchedule: true,
            createdBy:       'system',
            requestedAt:     FieldValue.serverTimestamp(),
            scheduledAt:     deliveryTs,
          })
        }

        // ── Advance nextDeliveryDate ──────────────────────────────────────
        const nextDate   = advanceDate(deliveryDate, schedule.cadence, schedule.customIntervalDays)
        const nextDateTs = Timestamp.fromDate(nextDate)

        batch.update(schedDoc.ref, { nextDeliveryDate: nextDateTs })

        // ── Dispatch notification ─────────────────────────────────────────
        const notifRef = db.collection('notifications').doc()
        batch.set(notifRef, {
          type:         'route_order_created',
          title:        `Route order created — ${customerName}`,
          body:         `Auto-generated ${lineItems.length} item(s) for ${customerName} on ${deliveryDateStr}`,
          customerId,
          groupId,
          total:        groupTotal,
          read:         false,
          createdAt:    FieldValue.serverTimestamp(),
          targetRoles:  ['admin', 'dispatch'],
        })

        await batch.commit()
        created++
        logger.info(`scheduleRecurringOrders: created orders for ${customerId} (delivery ${deliveryDateStr}), next=${nextDate.toISOString().slice(0, 10)}`)
      } catch (err) {
        errors++
        logger.error(`scheduleRecurringOrders: failed for customer ${customerId}`, err)
      }
    }

    logger.info(`scheduleRecurringOrders: done. created=${created} skipped=${skipped} errors=${errors}`)
  },
)

