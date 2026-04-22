/**
 * functions/src/stripe/createSetupIntent.ts
 *
 * createSetupIntent — Callable
 *
 * Creates a Stripe SetupIntent for saving a payment method (card or ACH).
 * Lazily creates a Stripe Customer record and persists the stripeCustomerId
 * back to Firestore so subsequent calls reuse the same Stripe customer.
 *
 * Input:  {} (no params — caller identity from request.auth)
 * Output: { clientSecret: string }
 *
 * Auth:   portal customer roles (admin/dispatch may call on behalf of a customer
 *         by passing an optional { customerId } override)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import Stripe from 'stripe'
import { db, FieldValue } from '../admin'
import { STRIPE_SECRET_KEY, requireSecret } from '../config'

export const createSetupIntent = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.')
    }

    const callerRole = request.auth.token.role as string
    const data       = request.data as { customerId?: string }

    // Resolve which customer this SetupIntent is for.
    // Admins/dispatch may pass an explicit customerId; customers use their own.
    let customerId: string

    if (['admin', 'dispatch'].includes(callerRole) && data.customerId) {
      customerId = data.customerId
    } else if (['customer', 'owner', 'manager', 'billing', 'delivery', 'viewer'].includes(callerRole)) {
      const linkedId =
        (request.auth.token.companyId as string | undefined)
        || (request.auth.token.customerId as string | undefined)
      if (!linkedId) {
        const uid = request.auth.uid
        const userSnap = await db.collection('users').doc(uid).get()
        if (!userSnap.exists) {
          throw new HttpsError('not-found', 'User document not found.')
        }
        const fallbackId =
          (userSnap.data()?.companyId as string | undefined)
          || (userSnap.data()?.customerId as string | undefined)
        if (!fallbackId) {
          throw new HttpsError(
            'failed-precondition',
            'Your account is not linked to a customer record.',
          )
        }
        customerId = fallbackId
      } else {
        customerId = linkedId
      }
    } else {
      throw new HttpsError('permission-denied', 'Insufficient permissions.')
    }

    // Fetch customer Firestore doc
    const customerSnap = await db.collection('customers').doc(customerId).get()
    if (!customerSnap.exists) {
      throw new HttpsError('not-found', `Customer ${customerId} not found.`)
    }
    const customer = customerSnap.data()!

    const stripeKey = requireSecret(STRIPE_SECRET_KEY.value(), 'STRIPE_SECRET_KEY')
    const stripe    = new Stripe(stripeKey)

    // ── Ensure Stripe Customer exists ────────────────────────────────────────
    let stripeCustomerId = customer.stripeCustomerId as string | undefined

    if (!stripeCustomerId) {
      const stripeCustomer = await stripe.customers.create({
        email:    customer.email,
        name:     customer.name,
        phone:    customer.phone,
        address:  {
          line1:   customer.address,
          city:    customer.city,
          state:   customer.state,
          postal_code: customer.zip,
          country: 'US',
        },
        metadata: { firestoreCustomerId: customerId },
      })

      stripeCustomerId = stripeCustomer.id

      // Persist so we never create a duplicate
      await db.collection('customers').doc(customerId).update({
        stripeCustomerId,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    // ── Create SetupIntent ───────────────────────────────────────────────────
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ['card', 'us_bank_account'],
      usage: 'off_session', // needed for autopay (charging without user present)
      metadata: { firestoreCustomerId: customerId },
    })

    return { clientSecret: setupIntent.client_secret! }
  },
)
