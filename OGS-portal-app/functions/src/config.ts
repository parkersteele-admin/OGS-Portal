/**
 * functions/src/config.ts
 *
 * Firebase Secret references for ogs-portal.
 *
 * Before deploying, set each secret once:
 *   firebase functions:secrets:set STRIPE_SECRET_KEY
 *   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 *   firebase functions:secrets:set SENDGRID_API_KEY
 *   firebase functions:secrets:set GOOGLE_MAPS_SERVER_KEY
 *
 * Useful commands:
 *   firebase functions:secrets:get              — list secret names
 *   firebase functions:secrets:access <NAME>    — view the latest version
 *   firebase functions:secrets:destroy <NAME>   — permanently remove
 *
 * Secrets are bound to functions via the `secrets` array in each function's
 * options object.  The value is only available at runtime inside the handler
 * via `SECRET_NAME.value()`.  Calling `.value()` outside a handler throws.
 */

import { defineSecret } from 'firebase-functions/params'

export const STRIPE_SECRET_KEY     = defineSecret('STRIPE_SECRET_KEY')
export const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')
export const GOOGLE_MAPS_KEY       = defineSecret('GOOGLE_MAPS_SERVER_KEY')

/**
 * Asserts that a secret value is non-empty.
 * Call this at the top of every handler that depends on a secret so that a
 * missing secret surfaces as a clear error rather than a cryptic downstream
 * failure.
 *
 * @example
 *   const key = requireSecret(STRIPE_SECRET_KEY.value(), 'STRIPE_SECRET_KEY')
 */
export function requireSecret(value: string, name: string): string {
  if (!value) {
    throw new Error(
      `Required secret "${name}" is not configured.\n` +
      `Run: firebase functions:secrets:set ${name}`,
    )
  }
  return value
}
