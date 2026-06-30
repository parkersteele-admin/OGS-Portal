/**
 * Diagnostic script to check invoice vs order data consistency
 * Usage: npx ts-node scripts/diagnose-invoices.ts
 */
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// Initialize Firebase Admin SDK
if (!getApps().length) {
  initializeApp()
}

const db = getFirestore()

async function diagnoseInvoices() {
  console.log('\n📊 INVOICE DATA CONSISTENCY CHECK\n')
  console.log('='.repeat(70))

  try {
    // Get all invoices with status 'sent'
    console.log('\n1️⃣  INVOICES WITH STATUS "sent"\n')
    const sentInvoices = await db.collection('invoices')
      .where('status', '==', 'sent')
      .get()

    console.log(`   Found: ${sentInvoices.size} invoices\n`)
    sentInvoices.docs.forEach(doc => {
      const data = doc.data()
      console.log(`   • ${data.invoiceNumber} (${doc.id})`)
      console.log(`     Customer: ${data.customerId}`)
      console.log(`     Total: $${(data.total || 0).toFixed(2)}`)
      console.log(`     Order ID: ${data.orderId || 'none'}`)
      console.log(`     Issued: ${data.issuedAt?.toDate?.().toLocaleDateString()}`)
      console.log(`     Status: ${data.status}\n`)
    })

    // Get all invoices with status 'overdue'
    console.log('\n2️⃣  INVOICES WITH STATUS "overdue"\n')
    const overdueInvoices = await db.collection('invoices')
      .where('status', '==', 'overdue')
      .get()

    console.log(`   Found: ${overdueInvoices.size} invoices\n`)
    overdueInvoices.docs.forEach(doc => {
      const data = doc.data()
      console.log(`   • ${data.invoiceNumber} (${doc.id})`)
      console.log(`     Customer: ${data.customerId}`)
      console.log(`     Total: $${(data.total || 0).toFixed(2)}`)
      console.log(`     Due: ${data.dueAt?.toDate?.().toLocaleDateString()}`)
      console.log(`     Status: ${data.status}\n`)
    })

    // Get all invoices with status 'paid'
    console.log('\n3️⃣  INVOICES WITH STATUS "paid"\n')
    const paidInvoices = await db.collection('invoices')
      .where('status', '==', 'paid')
      .get()

    console.log(`   Found: ${paidInvoices.size} invoices\n`)
    paidInvoices.docs.forEach(doc => {
      const data = doc.data()
      console.log(`   • ${data.invoiceNumber} (${doc.id})`)
      console.log(`     Customer: ${data.customerId}`)
      console.log(`     Total: $${(data.total || 0).toFixed(2)}`)
      console.log(`     Paid At: ${data.paidAt?.toDate?.().toLocaleDateString()}`)
      console.log(`     Status: ${data.status}\n`)
    })

    // Get all orders with invoice status
    console.log('\n4️⃣  ORDERS WITH INVOICE_SENT STATUS\n')
    const invoiceSentOrders = await db.collection('orders')
      .where('status', '==', 'invoice_sent')
      .get()

    console.log(`   Found: ${invoiceSentOrders.size} orders\n`)
    invoiceSentOrders.docs.forEach(doc => {
      const data = doc.data()
      console.log(`   • Order ${doc.id}`)
      console.log(`     Customer: ${data.customerId}`)
      console.log(`     QB Invoice #: ${data.qbInvoiceNumber || 'none'}`)
      console.log(`     Invoice Amount: $${(data.invoiceAmount || 0).toFixed(2)}`)
      console.log(`     Status: ${data.status}\n`)
    })

    // Get orders marked as paid
    console.log('\n5️⃣  ORDERS WITH PAID STATUS\n')
    const paidOrders = await db.collection('orders')
      .where('status', '==', 'paid')
      .get()

    console.log(`   Found: ${paidOrders.size} orders\n`)
    paidOrders.docs.forEach(doc => {
      const data = doc.data()
      console.log(`   • Order ${doc.id}`)
      console.log(`     Customer: ${data.customerId}`)
      console.log(`     QB Invoice #: ${data.qbInvoiceNumber || 'none'}`)
      console.log(`     Paid Amount: $${(data.paidAmount || 0).toFixed(2)}`)
      console.log(`     Status: ${data.status}\n`)
    })

    // SUMMARY
    const allInvoices = await db.collection('invoices').get()
    console.log('\n📈 INVOICE SUMMARY\n')
    console.log(`   Total Invoices: ${allInvoices.size}`)
    console.log(`   - Sent: ${sentInvoices.size}`)
    console.log(`   - Overdue: ${overdueInvoices.size}`)
    console.log(`   - Paid: ${paidInvoices.size}`)

    const allOrders = await db.collection('orders').get()
    console.log(`\n📈 ORDER SUMMARY\n`)
    console.log(`   Total Orders: ${allOrders.size}`)
    console.log(`   - Invoice Sent: ${invoiceSentOrders.size}`)
    console.log(`   - Paid: ${paidOrders.size}`)

    // Check for mismatches
    console.log('\n⚠️  POTENTIAL ISSUES\n')
    
    // Find invoices with orderId but order doesn't have matching qbInvoiceNumber
    let mismatchCount = 0
    for (const invDoc of allInvoices.docs) {
      const inv = invDoc.data()
      if (inv.orderId) {
        const orderDoc = await db.collection('orders').doc(inv.orderId).get()
        if (orderDoc.exists) {
          const order = orderDoc.data()
          if (order.qbInvoiceNumber !== inv.invoiceNumber) {
            mismatchCount++
            console.log(`   ⚠️  Invoice ${inv.invoiceNumber} (orderId: ${inv.orderId})`)
            console.log(`       Order has qbInvoiceNumber: ${order.qbInvoiceNumber || 'none'}`)
          }
        }
      }
    }
    
    if (mismatchCount === 0) {
      console.log('   ✓ No invoice/order number mismatches found')
    }

    console.log('\n' + '='.repeat(70))
    console.log('✅ Diagnosis complete\n')

  } catch (error) {
    console.error('❌ Error:', error)
  }

  process.exit(0)
}

diagnoseInvoices()
