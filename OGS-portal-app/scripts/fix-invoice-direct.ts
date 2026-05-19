/**
 * Direct Firestore update for invoice INV-2026-928306
 * 
 * This script uses Firebase Admin to update the specific invoice:
 * - Add delivery fee line item if missing
 * - Update total to $231.66
 * - Update subtotal accordingly
 * 
 * Run via: npm run firebase emulators:start (in functions/) or with firestore emulator
 */

import admin from 'firebase-admin'

async function fixInvoiceDeliveryFee() {
  // Initialize with default credentials (requires GOOGLE_APPLICATION_CREDENTIALS env var)
  if (!admin.apps.length) {
    admin.initializeApp()
  }

  const db = admin.firestore()
  const invoiceNumber = 'INV-2026-928306'

  try {
    console.log(`🔍 Finding invoice ${invoiceNumber}...`)

    // Query for the invoice
    const query = db.collection('invoices').where('invoiceNumber', '==', invoiceNumber)
    const snapshot = await query.get()

    if (snapshot.empty) {
      console.error(`❌ Invoice ${invoiceNumber} not found`)
      return
    }

    const invoiceDoc = snapshot.docs[0]
    const invoiceData = invoiceDoc.data()

    console.log(`✓ Found invoice ${invoiceNumber} (ID: ${invoiceDoc.id})`)
    console.log(`  Current total: $${(invoiceData.total || 0).toFixed(2)}`)
    console.log(`  Current subtotal: $${(invoiceData.subtotal || 0).toFixed(2)}`)

    // Get the order to find delivery fee
    const orderId = invoiceData.orderId
    if (!orderId) {
      console.error(`❌ Invoice has no orderId`)
      return
    }

    const orderDoc = await db.collection('orders').doc(orderId).get()
    if (!orderDoc.exists) {
      console.error(`❌ Order ${orderId} not found`)
      return
    }

    const orderData = orderDoc.data()
    const deliveryFee = orderData?.deliveryFee ?? 0

    console.log(`\n📦 Found linked order ${orderId}`)
    console.log(`  Order delivery fee: $${deliveryFee.toFixed(2)}`)

    // Update line items
    const lineItems = invoiceData.lineItems || []
    const hasDeliveryFeeLine = lineItems.some(
      (item: any) => /delivery\s*fee/i.test(item.description || ''),
    )

    let updatedLineItems = lineItems
    if (!hasDeliveryFeeLine && deliveryFee > 0) {
      console.log(`\n➕ Adding delivery fee line item ($${deliveryFee.toFixed(2)})`)
      updatedLineItems = [
        ...lineItems,
        {
          description: 'Delivery fee',
          quantity: 1,
          unitPrice: deliveryFee,
          amount: deliveryFee,
          total: deliveryFee,
        },
      ]
    }

    // Recalculate subtotal
    const newSubtotal = updatedLineItems.reduce((sum: number, item: any) => sum + (item.total || 0), 0)
    const newTotal = 231.66 // As specified in the bug report

    console.log(`\n💰 Updated totals:`)
    console.log(`  Subtotal (recalculated): $${newSubtotal.toFixed(2)}`)
    console.log(`  Total: $${newTotal.toFixed(2)}`)

    // Update the invoice
    await invoiceDoc.ref.update({
      lineItems: updatedLineItems,
      subtotal: newSubtotal,
      total: newTotal,
      totalAmount: newTotal,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    console.log(`\n✅ Invoice updated in Firestore`)
    console.log(`   ID: ${invoiceDoc.id}`)
    console.log(`   Invoice: ${invoiceNumber}`)
    console.log(`   New total: $${newTotal.toFixed(2)}`)

  } catch (error) {
    console.error('Error:', error)
  }
}

fixInvoiceDeliveryFee().then(() => process.exit(0))
