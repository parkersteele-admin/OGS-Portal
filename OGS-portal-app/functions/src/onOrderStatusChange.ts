/**
 * functions/src/onOrderStatusChange.ts
 *
 * Firestore trigger — fires on any update to orders/{orderId}.
 * Handles status-based side effects for offRoute and addOn orders.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'

// TODO: when status changes to 'pending' and orderType === 'offRoute':
//   - notify dispatch (create a notification doc at /notifications)
//   - optionally send a push/email to the ops team

// TODO: when status changes to 'delivered':
//   - update a customer delivery history summary doc at
//     /customers/{customerId}/deliverySummary
//     (increment ordersDelivered, update lastDeliveredAt)

// TODO: gate: only act when status field actually changed (compare before/after)

export const onOrderStatusChange = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data?.before.data()
  const after  = event.data?.after.data()

  if (!before || !after) return
  if (before.status === after.status) return // nothing changed

  logger.info('onOrderStatusChange: stub — not yet implemented', {
    orderId: event.params.orderId,
    from: before.status,
    to: after.status,
    orderType: after.orderType,
  })

  // TODO: implement side effects here
})
