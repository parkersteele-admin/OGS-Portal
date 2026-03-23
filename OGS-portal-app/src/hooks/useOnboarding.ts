/**
 * src/hooks/useOnboarding.ts
 *
 * Subscribes to customers/{companyId} and exposes onboarding state.
 * Consumed by: Onboarding.tsx, Dashboard.tsx, OnboardingStepper.tsx.
 */

import { useState, useEffect } from 'react'
import { useAuth } from './useAuth'
import { subscribeToCompany } from '../services/onboardingService'
import type { Company, CompanySetupStep, CompanyStatus } from '../types/company'

export interface UseOnboardingResult {
  company: Company | null
  setupStep: CompanySetupStep
  setupComplete: boolean
  status: CompanyStatus | null
  companyId: string | null
  loading: boolean
  error: string | null
}

export function useOnboarding(): UseOnboardingResult {
  const { user } = useAuth()
  const companyId = (user?.companyId ?? null) as string | null

  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) {
      setCompany(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const unsubscribe = subscribeToCompany(companyId, (c) => {
      setCompany(c)
      setLoading(false)
      setError(null)
    })

    return unsubscribe
  }, [companyId])

  return {
    company,
    setupStep: (company?.setupStep ?? 0) as CompanySetupStep,
    setupComplete: company?.setupComplete ?? false,
    status: company?.status ?? null,
    companyId,
    loading,
    error,
  }
}
