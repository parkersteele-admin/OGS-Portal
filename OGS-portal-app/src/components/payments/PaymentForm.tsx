/**
 * src/components/payments/PaymentForm.tsx
 *
 * Full payment form using Stripe's PaymentElement (handles card + ACH +
 * wallets automatically based on the PaymentIntent's payment_method_types).
 *
 * Must be mounted inside a <StripeProvider clientSecret={...}> tree.
 *
 * Usage:
 *   <StripeProvider clientSecret={clientSecret}>
 *     <PaymentForm
 *       invoiceId={invoice.id}
 *       amountCents={invoice.totalCents}
 *       onSuccess={() => navigate('/portal/invoices')}
 *     />
 *   </StripeProvider>
 */

import React, { useState } from 'react'
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'
import { Button } from '../ui/Button'
import { formatCurrency } from '../../utils/format'

interface PaymentFormProps {
  invoiceId: string
  /** Total amount in cents (for display only — actual charge is on the PI). */
  amountCents: number
  /** Called after the payment is confirmed successfully. */
  onSuccess?: () => void
  /** Called if the user cancels. */
  onCancel?: () => void
}

export const PaymentForm: React.FC<PaymentFormProps> = ({
  invoiceId,
  amountCents,
  onSuccess,
  onCancel,
}) => {
  const stripe   = useStripe()
  const elements = useElements()

  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [ready, setReady]         = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setError(null)
    setLoading(true)

    // Validate the PaymentElement fields client-side before confirming.
    const { error: submitError } = await elements.submit()
    if (submitError) {
      setError(submitError.message ?? 'Please check your payment details.')
      setLoading(false)
      return
    }

    // Confirm the PaymentIntent.  Stripe handles 3DS authentication flows.
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Return URL after redirect-based payment methods (e.g. bank redirect).
        return_url: `${window.location.origin}/portal/invoices?paid=${invoiceId}`,
      },
      // Don't redirect for card payments — handle the result inline.
      redirect: 'if_required',
    })

    if (confirmError) {
      if (confirmError.type === 'card_error' || confirmError.type === 'validation_error') {
        setError(confirmError.message ?? 'Your payment could not be processed.')
      } else {
        setError('An unexpected error occurred. Please try again.')
      }
      setLoading(false)
      return
    }

    // Payment succeeded (no redirect required).
    setLoading(false)
    onSuccess?.()
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Stripe PaymentElement — renders card, ACH, wallets as available */}
        <div style={{ minHeight: ready ? 'auto' : '120px' }}>
          <PaymentElement
            onReady={() => setReady(true)}
            options={{
              layout: 'tabs',
              paymentMethodOrder: ['card', 'us_bank_account'],
            }}
          />
        </div>

        {/* Inline error */}
        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              fontSize: '13px',
              color: 'var(--color-danger)',
            }}
          >
            {error}
          </div>
        )}

        {/* Action row */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={loading}
            disabled={!stripe || !ready}
          >
            Pay {formatCurrency(amountCents / 100)}
          </Button>
        </div>
      </div>
    </form>
  )
}
