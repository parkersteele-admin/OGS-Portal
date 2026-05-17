/**
 * src/components/payments/StripeProvider.tsx
 *
 * Wraps a subtree with the Stripe Elements provider.
 * Place this around any component that mounts a PaymentElement or CardElement.
 *
 * Usage:
 *   <StripeProvider clientSecret={invoice.stripeClientSecret}>
 *     <PaymentForm ... />
 *   </StripeProvider>
 */

import React from 'react'
import { Elements } from '@stripe/react-stripe-js'
import { stripePromise } from '../../lib/stripe'

interface StripeProviderProps {
  /** The PaymentIntent client_secret returned by the createStripePaymentIntent
   *  Cloud Function.  Required for PaymentElement to mount. */
  clientSecret: string
  children: React.ReactNode
}

const appearance: import('@stripe/stripe-js').Appearance = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#0066FF',
    colorBackground: '#ffffff',
    colorText: '#0A1B33',
    colorDanger: '#E24B4A',
    fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
    fontSizeBase: '14px',
    borderRadius: '8px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': {
      border: '1px solid #E0E0E0',
      boxShadow: 'none',
    },
    '.Input:focus': {
      border: '1px solid #0066FF',
      boxShadow: '0 0 0 3px rgba(0,102,255,0.15)',
      outline: 'none',
    },
    '.Label': {
      fontWeight: '500',
      color: '#555555',
      marginBottom: '6px',
    },
  },
}

export const StripeProvider: React.FC<StripeProviderProps> = ({
  clientSecret,
  children,
}) => (
  <Elements
    stripe={stripePromise}
    options={{ clientSecret, appearance }}
  >
    {children}
  </Elements>
)
