/**
 * functions/src/stripe/savePaymentMethod.ts
 *
 * savePaymentMethod — Callable
 *
 * Called by the frontend after `stripe.confirmSetup()` succeeds.
 * Retrieves the confirmed PaymentMethod from Stripe, stores it in Firestore
 * under /customers/{customerId}/paymentMethods/{id}, and optionally sets it
 * as the customer's default autopay method.
 *
 * Input:  {
 *   setupIntentId: string   — the SetupIntent.id after confirmation
 *   setAsDefault:  boolean  — mark as default + enable autopay
 *   customerId?:   string   — admin/dispatch override
 * }
 * Output: { paymentMethodId: string }
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import Stripe from 'stripe'
import { db, FieldValue, Timestamp } from '../admin'
import { STRIPE_SECRET_KEY, requireSecret } from '../config'

export const savePaymentMethod = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.')
    }

    const callerRole = request.auth.token.role as string
    const data = request.data as {
      setupIntentId: string
      setAsDefault?: boolean
      customerId?: string
    }

    if (typeof data.setupIntentId !== 'string' || !data.setupIntentId) {
      throw new HttpsError('invalid-argument', 'setupIntentId is required.')
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

    const stripeKey = requireSecret(STRIPE_SECRET_KEY.value(), 'STRIPE_SECRET_KEY')
    const stripe    = new Stripe(stripeKey)

    // ── Retrieve SetupIntent to get the confirmed PaymentMethod ──────────────
    const setupIntent = await stripe.setupIntents.retrieve(data.setupIntentId)

    if (setupIntent.status !== 'succeeded') {
      throw new HttpsError(
        'failed-precondition',
        `SetupIntent status is "${setupIntent.status}" — must be "succeeded".`,
      )
    }

    const pmId = typeof setupIntent.payment_method === 'string'
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id

    if (!pmId) {
      throw new HttpsError('internal', 'No payment method on SetupIntent.')
    }

    // Guard: verify this SetupIntent belongs to the correct Stripe customer
    const customerSnap = await db.collection('customers').doc(customerId).get()
    const stripeCustomerId = customerSnap.data()?.stripeCustomerId as string | undefined
    if (!stripeCustomerId || setupIntent.customer !== stripeCustomerId) {
      throw new HttpsError('permission-denied', 'SetupIntent does not belong to this customer.')
    }

    // ── Retrieve the full PaymentMethod ──────────────────────────────────────
    const pm = await stripe.paymentMethods.retrieve(pmId)

    // ── Build Firestore payload ───────────────────────────────────────────────
    type PmDoc = {
      customerId: string
      stripePaymentMethodId: string
      type: 'card' | 'us_bank_account'
      last4: string
      isDefault: boolean
      createdAt: ReturnType<typeof Timestamp.now>
    } & Record<string, unknown>

    const isDefault = data.setAsDefault === true

    const pmDoc: PmDoc = {
      customerId,
      stripePaymentMethodId: pmId,
      type:      pm.type as 'card' | 'us_bank_account',
      last4:     pm.card?.last4 ?? pm.us_bank_account?.last4 ?? '????',
      isDefault,
      createdAt: Timestamp.now(),
    }

    if (pm.type === 'card' && pm.card) {
      pmDoc.brand    = pm.card.brand
      pmDoc.expMonth = pm.card.exp_month
      pmDoc.expYear  = pm.card.exp_year
    }

    if (pm.type === 'us_bank_account' && pm.us_bank_account) {
      pmDoc.bankName    = pm.us_bank_account.bank_name
      pmDoc.accountType = pm.us_bank_account.account_type
    }

    // ── Idempotency: check if already saved ───────────────────────────────────
    const existing = await db
      .collection(`customers/${customerId}/paymentMethods`)
      .where('stripePaymentMethodId', '==', pmId)
      .limit(1)
      .get()

    if (!existing.empty) {
      return { paymentMethodId: existing.docs[0].id }
    }

    // ── If setting as default, unset previous default ────────────────────────
    if (isDefault) {
      const prevDefaults = await db
        .collection(`customers/${customerId}/paymentMethods`)
        .where('isDefault', '==', true)
        .get()

      const batch = db.batch()
      for (const d of prevDefaults.docs) {
        batch.update(d.ref, { isDefault: false })
      }
      await batch.commit()
    }

    // ── Save to Firestore ────────────────────────────────────────────────────
    const pmRef = await db
      .collection(`customers/${customerId}/paymentMethods`)
      .add(pmDoc)

    // ── Attach to Stripe customer as default if requested ────────────────────
    if (isDefault) {
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: pmId },
      })
      await db.collection('customers').doc(customerId).update({
        autopayEnabled:          true,
        autopayStripePaymentMethodId: pmId,
        updatedAt:               FieldValue.serverTimestamp(),
      })
    }

    return { paymentMethodId: pmRef.id }
  },
)
