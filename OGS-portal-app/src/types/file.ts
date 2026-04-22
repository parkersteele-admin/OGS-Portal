import type { Timestamp } from 'firebase/firestore'

/** The type of entity this file is attached to. */
export type FileEntityType =
  | 'customer'
  | 'order'
  | 'invoice'
  | 'run'
  | 'lead'
  | 'quote'
  | 'user'
  | 'tank'

/** Category of file content. */
export type FileType =
  | 'quote'
  | 'contract'
  | 'invoice'
  | 'receipt'
  | 'signature'
  | 'photo'
  | 'id-document'
  | 'inspection'
  | 'other'

export interface AppFile {
  id: string
  /** The collection this file belongs to (e.g. "customers", "orders"). */
  entityType: FileEntityType
  /** The document ID of the owning entity. */
  entityId: string
  fileType: FileType
  /** Public or signed download URL from Firebase Storage. */
  url: string
  /** Storage path, used to generate fresh signed URLs. */
  storagePath: string
  fileName: string
  mimeType: string
  /** File size in bytes. */
  sizeBytes: number
  /** UID of the user who uploaded this file. */
  uploadedBy: string
  /** ISO timestamp when a signature was captured, if applicable. */
  signedAt?: Timestamp
  /** When the signed URL expires; null for public files. */
  expiresAt?: Timestamp
  /** Arbitrary key/value metadata (e.g. width, height, pages). */
  metadata: Record<string, string | number | boolean>
  createdAt: Timestamp
}
