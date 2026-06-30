import admin from 'firebase-admin'

// Initialize with default credentials
try {
  admin.initializeApp({
    projectId: 'ogs-portal',
  })
} catch (e) {
  // App already initialized
}

const db = admin.firestore()

async function checkOrders() {
  try {
    console.log('🔍 Checking for C3 Solutions LLC orders...\n')
    
    // Find C3 Solutions LLC customer
    const customers = await db.collection('customers')
      .where('name', '==', 'C3 Solutions LLC')
      .get()
    
    if (customers.empty) {
      console.log('❌ C3 Solutions LLC customer not found')
      return
    }
    
    const customerId = customers.docs[0].id
    console.log(`✓ Found customer: ${customerId}`)
    
    // Find orders for this customer
    const orders = await db.collection('orders')
      .where('customerId', '==', customerId)
      .get()
    
    console.log(`\n✓ Found ${orders.size} orders for C3 Solutions LLC:\n`)
    
    orders.docs.forEach((doc, index) => {
      const order = doc.data()
      console.log(`Order ${index + 1}:`)
      console.log(`  ID: ${doc.id}`)
      console.log(`  Invoice: ${order.invoiceNumber || 'N/A'}`)
      console.log(`  Total: $${order.total || 'N/A'}`)
      console.log(`  Status: ${order.status || 'N/A'}`)
      console.log()
    })
    
    process.exit(0)
  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

checkOrders()
