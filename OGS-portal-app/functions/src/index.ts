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
 *    generateQuotePdf   — Build PDF quote, upload to Storage, email to recipient, return signed URL
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
export { adminCreateUser, adminDeleteUser, adminUpdateUserCompany } from './adminCreateUser'
export { stripeWebhook }                                          from './webhooks/stripeWebhook'
export { createStripePaymentIntent }                              from './stripe'
export { createSetupIntent, savePaymentMethod, removePaymentMethod } from './stripe/index'
export { onOrderComplete }                                        from './orders'
export { onDeliveryComplete }                                     from './triggers/onDeliveryComplete'
export { onRunCreated }                                           from './triggers/onRunCreated'
export { geocodeCustomerOnCreate, geocodeCustomerOnUpdate }       from './triggers/geocodeCustomer'
export { processAutopay }         from './scheduled/processAutopay'
export { lowLevelAlertCheck }     from './scheduled/lowLevelAlertCheck'
export { overdueInvoiceCheck }    from './scheduled/overdueInvoiceCheck'
export { certExpiryCheck }        from './scheduled/certExpiryCheck'
export { scheduleRecurringOrders } from './scheduleRecurringOrders'
export { generateInvoicePdf, generateQuotePdf, optimizeRoute, backfillGeocodeCustomers, backfillMissingLeads } from './callables'
export { optimizeOrderRoute }                                     from './maps/optimizeRoute'
export { generateRunManifest }                                    from './generateRunManifest'
export { onCylinderFlagged }                                      from './onCylinderFlagged'

// Onboarding callables
export {
  checkForExistingCompany,
  setCompanyClaim,
  revokeCompanyClaim,
  requestToJoinCompany,
  approveJoinRequest,
  denyJoinRequest,
  inviteTeamMember,
  acceptInvite,
  adminAssignUser,
} from './onboarding'

// Onboarding triggers
export { onCreditApplicationSubmitted } from './triggers/onCreditApplicationSubmitted'
export { onQuoteRequested }             from './triggers/onQuoteRequested'
export { onQuoteSent }                  from './triggers/onQuoteSent'

// Sales Pipeline triggers + callables + scheduled
export { onCustomerCreated }            from './triggers/onCustomerCreated'
export { onCustomerUpdatedPipeline }    from './triggers/onCustomerUpdatedPipeline'
export {
  calculateLeadValue,
  logLeadActivity,
  advanceLeadStage,
  markLeadWon,
  markLeadLost,
  assignLead,
  scheduleFollowUp,
}                                       from './pipeline'
export { checkStaleLeads }              from './scheduled/checkStaleLeads'
export { sendFollowUpReminders }        from './scheduled/sendFollowUpReminders'
export { alertUnassignedLead }          from './scheduled/alertUnassignedLead'

export const healthCheck = onRequest((_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})


