/**
 * functions/src/onOrderStatusChange.ts
 *
 * Firestore trigger — fires on any update to orders/{orderId}.
 * Handles status-based side effects for offRoute and addOn orders.
 */

import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

// TODO: when status changes to 'pending' and orderType === 'offRoute':
//   - notify dispatch (create a notification doc at /notifications)
//   - optionally send a push/email to the ops team

// TODO: when status changes to 'delivered':
//   - update a customer delivery history summary doc at
//     /customers/{customerId}/deliverySummary
//     (increment ordersDelivered, update lastDeliveredAt)

// TODO: gate: only act when status field actually changed (compare before/after)

export const onOrderStatusChange = functions.firestore
  .document('orders/{orderId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data()
    const after = change.after.data()

    if (before.status === after.status) return null // nothing changed

    functions.logger.info('onOrderStatusChange: stub — not yet implemented', {
      orderId: context.params.orderId,
      from: before.status,
      to: after.status,
      orderType: after.orderType,
    })

    // TODO: implement side effects here
    return null
  })
