import { getDoc, setDoc } from 'firebase/firestore'
import { uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { companySettingsRef } from '../lib/firestore'
import { companyLogoRef } from '../lib/storage'
import { serviceCall } from './base'
import { DEFAULT_COMPANY_SETTINGS } from '../types/companySettings'
import type { CompanySettings } from '../types/companySettings'

export async function getCompanySettings(): Promise<CompanySettings> {
  return serviceCall(async () => {
    const snap = await getDoc(companySettingsRef)
    if (!snap.exists()) return { ...DEFAULT_COMPANY_SETTINGS }
    return { ...DEFAULT_COMPANY_SETTINGS, ...snap.data() } as CompanySettings
  })
}

export async function updateCompanySettings(settings: Partial<CompanySettings>): Promise<void> {
  return serviceCall(() => setDoc(companySettingsRef, settings, { merge: true }))
}

export async function uploadCompanyLogo(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  return serviceCall(async () => {
    const ext = file.name.split('.').pop() ?? 'png'
    const storageRef = companyLogoRef(`logo.${ext}`)
    await new Promise<void>((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, file, { contentType: file.type })
      task.on(
        'state_changed',
        (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
        reject,
        resolve,
      )
    })
    return getDownloadURL(storageRef)
  })
}
