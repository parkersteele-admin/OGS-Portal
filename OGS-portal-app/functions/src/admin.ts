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

if (!getApps().length) {
  initializeApp()
}

export const db      = getFirestore()
export const storage = getStorage()
export const adminAuth = getAuth()
export { FieldValue, Timestamp }
