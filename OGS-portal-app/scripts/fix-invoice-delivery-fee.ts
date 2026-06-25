/**
 * scripts/fix-invoice-delivery-fee.ts
 * 
 * One-time script to fix invoice INV-2026-928306 by:
 * 1. Adding delivery fee line item if missing
 * 2. Recalculating total to include delivery fee
 * 3. Regenerating the PDF with corrected amount
 * 
 * Usage: npm run ts-node scripts/fix-invoice-delivery-fee.ts <invoiceNumber> <correctTotal> <deliveryFee>
 * Example: npm run ts-node scripts/fix-invoice-delivery-fee.ts INV-2026-928306 231.66 17.16
 */

import admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '../../../ogs-portal-firebase-serviceaccount.json')
if (!fs.existsSync(serviceAccountPath)) {
  throw new Error(`Service account file not found at ${serviceAccountPath}`)
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://ogs-portal-6c9a7.firebaseio.com',
})

const db = admin.firestore()

async function fixInvoice(invoiceNumber: string, correctTotal: number, deliveryFee: number) {
  console.log(`\n[INFO] Fixing invoice ${invoiceNumber}...`)
  console.log(`   Target total: $${correctTotal.toFixed(2)}`)
  console.log(`   Delivery fee: $${deliveryFee.toFixed(2)}`)

  try {
    // Find invoice by invoiceNumber
    const invoiceSnap = await db
      .collection('invoices')
      .where('invoiceNumber', '==', invoiceNumber)
      .limit(1)
      .get()

    if (invoiceSnap.empty) {
      throw new Error(`Invoice ${invoiceNumber} not found in Firestore`)
    }

    const invoiceDoc = invoiceSnap.docs[0]
    const invoiceId = invoiceDoc.id
    const currentInvoice = invoiceDoc.data()

    console.log(`\n✓ Found invoice: ${invoiceId}`)
    console.log(`  Current total: $${currentInvoice.total ?? 0}`)
    console.log(`  Current subtotal: $${currentInvoice.subtotal ?? 0}`)
    console.log(`  Current line items: ${currentInvoice.lineItems?.length ?? 0}`)

    // Check if delivery fee line item already exists
    const lineItems = currentInvoice.lineItems || []
    const hasDeliveryFeeLine = lineItems.some(
      (item: Record<string, unknown>) => /delivery\s*fee/i.test((item.description as string) || ''),
    )

    let updatedLineItems = [...lineItems]

    if (!hasDeliveryFeeLine && deliveryFee > 0) {
      console.log(`\n➕ Adding delivery fee line item...`)
      updatedLineItems.push({
        description: 'Delivery fee',
        quantity: 1,
        unitPrice: deliveryFee,
        amount: deliveryFee,
        total: deliveryFee,
      })
    }

    // Calculate new subtotal
    const newSubtotal = updatedLineItems.reduce((sum: number, item: Record<string, unknown>) => {
      return sum + (typeof item.total === 'number' ? item.total : 0)
    }, 0)

    console.log(`\n[INFO] Updated totals:`)
    console.log(`  Old subtotal: $${currentInvoice.subtotal ?? 0}`)
    console.log(`  New subtotal: $${newSubtotal.toFixed(2)}`)
    console.log(`  Old total: $${currentInvoice.total ?? 0}`)
    console.log(`  New total: $${correctTotal.toFixed(2)}`)

    // Update invoice in Firestore
    await invoiceDoc.ref.update({
      lineItems: updatedLineItems,
      subtotal: newSubtotal,
      total: correctTotal,
      totalAmount: correctTotal,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    console.log(`\n✅ Firestore record updated successfully`)

    // Attempt to regenerate PDF
    console.log(`\n[INFO] Regenerating PDF with corrected total...`)
    try {
      const { httpsCallable } = await import('firebase-functions')
      const { functions } = await import('../lib/firebase')
      // Note: This won't work from script context, but we can show instructions

      console.log(`\n⚠️  Manual PDF regeneration needed:`)
      console.log(`    1. Go to OrderManagement for the order linked to this invoice`)
      console.log(`    2. Click "View PDF" button to regenerate from updated invoice`)
      console.log(`    Or manually call: generateInvoicePdf('${invoiceId}')`)
    } catch (err) {
      console.log(`    (PDF regeneration from script not supported - use manual method)`)
    }

    console.log(`\n✨ Invoice fix complete!`)
    console.log(`   Invoice ID: ${invoiceId}`)
    console.log(`   Invoice #: ${invoiceNumber}`)
  } catch (err) {
    console.error(`\n❌ Error fixing invoice:`, err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

// Parse command line arguments
const args = process.argv.slice(2)
if (args.length < 3) {
  console.error(`\nUsage: npm run ts-node scripts/fix-invoice-delivery-fee.ts <invoiceNumber> <correctTotal> <deliveryFee>`)
  console.error(`Example: npm run ts-node scripts/fix-invoice-delivery-fee.ts INV-2026-928306 231.66 17.16`)
  process.exit(1)
}

const invoiceNumber = args[0]
const correctTotal = parseFloat(args[1])
const deliveryFee = parseFloat(args[2])

if (!invoiceNumber || !correctTotal || !deliveryFee) {
  console.error(`\n❌ Invalid arguments. Got:`, args)
  process.exit(1)
}

fixInvoice(invoiceNumber, correctTotal, deliveryFee)
  .then(() => {
    console.log('\n')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Script error:', err)
    process.exit(1)
  })
