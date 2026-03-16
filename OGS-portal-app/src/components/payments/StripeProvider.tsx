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
    colorPrimary: '#E87722',
    colorBackground: '#ffffff',
    colorText: '#222222',
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
      border: '1px solid #E87722',
      boxShadow: '0 0 0 3px rgba(232,119,34,0.15)',
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
