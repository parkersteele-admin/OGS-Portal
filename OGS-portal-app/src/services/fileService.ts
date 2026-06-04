import {
  doc,
  collection,
  addDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  type QueryConstraint,
} from 'firebase/firestore'
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  getMetadata,
  type UploadTask,
  type StorageReference,
} from 'firebase/storage'
import { getLimitConstraint } from './queryOptimizer'
import { db, storage, auth } from '../lib/firebase'
import type { AppFile, FileEntityType, FileType } from '../types/file'
import { serviceCall, fromSnap, OgsValidationError } from './base'

const FILES_COLLECTION = 'files'
const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB

/** Options passed to uploadFile. */
export interface UploadOptions {
  entityType: FileEntityType
  entityId: string
  fileType: FileType
  /** Called repeatedly with 0–100 during upload. */
  onProgress?: (percent: number) => void
}

// ── Storage path builders ─────────────────────────────────────────────────────

function storagePath(entityType: FileEntityType, entityId: string, fileName: string): string {
  return `ogs-portal/${entityType}s/${entityId}/${fileName}`
}

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Uploads a File to Firebase Storage and writes a metadata record to Firestore.
 * Returns the new AppFile document ID.
 *
 * @example
 * const fileId = await uploadFile(myFile, {
 *   entityType: 'customer',
 *   entityId: 'cust-001',
 *   fileType: 'contract',
 *   onProgress: (pct) => setProgress(pct),
 * })
 */
export async function uploadFile(file: File, options: UploadOptions): Promise<string> {
  return serviceCall(async () => {
    if (file.size > MAX_SIZE_BYTES) {
      throw new OgsValidationError(
        `File exceeds 20 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
      )
    }

    const uid = auth.currentUser?.uid
    if (!uid) throw new Error('Not authenticated')

    const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const path = storagePath(options.entityType, options.entityId, safeName)
    const storageRef: StorageReference = ref(storage, path)

    // Upload with progress tracking
    await new Promise<void>((resolve, reject) => {
      const task: UploadTask = uploadBytesResumable(storageRef, file, {
        contentType: file.type,
        customMetadata: {
          entityType: options.entityType,
          entityId:   options.entityId,
          fileType:   options.fileType,
          uploadedBy: uid,
        },
      })
      task.on(
        'state_changed',
        (snapshot) => {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          options.onProgress?.(pct)
        },
        reject,
        resolve,
      )
    })

    const url = await getDownloadURL(storageRef)

    // Write Firestore metadata record
    const fileCol = collection(db, FILES_COLLECTION)
    const docRef = await addDoc(fileCol, {
      entityType:  options.entityType,
      entityId:    options.entityId,
      fileType:    options.fileType,
      url,
      storagePath: path,
      fileName:    file.name,
      mimeType:    file.type,
      sizeBytes:   file.size,
      uploadedBy:  uid,
      metadata:    {},
      createdAt:   serverTimestamp(),
    } as Omit<AppFile, 'id'>)

    return docRef.id
  })
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getFile(id: string): Promise<AppFile> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, FILES_COLLECTION, id))
    return fromSnap<AppFile>(snap, FILES_COLLECTION)
  })
}

export async function getFilesForEntity(
  entityType: FileEntityType,
  entityId: string,
  fileType?: FileType,
): Promise<AppFile[]> {
  return serviceCall(async () => {
    const fileCol = collection(db, FILES_COLLECTION)
    const constraints: QueryConstraint[] = [
      where('entityType', '==', entityType),
      where('entityId',   '==', entityId),
      orderBy('createdAt', 'desc'),
      getLimitConstraint('products'),
    ]
    if (fileType) constraints.push(where('fileType', '==', fileType))
    const snap = await getDocs(query(fileCol, ...constraints))
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AppFile)
  })
}

// ── Signed URLs ───────────────────────────────────────────────────────────────

/**
 * Returns a fresh download URL for a stored file.
 * Firebase Storage download URLs don't expire by default for public files;
 * use this to refresh a URL after it has been changed (e.g. file replaced).
 */
export async function getFileUrl(storagePath: string): Promise<string> {
  return serviceCall(async () => {
    const storageRef = ref(storage, storagePath)
    return getDownloadURL(storageRef)
  })
}

/**
 * Returns the content-type and size of a file without downloading it.
 */
export async function getFileMetadata(storagePath: string) {
  return serviceCall(async () => {
    const storageRef = ref(storage, storagePath)
    return getMetadata(storageRef)
  })
}

// ── Delete ────────────────────────────────────────────────────────────────────

/** Deletes the Storage object AND the Firestore metadata record. */
export async function deleteFile(id: string): Promise<void> {
  return serviceCall(async () => {
    const file = await getFile(id)
    await Promise.all([
      deleteObject(ref(storage, file.storagePath)).catch(() => {
        // If the storage object is already gone, ignore the error
      }),
      deleteDoc(doc(db, FILES_COLLECTION, id)),
    ])
  })
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

export async function uploadCustomerDocument(
  customerId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  return uploadFile(file, {
    entityType: 'customer',
    entityId: customerId,
    fileType: 'contract',
    onProgress,
  })
}

export async function uploadDeliverySignature(
  orderId: string,
  blob: Blob,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const file = new File([blob], 'signature.png', { type: 'image/png' })
  return uploadFile(file, {
    entityType: 'order',
    entityId: orderId,
    fileType: 'signature',
    onProgress,
  })
}

export async function uploadDeliveryPhoto(
  orderId: string,
  photo: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  return uploadFile(photo, {
    entityType: 'order',
    entityId: orderId,
    fileType: 'photo',
    onProgress,
  })
}
