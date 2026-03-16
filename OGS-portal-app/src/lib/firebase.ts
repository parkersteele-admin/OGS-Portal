import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { firebase as firebaseConfig, isDev } from './env'

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, 'us-central1')

const usingEmulators = isDev && import.meta.env.VITE_USE_EMULATORS === 'true'

// Connect to local emulators in development so no real Firebase project is hit
if (usingEmulators) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, 'localhost', 8080)
  connectStorageEmulator(storage, 'localhost', 9199)
  connectFunctionsEmulator(functions, 'localhost', 5001)
}

// ── Firebase App Check ────────────────────────────────────────────────────────
// Disabled — enable once reCAPTCHA v3 site key is configured.
// See VITE_RECAPTCHA_SITE_KEY in .env.local

export { app }

