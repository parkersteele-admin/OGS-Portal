import admin from 'firebase-admin'

// Initialize with default credentials (uses GOOGLE_APPLICATION_CREDENTIALS env var)
admin.initializeApp({
  projectId: 'ogs-portal',
})

const db = admin.firestore()
const auth = admin.auth()

try {
  console.log('Creating admin user token...')
  
  // Create a test user with admin claims
  const uid = 'test-admin-user'
  
  // First check if user exists
  let user
  try {
    user = await auth.getUser(uid)
    console.log('✓ Admin user exists:', uid)
  } catch {
    console.log('Creating admin user...')
    user = await auth.createUser({ uid })
    console.log('✓ Admin user created:', uid)
  }
  
  // Set admin claim
  await auth.setCustomUserClaims(uid, { admin: true })
  console.log('✓ Admin claims set')
  
  // Get ID token for this user
  const customToken = await auth.createCustomToken(uid, { admin: true })
  console.log('✓ Custom token created')
  
  // Call the function via HTTPS
  const response = await fetch('https://us-central1-ogs-portal.cloudfunctions.net/importC3Orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${customToken}`,
    },
    body: JSON.stringify({
      data: {},
    }),
  })
  
  const result = await response.json()
  console.log('\n✅ Function executed!')
  console.log('Response:', result)
  
} catch (error) {
  console.error('❌ Error:', error.message)
  process.exit(1)
}
