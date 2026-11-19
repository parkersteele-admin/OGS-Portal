/**
 * functions/src/onboardingPackets/crypto.ts
 *
 * AES-256-GCM encryption for sensitive onboarding data (bank account and
 * routing numbers, the packet link token).
 *
 * The key lives in Secret Manager as ONBOARDING_ENCRYPTION_KEY — a base64
 * encoded 32-byte value. Create it once:
 *
 *   openssl rand -base64 32 | firebase functions:secrets:set ONBOARDING_ENCRYPTION_KEY --data-file=-
 *
 * Never rotate/destroy this secret while packets still hold encrypted bank
 * details that have not yet been entered into QuickBooks.
 */

import crypto from 'crypto'
import { defineSecret } from 'firebase-functions/params'

export const ONBOARDING_ENCRYPTION_KEY = defineSecret('ONBOARDING_ENCRYPTION_KEY')

export interface EncryptedValue {
  v: 1
  iv: string
  tag: string
  data: string
}

function getKey(): Buffer {
  const raw = (ONBOARDING_ENCRYPTION_KEY.value() || '').trim()
  if (!raw) {
    throw new Error(
      'ONBOARDING_ENCRYPTION_KEY is not configured. Run: ' +
      'openssl rand -base64 32 | firebase functions:secrets:set ONBOARDING_ENCRYPTION_KEY --data-file=-',
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('ONBOARDING_ENCRYPTION_KEY must decode to exactly 32 bytes.')
  return key
}

export function encryptString(plain: string): EncryptedValue {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}

export function decryptString(enc: EncryptedValue): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(enc.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(enc.data, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/** URL-safe random token for packet links. */
export function newPacketToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}
