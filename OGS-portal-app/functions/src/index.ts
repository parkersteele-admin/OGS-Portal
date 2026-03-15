/**
 * functions/src/index.ts
 *
 * Barrel that exports every Cloud Function for ogs-portal.
 *
 * Function inventory:
 *
 *  Auth / users
 *    onUserCreated       — Firestore trigger: stamp role claim on new user doc
 *    onUserRoleUpdated   — Firestore trigger: sync role claim on role change
 *    setUserRole         — Callable (admin-only): change a user's role
 *
 *  Payments
 *    stripeWebhook             — HTTPS: receive signed Stripe events
 *    createStripePaymentIntent — Callable: create PaymentIntent for an invoice
 *
 *  Order lifecycle
 *    onOrderComplete    — Firestore trigger: draft invoice + confirmation email
 *    onDeliveryComplete — Firestore trigger: complete order + run on last stop
 *
 *  Scheduled
 *    processAutopay      — Daily 02:00 ET: charge overdue autopay invoices
 *    lowLevelAlertCheck  — Daily 06:00 ET: notify on low tank levels
 *    certExpiryCheck     — Weekly Mon 07:00 ET: alert on upcoming inspections
 *
 *  Callables
 *    generateInvoicePdf — Build PDF invoice, upload to Storage, return signed URL
 *    optimizeRoute      — Reorder run stops via Google Maps Routes API
 *
 *  Utility
 *    healthCheck — Simple HTTP health probe
 *
 * The `import './admin'` side-effect ensures the Admin SDK is initialised
 * before any sub-module's module-level code runs.
 */

import './admin'
import { onRequest } from 'firebase-functions/v2/https'

export { onUserCreated, onUserRoleUpdated, setUserRole }          from './auth'
export { stripeWebhook }                                          from './webhooks/stripeWebhook'
export { createStripePaymentIntent }                              from './stripe'
export { createSetupIntent, savePaymentMethod, removePaymentMethod } from './stripe/index'
export { onOrderComplete }                                        from './orders'
export { onDeliveryComplete }                                     from './triggers/onDeliveryComplete'
export { geocodeCustomerOnCreate, geocodeCustomerOnUpdate }       from './triggers/geocodeCustomer'
export { processAutopay }         from './scheduled/processAutopay'
export { lowLevelAlertCheck }     from './scheduled/lowLevelAlertCheck'
export { overdueInvoiceCheck }    from './scheduled/overdueInvoiceCheck'
export { certExpiryCheck }        from './scheduled/certExpiryCheck'
export { generateInvoicePdf, optimizeRoute }                      from './callables'

export const healthCheck = onRequest((_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})


