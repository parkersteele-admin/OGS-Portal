/**
 * src/hooks/usePaymentMethods.ts
 *
 * Real-time subscription to a customer's saved payment methods.
 * Refactored to use generic useFirestoreSubscription hook.
 */

import { useMemo } from 'react'
import { query, where, orderBy } from 'firebase/firestore'
import { paymentMethodsCol } from '../lib/firestore'
import { useFirestoreSubscription } from './useFirestoreSubscription'
import type { PaymentMethod } from '../types/billing'

interface UsePaymentMethodsResult {
  methods: PaymentMethod[]
  defaultMethod: PaymentMethod | undefined
  loading: boolean
  error: Error | null
}

export function usePaymentMethods(
  customerId: string | undefined,
): UsePaymentMethodsResult {
  const { data: methods, loading, error } = useFirestoreSubscription<PaymentMethod>(
    query(
      paymentMethodsCol,
      where('customerId', '==', customerId ?? ''),
      orderBy('isDefault', 'desc'),
      orderBy('createdAt', 'desc'),
    ),
    !!customerId,
  )

  const defaultMethod = useMemo(
    () => methods.find((m) => m.isDefault),
    [methods],
  )

  return {
    methods: customerId ? methods : [],
    defaultMethod,
    loading: customerId ? loading : false,
    error: customerId ? error : null,
  }
}
