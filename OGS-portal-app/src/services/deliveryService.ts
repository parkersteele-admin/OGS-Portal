import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'
import { serviceCall } from './base'

export interface FinalizeSignedDeliveryInput {
  runId: string
  stopId: string
  qtyDelivered: number
  signatureDataUrl: string
  deliveryNotes?: string
  photoUrls?: string[]
  deliveredLineItems: { productId: string; qty: number }[]
  deliveredAddOns?: { productId: string; qty: number }[]
}

export interface FinalizeSignedDeliveryResult {
  signatureUrl: string
  billOfLadingUrl: string
  invoicePdfUrl: string
  invoiceId: string
}

export async function finalizeSignedDelivery(
  input: FinalizeSignedDeliveryInput,
): Promise<FinalizeSignedDeliveryResult> {
  return serviceCall(async () => {
    const fn = httpsCallable<
      FinalizeSignedDeliveryInput,
      FinalizeSignedDeliveryResult
    >(functions, 'finalizeSignedDelivery')
    const result = await fn(input)
    return result.data
  })
}
