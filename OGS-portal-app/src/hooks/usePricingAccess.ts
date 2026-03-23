/**
 * src/hooks/usePricingAccess.ts
 *
 * Returns whether the current customer's account has pricing unlocked.
 * Pricing is locked by default for new web signups and unlocked automatically
 * when OGS sends or accepts a quote, or manually by an admin in the CRM.
 */

import { useQuery } from '@tanstack/react-query'
import { getDoc, doc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from './useAuth'

export interface PricingAccess {
  pricingUnlocked: boolean
  isLoading: boolean
}

export function usePricingAccess(): PricingAccess {
  const { user } = useAuth()
  const companyId = (user?.companyId ?? user?.customerId ?? '') as string

  const { data, isLoading } = useQuery<boolean>({
    queryKey: ['pricing-access', companyId],
    queryFn: async () => {
      if (!companyId) return false
      const snap = await getDoc(doc(db, 'customers', companyId))
      return (snap.data()?.pricingUnlocked as boolean | undefined) ?? false
    },
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  })

  return {
    pricingUnlocked: data ?? false,
    isLoading,
  }
}
