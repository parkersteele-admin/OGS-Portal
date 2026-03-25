/**
 * functions/src/scheduled/purgeDeletedCustomers.ts
 *
 * Schedule: daily 03:00 America/New_York
 *
 * Permanently hard-deletes customer documents that have been soft-deleted
 * (status == 'deleted') for more than 30 days.
 *
 * Soft-delete is performed client-side by setting:
 *   { status: 'deleted', deletedAt: serverTimestamp() }
 *
 * This function finds documents where deletedAt < (now - 30 days) and
 * permanently removes the Firestore document along with its subcollections
 * (tanks, paymentMethods, locations).
 *
 * Foreign-key references in orders/invoices/tanks are left in place so that
 * historical records remain accurate. The customer name is stored as a
 * denormalized field on those documents anyway.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler'
import { db, Timestamp } from '../admin'

const RETENTION_DAYS = 30

/** Recursively delete all documents in a subcollection. */
async function deleteSubcollection(parentPath: string, subName: string): Promise<void> {
  const snap = await db.collection(`${parentPath}/${subName}`).get()
  if (snap.empty) return
  const batch = db.batch()
  snap.docs.forEach((d) => batch.delete(d.ref))
  await batch.commit()
}

export const purgeDeletedCustomers = onSchedule(
  {
    schedule:       '0 3 * * *',
    timeZone:       'America/New_York',
    memory:         '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const cutoff = Timestamp.fromDate(
      new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000),
    )

    const snap = await db
      .collection('customers')
      .where('status', '==', 'deleted')
      .where('deletedAt', '<', cutoff)
      .get()

    if (snap.empty) {
      console.log('purgeDeletedCustomers: no customers to purge')
      return
    }

    console.log(`purgeDeletedCustomers: purging ${snap.size} customer(s)`)

    for (const customerDoc of snap.docs) {
      const customerId = customerDoc.id
      const customerPath = `customers/${customerId}`

      try {
        // Remove subcollections first (Firestore does not cascade-delete subcollections)
        await Promise.all([
          deleteSubcollection(customerPath, 'tanks'),
          deleteSubcollection(customerPath, 'paymentMethods'),
          deleteSubcollection(customerPath, 'locations'),
        ])

        // Hard-delete the customer document
        await customerDoc.ref.delete()

        console.log(`purgeDeletedCustomers: permanently deleted customer ${customerId}`)
      } catch (err) {
        console.error(`purgeDeletedCustomers: failed to delete customer ${customerId}:`, err)
        // Continue processing remaining customers even if one fails
      }
    }
  },
)
