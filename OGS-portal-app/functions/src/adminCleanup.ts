import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, storage } from './admin'

const TEST_DATA_COLLECTIONS = ['contacts', 'runs', 'orders', 'quotes', 'invoices', 'customers', 'payments', 'leads'] as const
const FILE_ENTITY_TYPES = new Set(['customer', 'quote', 'invoice', 'order', 'run'])
const STORAGE_PREFIXES = [
  'ogs-portal/customers/',
  'ogs-portal/quotes/',
  'ogs-portal/invoices/',
  'ogs-portal/orders/',
  'ogs-portal/runs/',
]

function assertAdmin(request: { auth?: { token?: Record<string, unknown> } }) {
  const role = request.auth?.token?.role
  if (role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can clear test data.')
  }
}

/**
 * Delete all documents in a collection using the Admin SDK.
 * db.recursiveDelete handles subcollections automatically.
 */
async function deleteCollectionWithLogging(collectionName: string): Promise<void> {
  await db.recursiveDelete(db.collection(collectionName))
  console.log(`[clearAllTestData] recursiveDelete complete for: ${collectionName}`)
}

async function clearFilesCollection(): Promise<number> {
  let deleted = 0
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined

  // Batch delete in pages of 400 to stay under Firestore limits
  while (true) {
    let q = db.collection('files').limit(400)
    if (lastDoc) q = q.startAfter(lastDoc) as typeof q

    const snap = await q.get()
    if (snap.empty) break

    const batch = db.batch()
    for (const fileDoc of snap.docs) {
      const entityType = fileDoc.get('entityType')
      if (typeof entityType === 'string' && FILE_ENTITY_TYPES.has(entityType)) {
        batch.delete(fileDoc.ref)
        deleted++
      }
    }
    await batch.commit()
    lastDoc = snap.docs[snap.docs.length - 1]
    if (snap.docs.length < 400) break
  }

  return deleted
}

export const clearAllTestData = onCall(async (request) => {
  assertAdmin(request)

  const confirmText = String(request.data?.confirmText ?? '')
  if (confirmText !== 'DELETE') {
    throw new HttpsError('invalid-argument', 'You must type DELETE to confirm.')
  }

  console.log('[clearAllTestData] Starting test data cleanup...')

  try {
    for (const collectionName of TEST_DATA_COLLECTIONS) {
      console.log(`[clearAllTestData] Deleting collection: ${collectionName}`)
      try {
        await deleteCollectionWithLogging(collectionName)
      } catch (colErr) {
        console.error(`[clearAllTestData] Failed on collection ${collectionName}:`, colErr)
        throw colErr
      }
    }

    const filesDeleted = await clearFilesCollection()
    console.log(`[clearAllTestData] Deleted ${filesDeleted} file records from files collection`)

    for (const prefix of STORAGE_PREFIXES) {
      try {
        await storage.bucket().deleteFiles({ prefix, force: true })
        console.log(`[clearAllTestData] Cleared storage prefix: ${prefix}`)
      } catch (err) {
        console.warn(`[clearAllTestData] Failed to clear storage prefix ${prefix}:`, err)
      }
    }

    console.log('[clearAllTestData] All test data cleared successfully')

    return {
      success: true,
      clearedCollections: [...TEST_DATA_COLLECTIONS, 'files'],
      filesDeleted,
    }
  } catch (err) {
    console.error('[clearAllTestData] Fatal error during cleanup:', err)
    throw new HttpsError('internal', `Cleanup failed: ${err instanceof Error ? err.message : String(err)}`)
  }
})
