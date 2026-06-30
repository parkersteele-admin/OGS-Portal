import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'
import { serviceCall } from './base'

interface ClearAllTestDataResponse {
  success: boolean
  clearedCollections: string[]
  filesDeleted: number
}

interface ImportC3OrdersResponse {
  success: boolean
  message: string
  ordersCreated: string[]
  summary: string[]
}

export async function clearAllTestData(confirmText: string): Promise<ClearAllTestDataResponse> {
  return serviceCall(async () => {
    const fn = httpsCallable<{ confirmText: string }, ClearAllTestDataResponse>(
      functions,
      'clearAllTestData',
    )
    const result = await fn({ confirmText })
    return result.data
  })
}

export async function importC3Orders(): Promise<ImportC3OrdersResponse> {
  return serviceCall(async () => {
    const fn = httpsCallable<Record<string, never>, ImportC3OrdersResponse>(
      functions,
      'importC3Orders',
    )
    const result = await fn({})
    return result.data
  })
}
