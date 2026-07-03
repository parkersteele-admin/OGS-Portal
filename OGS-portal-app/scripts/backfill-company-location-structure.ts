#!/usr/bin/env node
/**
 * Backfill script for CRM hierarchy migration.
 *
 * What it does:
 * 1) Customers: ensures company-centric fields exist and seeds a primary contact.
 * 2) Orders: ensures companyId exists and assigns locationId/locationName where possible.
 * 3) Run stops: mirrors company/location fields from linked orders.
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   npx tsx scripts/backfill-company-location-structure.ts
 *
 * Dry run:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   npx tsx scripts/backfill-company-location-structure.ts --dry-run
 */

import admin from 'firebase-admin'

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
  })
}

const db = admin.firestore()
const now = admin.firestore.FieldValue.serverTimestamp()
const dryRun = process.argv.includes('--dry-run')

type AnyDoc = Record<string, any>

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function backfillCustomers() {
  const snap = await db.collection('customers').get()
  let updated = 0

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as AnyDoc
    const update: AnyDoc = {}

    const companyName = asString(data.companyName) || asString(data.name)
    if (!asString(data.companyName) && companyName) update.companyName = companyName
    if (!asString(data.name) && companyName) update.name = companyName
    if (!asString(data.mainPhone) && asString(data.phone)) update.mainPhone = asString(data.phone)
    if (!data.companyType) update.companyType = 'customer'

    const existingContacts = Array.isArray(data.contacts) ? data.contacts : []
    if (existingContacts.length === 0) {
      const primaryContactName =
        asString(data.billingContactName)
        || asString(data.deliveryContactName)
        || asString(data.contactName)
      const primaryEmail =
        asString(data.deliveryContactEmail)
        || asString(data.billingEmail)
        || asString(data.email)
      const primaryPhone =
        asString(data.deliveryContactPhone)
        || asString(data.mainPhone)
        || asString(data.phone)

      if (primaryContactName || primaryEmail || primaryPhone) {
        update.contacts = [
          {
            id: `ct_seed_${docSnap.id}`,
            name: primaryContactName || 'Primary Contact',
            role: 'Primary Contact',
            phone: primaryPhone || undefined,
            email: primaryEmail || undefined,
            isPrimary: true,
            isDeliveryContact: true,
          },
        ]
      }
    }

    const existingLocations = Array.isArray(data.locations) ? data.locations : []
    if (existingLocations.length > 0 && !asString(data.defaultLocationId)) {
      update.defaultLocationId = asString(existingLocations[0]?.id)
    }

    if (Object.keys(update).length > 0) {
      update.updatedAt = now
      if (!dryRun) await docSnap.ref.update(update)
      updated++
    }
  }

  return { total: snap.size, updated }
}

async function backfillOrders() {
  const snap = await db.collection('orders').get()
  let updated = 0

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as AnyDoc
    const update: AnyDoc = {}

    const customerId = asString(data.customerId)
    if (!asString(data.companyId) && customerId) {
      update.companyId = customerId
    }

    if (!asString(data.locationId) && customerId) {
      const customerSnap = await db.collection('customers').doc(customerId).get()
      if (customerSnap.exists) {
        const customer = customerSnap.data() as AnyDoc
        const locations = Array.isArray(customer.locations) ? customer.locations : []
        if (locations.length > 0) {
          const preferred = locations.find((loc: AnyDoc) => asString(loc.id) === asString(customer.defaultLocationId))
            || locations[0]
          if (preferred && asString(preferred.id)) {
            update.locationId = asString(preferred.id)
            update.locationName = asString(preferred.name) || 'Primary Location'
          }
        }
      }
    }

    if (Object.keys(update).length > 0) {
      update.updatedAt = now
      if (!dryRun) await docSnap.ref.update(update)
      updated++
    }
  }

  return { total: snap.size, updated }
}

async function backfillRunStopsFromOrders() {
  const runsSnap = await db.collection('runs').get()
  let scannedStops = 0
  let updatedStops = 0

  for (const runDoc of runsSnap.docs) {
    const stopsSnap = await runDoc.ref.collection('stops').get()
    for (const stopDoc of stopsSnap.docs) {
      scannedStops++
      const stop = stopDoc.data() as AnyDoc
      const orderId = asString(stop.orderId)
      if (!orderId) continue

      const orderSnap = await db.collection('orders').doc(orderId).get()
      if (!orderSnap.exists) continue
      const order = orderSnap.data() as AnyDoc

      const update: AnyDoc = {}
      if (!asString(stop.companyId) && asString(order.companyId || order.customerId)) {
        update.companyId = asString(order.companyId || order.customerId)
      }
      if (!asString(stop.locationId) && asString(order.locationId)) {
        update.locationId = asString(order.locationId)
      }
      if (!asString(stop.locationName) && asString(order.locationName)) {
        update.locationName = asString(order.locationName)
      }

      if (Object.keys(update).length > 0) {
        if (!dryRun) await stopDoc.ref.update(update)
        updatedStops++
      }
    }
  }

  return { scannedStops, updatedStops }
}

async function main() {
  console.log(`Starting CRM hierarchy backfill${dryRun ? ' (dry run)' : ''}...`)

  const customerStats = await backfillCustomers()
  console.log(`Customers: ${customerStats.updated}/${customerStats.total} updated`)

  const orderStats = await backfillOrders()
  console.log(`Orders: ${orderStats.updated}/${orderStats.total} updated`)

  const stopStats = await backfillRunStopsFromOrders()
  console.log(`Run stops: ${stopStats.updatedStops}/${stopStats.scannedStops} updated`)

  console.log('Backfill complete.')
}

main().catch((error) => {
  console.error('Backfill failed:', error)
  process.exit(1)
})
