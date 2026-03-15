/**
 * src/hooks/usePaymentMethods.ts
 *
 * Real-time subscription to a customer's saved payment methods.
 * Wraps subscribePaymentMethods with React lifecycle management.
 */

import { useState, useEffect } from 'react'
import { subscribePaymentMethods } from '../services/paymentMethodService'
import type { PaymentMethod } from '../types/billing'

interface UsePaymentMethodsResult {
  methods:     PaymentMethod[]
  defaultMethod: PaymentMethod | undefined
  loading:     boolean
  error:       Error | null
}

export function usePaymentMethods(customerId: string | undefined): UsePaymentMethodsResult {
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<Error | null>(null)

  useEffect(() => {
    if (!customerId) {
      setMethods([])
      setLoading(false)
      return
    }

    setLoading(true)

    const unsub = subscribePaymentMethods(customerId, (data, err) => {
      if (err) {
        setError(err)
      } else {
        setMethods(data)
        setError(null)
      }
      setLoading(false)
    })

    return unsub
  }, [customerId])

  return {
    methods,
    defaultMethod: methods.find((m) => m.isDefault),
    loading,
    error,
  }
}
