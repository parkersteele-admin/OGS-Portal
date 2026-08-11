/**
 * functions/src/orderRequests.ts
 *
 * Public callable used by the embeddable order-request form.
 * Accepts lightweight customer request data (no pricing), stores it in
 * Firestore, and notifies the operations inbox.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onRequest } from 'firebase-functions/v2/https'
import { db, FieldValue } from './admin'


interface SubmitOrderRequestInput {
  name: string
  phone: string
  email: string
  company?: string
  deliveryAddress?: string
  preferredDeliveryDate?: string
  requestedItems?: string[]
  requestDetails?: string
  sourceUrl?: string
  website?: string
}

function normalizeRequestedItems(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 12)
    .map((item) => item.slice(0, 120))

  return [...new Set(cleaned)]
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isLikelyPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

export const submitOrderRequest = onCall(async (request) => {
  const data = request.data as Partial<SubmitOrderRequestInput>

  const result = await processOrderRequest(data)
  return { success: true, requestId: result.requestId, orderId: result.orderId }
})

async function processOrderRequest(data: Partial<SubmitOrderRequestInput>) {

  // Honeypot tripped — pretend success to avoid helping bots tune payloads.
  if (data.website) {
    return { requestId: 'honeypot', orderId: 'honeypot' }
  }

  const name = (data.name ?? '').trim().slice(0, 100)
  const phone = (data.phone ?? '').trim().slice(0, 40)
  const email = (data.email ?? '').trim().slice(0, 160)
  const company = (data.company ?? '').trim().slice(0, 120)
  const deliveryAddress = (data.deliveryAddress ?? '').trim().slice(0, 220)
  const preferredDeliveryDate = (data.preferredDeliveryDate ?? '').trim().slice(0, 40)
  const requestDetails = (data.requestDetails ?? '').trim().slice(0, 2500)
  const sourceUrl = (data.sourceUrl ?? '').trim().slice(0, 400)
  const requestedItems = normalizeRequestedItems(data.requestedItems)

  if (!name || !phone || !email) {
    throw new HttpsError('invalid-argument', 'Name, phone, and email are required.')
  }
  if (!isValidEmail(email)) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.')
  }
  if (!isLikelyPhone(phone)) {
    throw new HttpsError('invalid-argument', 'Enter a valid phone number.')
  }
  if (requestedItems.length === 0 && !requestDetails) {
    throw new HttpsError('invalid-argument', 'Select at least one requested item or provide details.')
  }

  const customerRef = db.collection('customers').doc()
  const fallbackAddress = deliveryAddress || 'Address pending confirmation'

  await customerRef.set({
    name: company || name,
    companyName: company || null,
    email,
    phone,
    address: fallbackAddress,
    city: 'Unknown',
    state: 'OH',
    zip: '00000',
    status: 'active',
    creditLimit: 0,
    companyType: 'prospect',
    notes: `Created from embedded order request form for ${name}.`,
    deliveryContactName: name,
    deliveryContactPhone: phone,
    deliveryContactEmail: email,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  const orderNotes = [
    'External web request (pending review).',
    `Requester: ${name}`,
    `Phone: ${phone}`,
    `Email: ${email}`,
    deliveryAddress ? `Requested address: ${deliveryAddress}` : '',
    preferredDeliveryDate ? `Preferred date: ${preferredDeliveryDate}` : '',
    requestedItems.length ? `Requested items: ${requestedItems.join(', ')}` : '',
    requestDetails ? `Details: ${requestDetails}` : '',
  ].filter(Boolean).join('\n')

  const orderRef = await db.collection('orders').add({
    customerId: customerRef.id,
    companyId: customerRef.id,
    productId: 'external-request',
    quantity: 1,
    deliveryTier: 'standard',
    upchargePercent: 0,
    unitPrice: 0,
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    status: 'pending',
    notes: orderNotes,
    deliveryContactName: name,
    deliveryContactPhone: phone,
    deliveryContactEmail: email,
    requestedItems,
    externalRequest: true,
    requestedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  })

  const requestRef = await db.collection('orderRequests').add({
    orderId: orderRef.id,
    customerId: customerRef.id,
    name,
    phone,
    email,
    company: company || null,
    deliveryAddress: deliveryAddress || null,
    preferredDeliveryDate: preferredDeliveryDate || null,
    requestedItems,
    requestDetails: requestDetails || null,
    sourceUrl: sourceUrl || null,
    status: 'new' as const,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { requestId: requestRef.id, orderId: orderRef.id }
}

export const submitOrderRequestPublic = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' })
    return
  }

  try {
    const payload = (req.body ?? {}) as Partial<SubmitOrderRequestInput>
    const result = await processOrderRequest(payload)
    res.status(200).json({ success: true, requestId: result.requestId, orderId: result.orderId })
  } catch (err) {
    const message = err instanceof HttpsError ? err.message : 'Failed to submit order request'
    res.status(400).json({ success: false, error: message })
  }
})
