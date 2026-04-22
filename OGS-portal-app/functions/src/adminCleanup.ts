import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, storage } from './admin'

const TEST_DATA_COLLECTIONS = ['contacts', 'runs', 'orders', 'quotes', 'invoices', 'customers'] as const
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

async function clearFilesCollection(): Promise<number> {
  const snap = await db.collection('files').get()
  let deleted = 0
  for (const fileDoc of snap.docs) {
    const entityType = fileDoc.get('entityType')
    if (typeof entityType === 'string' && FILE_ENTITY_TYPES.has(entityType)) {
      await fileDoc.ref.delete()
      deleted += 1
    }
  }
  return deleted
}

export const clearAllTestData = onCall(async (request) => {
  assertAdmin(request)

  const confirmText = String(request.data?.confirmText ?? '')
  if (confirmText !== 'DELETE') {
    throw new HttpsError('invalid-argument', 'You must type DELETE to confirm.')
  }

  for (const collectionName of TEST_DATA_COLLECTIONS) {
    await db.recursiveDelete(db.collection(collectionName))
  }

  const filesDeleted = await clearFilesCollection()

  for (const prefix of STORAGE_PREFIXES) {
    await storage.bucket().deleteFiles({ prefix, force: true }).catch((err) => {
      console.warn(`[clearAllTestData] Failed to clear storage prefix ${prefix}`, err)
    })
  }

  return {
    success: true,
    clearedCollections: [...TEST_DATA_COLLECTIONS, 'files'],
    filesDeleted,
  }
})
