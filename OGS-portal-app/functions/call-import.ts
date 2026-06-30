import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'

// Initialize the default app
const app = admin.initializeApp()

// Import the function to call it directly
import { importC3Orders } from '../src/importC3Orders'

async function main() {
  try {
    console.log('🔄 Importing C3 Solutions LLC orders...')
    
    // Call the function with a mock context
    const result = await importC3Orders({
      auth: { token: { admin: true } },
    } as any)
    
    console.log('✅ Import successful!')
    console.log(result)
    
    process.exit(0)
  } catch (error) {
    console.error('❌ Import failed:', error)
    process.exit(1)
  }
}

main()
