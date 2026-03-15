import { loadStripe } from '@stripe/stripe-js'

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

if (!publishableKey) {
  console.warn('VITE_STRIPE_PUBLISHABLE_KEY is not set')
}

export const stripe = loadStripe(publishableKey ?? '')
