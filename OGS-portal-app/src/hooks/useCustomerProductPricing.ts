import { useEffect, useState } from 'react'
import type { CustomerProductPricing } from '../types/customerPricing'
import { subscribeToCustomerProductPricing } from '../services/customerPricingService'

interface UseCustomerProductPricingResult {
  entries: CustomerProductPricing[]
  pricingMap: Map<string, CustomerProductPricing>
  isLoading: boolean
  error: Error | null
}

export function useCustomerProductPricing(
  customerId?: string | null,
): UseCustomerProductPricingResult {
  const [entries, setEntries] = useState<CustomerProductPricing[]>([])
  const [isLoading, setIsLoading] = useState(Boolean(customerId))
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!customerId) {
      setEntries([])
      setIsLoading(false)
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)

    const unsubscribe = subscribeToCustomerProductPricing(
      customerId,
      (nextEntries) => {
        setEntries(nextEntries)
        setIsLoading(false)
      },
      (err) => {
        setError(err)
        setIsLoading(false)
      },
    )

    return unsubscribe
  }, [customerId])

  return {
    entries,
    pricingMap: new Map(entries.map((entry) => [entry.productId, entry])),
    isLoading,
    error,
  }
}
