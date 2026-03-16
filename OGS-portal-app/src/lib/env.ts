type AppEnv = 'development' | 'staging' | 'production'

function getEnv(key: string): string {
  const value = import.meta.env[key] as string | undefined
  return value ?? ''
}

// ── Firebase ──────────────────────────────────────────────────────────────────
export const firebase = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID'),
} as const

export const hasFirebaseEnvConfig = Object.values(firebase).every(Boolean)

// ── Third-party keys ──────────────────────────────────────────────────────────
export const STRIPE_PUBLISHABLE_KEY = getEnv('VITE_STRIPE_PUBLISHABLE_KEY')
export const GOOGLE_MAPS_API_KEY = getEnv('VITE_GOOGLE_MAPS_API_KEY')
// Only required in production — firebase.ts reads this directly from import.meta.env
export const RECAPTCHA_SITE_KEY = getEnv('VITE_RECAPTCHA_SITE_KEY')

// ── App ───────────────────────────────────────────────────────────────────────
const rawEnv = (import.meta.env.VITE_APP_ENV as string | undefined) ?? 'production'
export const APP_ENV = rawEnv as AppEnv
export const APP_URL = getEnv('VITE_APP_URL')

if (!['development', 'staging', 'production'].includes(rawEnv)) {
  throw new Error(
    `VITE_APP_ENV must be "development", "staging", or "production" — got "${rawEnv}"`,
  )
}

// ── Environment flags ─────────────────────────────────────────────────────────
export const isDev = APP_ENV === 'development'
export const isStaging = APP_ENV === 'staging'
export const isProd = APP_ENV === 'production'
