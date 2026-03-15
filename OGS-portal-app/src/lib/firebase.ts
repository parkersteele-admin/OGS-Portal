import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { firebase as firebaseConfig, isDev, isProd } from './env'

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
// Emulators don't require App Check — skip it entirely when running locally.
if (!usingEmulators) {
  if (!isProd) {
    // Development / staging: inject a debug token so App Check passes without
    // a real reCAPTCHA interaction. Set VITE_APPCHECK_DEBUG_TOKEN in .env.local.
    // If the var is absent the SDK auto-generates a token and logs it to the
    // console — copy it into the Firebase console under App Check > Apps > debug.
    const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined
    // @ts-expect-error – FIREBASE_APPCHECK_DEBUG_TOKEN is a special SDK global
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true
  }

  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY as string),
    isTokenAutoRefreshEnabled: true,
  })
}

export { app }

