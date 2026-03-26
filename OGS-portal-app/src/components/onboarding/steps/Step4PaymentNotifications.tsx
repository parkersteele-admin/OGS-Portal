/**
 * src/components/onboarding/steps/Step4PaymentNotifications.tsx
 *
 * Onboarding Step 4 — Payment & Notifications.
 * Handles COD / Card / ACH / Net30 payment method selection,
 * billing email override, and notification preferences.
 */

import React, { useState } from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { STRIPE_PUBLISHABLE_KEY } from '../../../lib/env'
import { updateCompany, advanceSetupStep } from '../../../services/onboardingService'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { PaymentSetupForm } from '../PaymentSetupForm'
import { CreditApplicationForm } from '../CreditApplicationForm'
import { saveNotificationPrefs } from '../NotificationPrefs'
import { PwaInstallCard } from '../PwaInstallCard'
import type { Company, PaymentMethodType } from '../../../types/company'
import type { PaymentSetupData } from '../PaymentSetupForm'

const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null

interface Props {
  company: Company
  uid: string
  onNext: () => void
  onBack: () => void
  onSkip?: () => void
}

type PMCard = {
  value: PaymentMethodType
  title: string
  description: string
}

const PAYMENT_METHODS: PMCard[] = [
  { value: 'cod',   title: 'COD',                description: 'Pay at time of delivery' },
  { value: 'card',  title: 'Credit Card on File', description: 'Card saved, charged on delivery' },
  { value: 'ach',   title: 'ACH Autopay',         description: 'Bank account auto-debited on invoice date' },
  { value: 'net30', title: 'Net 30',              description: 'Invoiced monthly; requires credit approval' },
]

export const Step4PaymentNotifications: React.FC<Props> = ({
  company,
  uid,
  onNext,
  onBack,
  onSkip,
}) => {
  const companyId = company.companyId

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>(
    company.paymentMethod ?? null,
  )
  const [paymentSetupDone, setPaymentSetupDone] = useState(
    company.paymentMethod === 'cod' ||
    company.paymentMethod === 'net30' ||
    !!company.paymentMethod,
  )
  const [creditAppDone, setCreditAppDone] = useState(false)

  const [useDifferentBillingEmail, setUseDifferentBillingEmail] = useState(false)
  const [billingEmail, setBillingEmail] = useState(company.billingEmail ?? '')

  const [smsOptIn, setSmsOptIn] = useState(company.smsOptIn ?? false)
  const [smsPhone, setSmsPhone] = useState(company.smsPhone ?? '')
  const [smsAgreed, setSmsAgreed] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!paymentMethod) errs.paymentMethod = 'Please select a payment method.'
    if (paymentMethod === 'card' || paymentMethod === 'ach') {
      if (!paymentSetupDone) {
        errs.paymentSetup = 'Please complete your payment setup above.'
      }
    }
    if (paymentMethod === 'net30' && !creditAppDone) {
      errs.creditApp = 'Please submit your credit application above.'
    }
    if (useDifferentBillingEmail && !billingEmail.trim()) {
      errs.billingEmail = 'Billing email is required.'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handlePaymentComplete = async (data: PaymentSetupData) => {
    // In production, hand the stripePaymentMethodId to a Cloud Function
    // that attaches it to the Stripe Customer and saves it securely.
    // For now, just mark payment setup as done.
    void data
    setPaymentSetupDone(true)
  }

  const handleNext = async () => {
    if (!validate()) return
    setSubmitting(true)
    try {
      // Save SMS prefs if opted in
      if (smsOptIn) {
        const smsResult = await saveNotificationPrefs(
          companyId, uid, smsOptIn, smsPhone, smsAgreed,
        )
        if (!smsResult.valid) {
          setErrors({ sms: smsResult.error ?? 'SMS error' })
          setSubmitting(false)
          return
        }
      }

      await updateCompany(companyId, {
        paymentMethod,
        billingEmail: useDifferentBillingEmail ? billingEmail : company.billingEmail,
        smsOptIn,
        smsPhone: smsOptIn ? smsPhone : null,
      })
      await advanceSetupStep(companyId, 4)
      onNext()
    } catch {
      setErrors({ _form: 'Save failed. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ob-step">
      <h2 className="ob-step__heading">Payment &amp; Notifications</h2>
      {errors._form && <p className="ob-step__err" role="alert">{errors._form}</p>}

      {/* Payment method selection */}
      <section className="ob-step__section">
        <h3 className="ob-step__sub-heading">How would you like to pay?</h3>
        {errors.paymentMethod && (
          <p className="ob-step__err" role="alert">{errors.paymentMethod}</p>
        )}
        <div className="ob-step__pm-cards">
          {PAYMENT_METHODS.map(({ value, title, description }) => (
            <button
              key={value}
              type="button"
              className={`ob-step__pm-card${paymentMethod === value ? ' ob-step__pm-card--on' : ''}`}
              onClick={() => {
                setPaymentMethod(value)
                setPaymentSetupDone(value === 'cod' || value === 'net30')
              }}
              aria-pressed={paymentMethod === value}
            >
              <strong className="ob-step__pm-card__title">{title}</strong>
              <span className="ob-step__pm-card__desc">{description}</span>
            </button>
          ))}
        </div>

        {/* Card setup */}
        {paymentMethod === 'card' && !paymentSetupDone && (
          <div className="ob-step__pm-form">
            {stripePromise ? (
              <Elements stripe={stripePromise}>
                <PaymentSetupForm
                  variant="card"
                  onComplete={(data) => void handlePaymentComplete(data)}
                />
              </Elements>
            ) : (
              <p className="ob-step__notice">
                Stripe is not configured. Please contact support.
              </p>
            )}
          </div>
        )}
        {paymentMethod === 'card' && paymentSetupDone && (
          <p className="ob-step__success">✓ Card saved.</p>
        )}

        {/* ACH setup */}
        {paymentMethod === 'ach' && !paymentSetupDone && (
          <div className="ob-step__pm-form">
            {stripePromise ? (
              <Elements stripe={stripePromise}>
                <PaymentSetupForm
                  variant="ach"
                  onComplete={(data) => void handlePaymentComplete(data)}
                />
              </Elements>
            ) : (
              <p className="ob-step__notice">
                Stripe is not configured. Please contact support.
              </p>
            )}
          </div>
        )}
        {paymentMethod === 'ach' && paymentSetupDone && (
          <p className="ob-step__success">✓ ACH account saved.</p>
        )}

        {/* Net30 credit application */}
        {paymentMethod === 'net30' && !creditAppDone && (
          <div className="ob-step__pm-form">
            <p className="ob-step__notice ob-step__notice--info">
              Net 30 requires a credit application. Your account setup will proceed while
              our team reviews your application.
            </p>
            <CreditApplicationForm
              companyId={companyId}
              onComplete={() => setCreditAppDone(true)}
            />
          </div>
        )}
        {paymentMethod === 'net30' && creditAppDone && (
          <p className="ob-step__success">✓ Credit application submitted.</p>
        )}
        {errors.paymentSetup && (
          <p className="ob-step__err" role="alert">{errors.paymentSetup}</p>
        )}
        {errors.creditApp && (
          <p className="ob-step__err" role="alert">{errors.creditApp}</p>
        )}
      </section>

      {/* Billing Email */}
      <section className="ob-step__section">
        <h3 className="ob-step__sub-heading">Billing Email</h3>
        <p className="ob-step__desc">
          Invoices and statements will be sent to{' '}
          <strong>{company.billingEmail}</strong>.
        </p>
        <label className="ob-step__check-label">
          <input
            type="checkbox"
            checked={useDifferentBillingEmail}
            onChange={(e) => setUseDifferentBillingEmail(e.target.checked)}
          />
          Use a different billing email (e.g. AP department)
        </label>
        {useDifferentBillingEmail && (
          <Input
            label="Billing Email"
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            error={errors.billingEmail}
            required
          />
        )}
      </section>

      {/* Notification Prefs */}
      <section className="ob-step__section">
        <h3 className="ob-step__sub-heading">Notification Preferences</h3>

        {/* Email — always on */}
        <div className="notif-prefs__section">
          <label className="notif-prefs__locked-label">
            <input type="checkbox" checked readOnly disabled />
            Invoice and account notices sent to{' '}
            {useDifferentBillingEmail ? billingEmail : company.billingEmail} — always
            enabled.
          </label>
        </div>

        {/* SMS opt-in */}
        <div className="notif-prefs__section">
          <div className="notif-prefs__sms-header">
            <span className="notif-prefs__heading">Text Message Notifications</span>
            <label className="ob-step__check-label">
              <input
                type="checkbox"
                role="switch"
                checked={smsOptIn}
                onChange={(e) => {
                  setSmsOptIn(e.target.checked)
                  if (!e.target.checked) setSmsAgreed(false)
                }}
              />
              {smsOptIn ? 'Enabled' : 'Disabled'}
            </label>
          </div>
          {smsOptIn && (
            <div className="notif-prefs__sms-body">
              <Input
                label="Mobile Number"
                type="tel"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                error={errors.sms}
                required
                autoComplete="tel"
              />
              <p className="notif-prefs__disclosure">
                Receive delivery notifications, order confirmations, and low-cylinder alerts
                by text. Message &amp; data rates may apply. Reply{' '}
                <strong>STOP</strong> at any time to unsubscribe.
              </p>
              <label className="notif-prefs__consent-label">
                <input
                  type="checkbox"
                  checked={smsAgreed}
                  onChange={(e) => setSmsAgreed(e.target.checked)}
                />
                I agree to receive text messages from Ohio Gas Supply Co.
              </label>
            </div>
          )}
        </div>

        {/* PWA Install card */}
        <div className="notif-prefs__section">
          <PwaInstallCard uid={uid} companyId={companyId} />
        </div>
      </section>

      <div className="ob-step__actions">
        <Button variant="ghost" size="lg" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => void handleNext()}
          loading={submitting}
          className="ob-step__next"
        >
          Next: Review
        </Button>
      </div>
      {onSkip && (
        <div className="ob-step__skip">
          <button type="button" className="ob-step__skip-btn" onClick={onSkip}>
            Skip this step for now
          </button>
        </div>
      )}
    </div>
  )
}
