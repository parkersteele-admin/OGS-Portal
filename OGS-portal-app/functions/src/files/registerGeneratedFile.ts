import { db, FieldValue } from '../admin'

export type GeneratedFileType =
  | 'quote'
  | 'invoice'
  | 'signature'
  | 'receipt'
  | 'contract'
  | 'photo'
  | 'other'

export type GeneratedFileEntityType =
  | 'customer'
  | 'order'
  | 'invoice'
  | 'run'
  | 'lead'
  | 'quote'
  | 'user'
  | 'tank'

interface GeneratedFileTarget {
  entityType: GeneratedFileEntityType
  entityId: string
}

interface RegisterGeneratedFileInput {
  targets: GeneratedFileTarget[]
  fileType: GeneratedFileType
  url: string
  storagePath: string
  fileName: string
  mimeType: string
  sizeBytes?: number
  metadata?: Record<string, string | number | boolean | null>
}

function cleanMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean> {
  if (!metadata) return {}
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined),
  ) as Record<string, string | number | boolean>
}

export async function registerGeneratedFile(input: RegisterGeneratedFileInput): Promise<void> {
  const metadata = cleanMetadata(input.metadata)

  await Promise.all(
    input.targets.map(async (target) => {
      const existing = await db
        .collection('files')
        .where('entityType', '==', target.entityType)
        .where('entityId', '==', target.entityId)
        .where('storagePath', '==', input.storagePath)
        .limit(1)
        .get()

      const payload = {
        entityType: target.entityType,
        entityId: target.entityId,
        fileType: input.fileType,
        url: input.url,
        storagePath: input.storagePath,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes ?? 0,
        uploadedBy: 'system',
        metadata,
        updatedAt: FieldValue.serverTimestamp(),
      }

      if (existing.empty) {
        await db.collection('files').add({
          ...payload,
          createdAt: FieldValue.serverTimestamp(),
        })
        return
      }

      await existing.docs[0].ref.update(payload)
    }),
  )
}
