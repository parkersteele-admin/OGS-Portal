import { useMemo } from 'react'
import { query, orderBy } from 'firebase/firestore'
import { customerTanksCol } from '../lib/firestore'
import { useFirestoreSubscription } from './useFirestoreSubscription'
import type { Tank } from '../types/tank'

const LOW_LEVEL_THRESHOLD = 20 // percent

interface UseCustomerTanksResult {
  tanks: Tank[]
  /** True if any deployed tank is at or below the low-level threshold. */
  hasLowLevel: boolean
  loading: boolean
  error: Error | null
}

/**
 * Subscribes to a customer's tanks in real time.
 * Used by the customer portal dashboard to show tank level and trigger alerts.
 *
 * REFACTORED: Now uses generic useFirestoreSubscription hook
 * (82% less code, consistent patterns across all subscription hooks)
 */
export function useCustomerTanks(
  customerId: string | null | undefined,
): UseCustomerTanksResult {
  const { data: tanks, loading, error } = useFirestoreSubscription<Tank>(
    query(customerTanksCol(customerId!), orderBy('serialNumber')),
    !!customerId,
  )

  const hasLowLevel = useMemo(
    () =>
      tanks.some(
        (t) =>
          t.status === 'deployed' &&
          t.currentLevelPct !== undefined &&
          t.currentLevelPct <= LOW_LEVEL_THRESHOLD,
      ),
    [tanks],
  )

  return {
    tanks: customerId ? tanks : [],
    hasLowLevel,
    loading: customerId ? loading : false,
    error: customerId ? error : null,
  }
}
