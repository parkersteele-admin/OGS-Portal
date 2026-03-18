/**
 * functions/src/scheduleRecurringOrders.ts
 *
 * Pub/Sub scheduled function that runs every 24 hours to auto-create the next
 * order document for any active recurring order whose nextDeliveryDate is
 * within the look-ahead window (default: 3 days).
 *
 * TODO — Implementation checklist:
 *
 *  1. Query Firestore for all orders where:
 *       isRecurring == true
 *       recurringSchedule.active == true
 *       recurringSchedule.nextDeliveryDate <= now + LOOKAHEAD_DAYS
 *
 *  2. For each matched order:
 *     a. Check that a duplicate hasn't already been created for this window
 *        (e.g. query orders with parentOrderId == order.id AND
 *         requestedDeliveryDate == nextDeliveryDate).
 *     b. Create a new order document with:
 *          status: 'submitted'
 *          lineItems: copied from the source order
 *          notes: source notes
 *          requestedDeliveryDate: nextDeliveryDate
 *          isRecurring: false            (the child order is not itself recurring)
 *          parentOrderId: source order id
 *          createdBy: 'system'
 *          submittedAt: now()
 *     c. Advance nextDeliveryDate on the source order's recurringSchedule:
 *          weekly   → +7 days
 *          biweekly → +14 days
 *          monthly  → +1 calendar month
 *          custom   → +customIntervalDays days
 *     d. If the new nextDeliveryDate > endDate (and endDate != null),
 *        set recurringSchedule.active = false.
 *     e. Write a notification document to /notifications/{auto-id} targeting
 *        the dispatch team (targetRoles: ['admin', 'dispatch']).
 *
 *  3. Error handling:
 *     - Wrap each order's processing in a try/catch so one failure doesn't
 *       abort the rest of the batch.
 *     - Log errors with the order ID for operational visibility.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { db } from './admin'

/** How many days ahead to look for upcoming deliveries. */
const LOOKAHEAD_DAYS = 3

export const scheduleRecurringOrders = onSchedule(
  {
    schedule:  'every 24 hours',
    timeZone:  'America/New_York',
    memory:    '256MiB',
  },
  async () => {
    const now          = new Date()
    const lookAheadMs  = LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000
    const cutoff       = new Date(now.getTime() + lookAheadMs)

    // TODO: implement the query + order creation logic described above.
    // Example query skeleton (uncomment and implement):
    //
    // const { Timestamp, FieldValue } = await import('firebase-admin/firestore')
    // const snap = await db
    //   .collection('orders')
    //   .where('isRecurring', '==', true)
    //   .where('recurringSchedule.active', '==', true)
    //   .where('recurringSchedule.nextDeliveryDate', '<=', Timestamp.fromDate(cutoff))
    //   .get()
    //
    // for (const orderDoc of snap.docs) {
    //   try {
    //     const order = orderDoc.data()
    //     // ... create child order, advance nextDeliveryDate, handle end date
    //   } catch (err) {
    //     console.error(`scheduleRecurringOrders: failed for order ${orderDoc.id}`, err)
    //   }
    // }

    console.log(`scheduleRecurringOrders: stub executed. Cutoff = ${cutoff.toISOString()}`)
  },
)
