/**
 * functions/src/pdf/companySettings.ts
 *
 * Fetches OGS company settings from Firestore (settings/company) for use in
 * generated PDFs, emails, and other documents.
 */

import { db } from '../admin'

export interface CompanySettings {
  name:    string
  tagline: string
  email:   string
  phone:   string
  website: string
  address: string
  city:    string
  state:   string
  zip:     string
  taxId:   string
  logoUrl: string
}

const DEFAULTS: CompanySettings = {
  name:    'OGS Gas Services',
  tagline: '',
  email:   '',
  phone:   '',
  website: '',
  address: '',
  city:    '',
  state:   '',
  zip:     '',
  taxId:   '',
  logoUrl: '',
}

export async function getCompanySettings(): Promise<CompanySettings> {
  const snap = await db.collection('settings').doc('company').get()
  if (!snap.exists) return { ...DEFAULTS }
  return { ...DEFAULTS, ...snap.data() } as CompanySettings
}
