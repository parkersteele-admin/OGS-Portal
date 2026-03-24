import { ref } from 'firebase/storage'
import type { StorageReference } from 'firebase/storage'
import { storage } from './firebase'

const BASE = 'ogs-portal'

/** Convenience wrapper. */
function r(path: string): StorageReference {
  return ref(storage, `${BASE}/${path}`)
}

// ── Customers ─────────────────────────────────────────────────────────────────

/** Root folder for all files belonging to a customer. */
export const customerRoot = (customerId: string) =>
  r(`customers/${customerId}`)

/** Signed contracts stored per customer. */
export const customerContractsRef = (customerId: string) =>
  r(`customers/${customerId}/contracts`)

/** A specific contract file. */
export const customerContractRef = (customerId: string, fileName: string) =>
  r(`customers/${customerId}/contracts/${fileName}`)

/** Customer avatar / profile photo. */
export const customerAvatarRef = (customerId: string, fileName: string) =>
  r(`customers/${customerId}/avatar/${fileName}`)

// ── Deliveries (run stops) ────────────────────────────────────────────────────

/** All files captured during a delivery stop. */
export const stopFilesRef = (runId: string, stopId: string) =>
  r(`deliveries/${runId}/${stopId}`)

/** Driver signature image for a stop. */
export const stopSignatureRef = (runId: string, stopId: string) =>
  r(`deliveries/${runId}/${stopId}/signature.png`)

/** Indexed delivery photo (e.g. photo_0.jpg, photo_1.jpg). */
export const stopPhotoRef = (runId: string, stopId: string, index: number) =>
  r(`deliveries/${runId}/${stopId}/photo_${index}.jpg`)

// ── Employees ─────────────────────────────────────────────────────────────────

/** Root folder for employee files. */
export const employeeRoot = (employeeId: string) =>
  r(`employees/${employeeId}`)

/** Employee profile photo. */
export const employeeAvatarRef = (employeeId: string, fileName: string) =>
  r(`employees/${employeeId}/avatar/${fileName}`)

/** Employee HR documents (license, cert, etc.). */
export const employeeDocRef = (employeeId: string, fileName: string) =>
  r(`employees/${employeeId}/documents/${fileName}`)

// ── Company settings ─────────────────────────────────────────────────────────

/** Company logo stored under settings/company/logo/. */
export const companyLogoRef = (fileName: string) =>
  r(`settings/company/logo/${fileName}`)

// ── Compliance ────────────────────────────────────────────────────────────────

/** Root compliance folder. */
export const complianceRoot = () => r('compliance')

/** A specific compliance document. */
export const complianceDocRef = (fileName: string) =>
  r(`compliance/${fileName}`)

/** Compliance documents scoped to a year. */
export const complianceYearRef = (year: number, fileName: string) =>
  r(`compliance/${year}/${fileName}`)
