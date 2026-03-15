/**
 * src/lib/stripe.ts
 *
 * Lazy-initialises the Stripe.js client.  loadStripe() is deferred until the
 * promise is first awaited — it does NOT execute on module import.
 *
 * Usage:
 *   import { stripePromise } from '../lib/stripe'
 *   <Elements stripe={stripePromise} ...>
 */

import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { STRIPE_PUBLISHABLE_KEY } from './env'

// loadStripe caches the result internally so this is safe to reference anywhere.
// Resolves to null when the key is absent (dev without Stripe configured) —
// the Elements provider mounts cleanly but payments won't process.
export const stripePromise: Promise<Stripe | null> = STRIPE_PUBLISHABLE_KEY
  ? loadStripe(STRIPE_PUBLISHABLE_KEY)
  : Promise.resolve(null)
