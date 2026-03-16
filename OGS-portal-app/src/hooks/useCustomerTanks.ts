import { useState, useEffect } from 'react'
import { onSnapshot, query, orderBy } from 'firebase/firestore'
import { customerTanksCol } from '../lib/firestore'
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
 */
export function useCustomerTanks(
  customerId: string | null | undefined,
): UseCustomerTanksResult {
  const [tanks, setTanks] = useState<Tank[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!customerId) {
      return
    }

    const unsubscribe = onSnapshot(
      query(customerTanksCol(customerId), orderBy('serialNumber')),
      (snap) => {
        setTanks(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Tank))
        setLoading(false)
      },
      (err) => {
        setError(err)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [customerId])

  const visibleTanks = customerId ? tanks : []

  const hasLowLevel = visibleTanks.some(
    (t) =>
      t.status === 'deployed' &&
      t.currentLevelPct !== undefined &&
      t.currentLevelPct <= LOW_LEVEL_THRESHOLD,
  )

  return {
    tanks: visibleTanks,
    hasLowLevel,
    loading: customerId ? loading : false,
    error: customerId ? error : null,
  }
}
