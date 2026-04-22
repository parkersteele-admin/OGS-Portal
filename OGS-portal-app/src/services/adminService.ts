import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'
import { serviceCall } from './base'

interface ClearAllTestDataResponse {
  success: boolean
  clearedCollections: string[]
  filesDeleted: number
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
