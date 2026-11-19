/**
 * functions/src/admin.ts
 *
 * Initialises the Firebase Admin SDK once.  Every other module imports
 * `db` (and storage, auth) from here so there is exactly one app instance.
 *
 * Node's module cache guarantees this file runs at most once per process,
 * even when multiple modules import it.
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { getAuth } from 'firebase-admin/auth'
import { setGlobalOptions } from 'firebase-functions/v2'
import { RESEND_API_KEY } from './config'

// Every function gets the Resend key from Secret Manager. ~26 modules send
// email through sendEmail(), which reads process.env.RESEND_API_KEY; binding
// it globally means no function depends on a post-deploy env-var patch.
// Functions that declare their own `secrets` must include RESEND_API_KEY too
// if they send email (function-level secrets replace this list).
setGlobalOptions({ secrets: [RESEND_API_KEY] })

if (!getApps().length) {
  initializeApp()
}

export const db      = getFirestore()
export const storage = getStorage()
export const adminAuth = getAuth()
export { FieldValue, Timestamp }
