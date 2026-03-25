/**
 * functions/src/pdf/companySettings.ts
 *
 * Fetches OGS company settings from Firestore (settings/company) for use in
 * generated PDFs, emails, and other documents.
 */

import * as https from 'https'
import * as http from 'http'
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

/** Fetches the company logo as a Buffer for embedding in PDFs. Returns null if no logoUrl is set or the fetch fails. */
export async function fetchLogoBuffer(logoUrl: string): Promise<Buffer | null> {
  if (!logoUrl) return null
  return new Promise((resolve) => {
    const client = logoUrl.startsWith('https') ? https : http
    client.get(logoUrl, (res) => {
      if (res.statusCode !== 200) { resolve(null); return }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end',  () => resolve(Buffer.concat(chunks)))
      res.on('error', () => resolve(null))
    }).on('error', () => resolve(null))
  })
}
