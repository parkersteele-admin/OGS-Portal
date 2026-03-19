import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { firebase as firebaseConfig, hasFirebaseEnvConfig, isDev, RECAPTCHA_SITE_KEY } from './env'

// In Firebase App Hosting, FIREBASE_WEBAPP_CONFIG is injected during build and
// the Firebase JS SDK can initialize with no explicit options.
const app = hasFirebaseEnvConfig ? initializeApp(firebaseConfig) : initializeApp()

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
if (RECAPTCHA_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
} else if (!isDev) {
  console.warn('[firebase] App Check is disabled: VITE_RECAPTCHA_SITE_KEY is not set')
}

export { app }

