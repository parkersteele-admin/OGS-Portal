/**
 * src/components/onboarding/PaymentSetupForm.tsx
 *
 * Stripe Elements card input or ACH bank account input.
 * Used inside Step 4 when 'card' or 'ach' payment method is selected.
 */

import React, { useState } from 'react'
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Input } from '../ui/Input'

interface Props {
  variant: 'card' | 'ach'
  onComplete: (data: PaymentSetupData) => void
}

export interface PaymentSetupData {
  variant: 'card' | 'ach'
  signedBy: string
  signedAt: string
  // card — stripe paymentMethod created client-side
  stripePaymentMethodId?: string
  // ach
  bankName?: string
  routingNumber?: string
  accountNumber?: string
  accountName?: string
}

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: '16px',
      color: '#111827',
      '::placeholder': { color: '#9ca3af' },
    },
    invalid: { color: '#dc2626' },
  },
}

export const PaymentSetupForm: React.FC<Props> = ({ variant, onComplete }) => {
  const stripe = useStripe()
  const elements = useElements()

  const [authorized, setAuthorized] = useState(false)
  const [signedBy, setSignedBy] = useState('')
  const [signedAt, setSignedAt] = useState('')

  // ACH fields
  const [bankName, setBankName] = useState('')
  const [routingNumber, setRoutingNumber] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!authorized) errs.authorized = 'You must authorize this payment method.'
    if (!signedBy.trim()) errs.signedBy = 'Typed signature is required.'
    if (!signedAt.trim()) errs.signedAt = 'Date is required.'
    if (variant === 'ach') {
      if (!bankName.trim()) errs.bankName = 'Bank name is required.'
      if (!/^\d{9}$/.test(routingNumber)) errs.routingNumber = 'Enter a valid 9-digit routing number.'
      if (!accountNumber.trim()) errs.accountNumber = 'Account number is required.'
      if (!accountName.trim()) errs.accountName = 'Account name is required.'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)

    try {
      if (variant === 'card') {
        if (!stripe || !elements) {
          setErrors({ _form: 'Stripe has not loaded yet. Please wait.' })
          setSaving(false)
          return
        }
        const cardElement = elements.getElement(CardElement)
        if (!cardElement) {
          setErrors({ _form: 'Card input not found.' })
          setSaving(false)
          return
        }
        const { paymentMethod, error } = await stripe.createPaymentMethod({
          type: 'card',
          card: cardElement,
        })
        if (error) {
          setErrors({ _form: error.message ?? 'Card error' })
          setSaving(false)
          return
        }
        onComplete({
          variant: 'card',
          stripePaymentMethodId: paymentMethod?.id,
          signedBy,
          signedAt,
        })
      } else {
        onComplete({
          variant: 'ach',
          bankName,
          routingNumber,
          accountNumber,
          accountName,
          signedBy,
          signedAt,
        })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pmt-setup">
      {errors._form && <p className="ob-step__err" role="alert">{errors._form}</p>}

      {variant === 'card' ? (
        <div className="ui-field pmt-setup__card-wrap">
          <label className="ui-field__label">Card Details</label>
          <div className="pmt-setup__card-element">
            <CardElement options={CARD_ELEMENT_OPTIONS} />
          </div>
        </div>
      ) : (
        <div className="pmt-setup__ach">
          <Input
            label="Bank Name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            error={errors.bankName}
            required
          />
          <Input
            label="ABA Routing Number"
            value={routingNumber}
            onChange={(e) => setRoutingNumber(e.target.value)}
            error={errors.routingNumber}
            hint="9-digit routing number from the bottom of a check."
            maxLength={9}
            inputMode="numeric"
            required
          />
          <Input
            label="Account Number"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            error={errors.accountNumber}
            required
          />
          <Input
            label="Account Name"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            error={errors.accountName}
            required
          />
        </div>
      )}

      <label className="ob-step__check-label">
        <input
          type="checkbox"
          checked={authorized}
          onChange={(e) => setAuthorized(e.target.checked)}
          aria-invalid={!!errors.authorized}
        />
        {variant === 'card'
          ? 'I authorize Ohio Gas Supply Co. to charge the card above for deliveries.'
          : 'I authorize Ohio Gas Supply Co. to debit the account above on invoice date.'}
      </label>
      {errors.authorized && (
        <span className="ui-field__error" role="alert">{errors.authorized}</span>
      )}

      <Input
        label="Typed Signature"
        value={signedBy}
        onChange={(e) => setSignedBy(e.target.value)}
        error={errors.signedBy}
        placeholder="Type your full legal name"
        required
      />
      <Input
        label="Date"
        type="date"
        value={signedAt}
        onChange={(e) => setSignedAt(e.target.value)}
        error={errors.signedAt}
        required
      />

      <button
        type="button"
        className="ui-btn ui-btn--primary ui-btn--md pmt-setup__save-btn"
        onClick={() => void handleSave()}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save Payment Method'}
      </button>
    </div>
  )
}
