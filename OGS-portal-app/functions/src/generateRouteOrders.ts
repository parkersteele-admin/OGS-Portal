/**
 * functions/src/generateRouteOrders.ts
 *
 * Pubsub trigger — runs daily at 6 am ET.
 * Generates the next order doc for every active route schedule.
 */

import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

// TODO: query all active routeSchedules where nextDeliveryDate <= tomorrow
// TODO: for each, create an order doc with orderType: 'route'
//   - customerId, lineItems (one order doc per line item), status: 'pending'
//   - deliveryTier: 'standard' by default (dispatch can change)
//   - tag all docs with groupId = 'ROUTE-' + customerId.slice(0,6) + '-' + date
// TODO: update nextDeliveryDate on the schedule doc (cadence + dayOfWeek logic)
// TODO: if customIntervalDays is set, advance by that many days instead

export const generateRouteOrders = functions.pubsub
  .schedule('0 6 * * *')
  .timeZone('America/New_York')
  .onRun(async (_context) => {
    // TODO: implement
    functions.logger.info('generateRouteOrders: stub — not yet implemented')
  })
