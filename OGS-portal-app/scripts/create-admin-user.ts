/**
 * scripts/create-admin-user.ts
 *
 * One-time script: creates the Firestore users/{uid} document for an
 * existing Firebase Auth account.  Run against production with:
 *
 *   npx tsx scripts/create-admin-user.ts
 *
 * Requires Application Default Credentials:
 *   firebase login   (already done if you can deploy)
 *   gcloud auth application-default login
 *
 * Or set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 */

import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

if (!getApps().length) {
  initializeApp({ projectId: 'ogs-portal' })
}

const adminAuth = getAuth()
const db = getFirestore()

const EMAIL = 'parkersteele@gmail.com'
const NAME  = 'Parker Steele'
const ROLE  = 'admin' // change to 'dispatch' | 'driver' | 'sales' | 'customer' if needed

async function run() {
  // 1. Resolve UID from Firebase Auth
  let uid: string
  try {
    const authUser = await adminAuth.getUserByEmail(EMAIL)
    uid = authUser.uid
    console.log(`Found Auth user: ${uid}`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`No Firebase Auth account found for ${EMAIL}: ${msg}`)
    process.exit(1)
  }

  // 2. Check if document already exists
  const userRef = db.collection('users').doc(uid)
  const snap = await userRef.get()
  if (snap.exists) {
    console.log('Firestore user document already exists:', snap.data())
    process.exit(0)
  }

  // 3. Create the document
  const now = Timestamp.now()
  await userRef.set({
    email:     EMAIL,
    name:      NAME,
    role:      ROLE,
    active:    true,
    createdAt: now,
    updatedAt: now,
  })

  console.log(`✅ Created users/${uid} with role="${ROLE}"`)
  console.log('The onUserCreated Cloud Function will automatically stamp the custom claim.')
  console.log('After signing in, the user can go to their profile to verify.')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
