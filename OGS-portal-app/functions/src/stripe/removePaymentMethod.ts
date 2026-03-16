/**
 * functions/src/stripe/removePaymentMethod.ts
 *
 * removePaymentMethod — Callable
 *
 * Detaches a PaymentMethod from the Stripe Customer, deletes it from Firestore,
 * and clears autopay on the customer if this was the default method.
 *
 * Input:  {
 *   paymentMethodId: string,  — Firestore document ID (NOT stripePaymentMethodId)
 *   customerId?:     string   — admin/dispatch override
 * }
 * Output: { success: true }
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import Stripe from 'stripe'
import { db, FieldValue } from '../admin'
import { STRIPE_SECRET_KEY, requireSecret } from '../config'

export const removePaymentMethod = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.')
    }

    const callerRole = request.auth.token.role as string
    const data = request.data as {
      paymentMethodId: string
      customerId?: string
    }

    if (typeof data.paymentMethodId !== 'string' || !data.paymentMethodId) {
      throw new HttpsError('invalid-argument', 'paymentMethodId is required.')
    }

    // ── Resolve customer ─────────────────────────────────────────────────────
    let customerId: string

    if (['admin', 'dispatch'].includes(callerRole) && data.customerId) {
      customerId = data.customerId
    } else if (callerRole === 'customer') {
      const userSnap = await db.collection('users').doc(request.auth.uid).get()
      const linkedId = userSnap.data()?.customerId as string | undefined
      if (!linkedId) {
        throw new HttpsError('failed-precondition', 'User not linked to a customer.')
      }
      customerId = linkedId
    } else {
      throw new HttpsError('permission-denied', 'Insufficient permissions.')
    }

    // ── Fetch the payment method doc ─────────────────────────────────────────
    const pmRef  = db.doc(`customers/${customerId}/paymentMethods/${data.paymentMethodId}`)
    const pmSnap = await pmRef.get()

    if (!pmSnap.exists) {
      throw new HttpsError('not-found', 'Payment method not found.')
    }

    const pmData = pmSnap.data()!

    // Verify the doc belongs to the resolved customer (defence in depth)
    if (pmData.customerId !== customerId) {
      throw new HttpsError('permission-denied', 'Payment method does not belong to this customer.')
    }

    const stripeKey = requireSecret(STRIPE_SECRET_KEY.value(), 'STRIPE_SECRET_KEY')
    const stripe    = new Stripe(stripeKey)

    // ── Detach from Stripe ───────────────────────────────────────────────────
    try {
      await stripe.paymentMethods.detach(pmData.stripePaymentMethodId)
    } catch (err: unknown) {
      // If already detached (e.g. idempotent retry) continue silently.
      const stripeErr = err as { code?: string }
      if (stripeErr.code !== 'payment_method_not_attached') {
        throw new HttpsError('internal', `Failed to detach payment method: ${String(err)}`)
      }
    }

    // ── Delete from Firestore ────────────────────────────────────────────────
    await pmRef.delete()

    // ── If this was the default: clear autopay on the customer ───────────────
    if (pmData.isDefault) {
      await db.collection('customers').doc(customerId).update({
        autopayEnabled:              false,
        autopayStripePaymentMethodId: FieldValue.delete(),
        updatedAt:                   FieldValue.serverTimestamp(),
      })

      // Also clear the Stripe customer's default payment method
      const customerSnap = await db.collection('customers').doc(customerId).get()
      const stripeCustomerId = customerSnap.data()?.stripeCustomerId as string | undefined
      if (stripeCustomerId) {
        await stripe.customers.update(stripeCustomerId, {
          invoice_settings: { default_payment_method: '' },
        })
      }

      // Promote the next saved method (lowest createdAt) to default if any remain
      const remaining = await db
        .collection(`customers/${customerId}/paymentMethods`)
        .orderBy('createdAt', 'asc')
        .limit(1)
        .get()

      if (!remaining.empty) {
        await remaining.docs[0].ref.update({ isDefault: true })
      }
    }

    return { success: true }
  },
)
